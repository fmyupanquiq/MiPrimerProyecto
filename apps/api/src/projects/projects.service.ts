import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  OWNER_MEMBERSHIP_ROLE_KEY,
  type CreateProjectInput,
  type PermissionCode,
  type ProjectDetail,
  type ProjectSummary,
  type UpdateProjectInput,
} from '@letfer/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { diffFields } from '../audit/audit-values.js';
import {
  AuthorizationService,
  type ProjectAccess,
} from '../authorization/authorization.service.js';
import { expectUpdated, nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { roleIdByKey } from '../database/role-lookup.js';
import {
  projectMembers,
  projects,
  roles,
  users,
  type ProjectRow,
  type UserRow,
} from '../database/schema/index.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { fullName, toProjectDetail, toProjectSummary } from './project-mappers.js';

const UPDATABLE_FIELDS = ['name', 'description', 'timezone', 'dateFormat'] as const;

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
  ) {}

  /**
   * Crea un proyecto (§105.1). En una única transacción: el proyecto, el creador como
   * propietario, su membresía de Administrador de Proyecto y la auditoría. Todavía sin etapa,
   * unidad, banca ni casas (Fase 3).
   */
  async create(actor: UserRow, input: CreateProjectInput): Promise<ProjectDetail> {
    const projectId = await this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          name: input.name,
          description: input.description,
          timezone: input.timezone,
          dateFormat: input.dateFormat,
          ownerId: actor.id,
        })
        .returning();
      await tx.insert(projectMembers).values({
        projectId: project!.id,
        userId: actor.id,
        roleId: await roleIdByKey(tx, OWNER_MEMBERSHIP_ROLE_KEY),
        joinedAt: this.clock.now(),
      });
      await this.audit.record(tx, {
        action: 'project.created',
        entityType: 'project',
        entityId: project!.id,
        projectId: project!.id,
        actorUserId: actor.id,
        newValues: {
          name: project!.name,
          description: project!.description,
          currency: project!.currency,
          timezone: project!.timezone,
          dateFormat: project!.dateFormat,
          ownerId: actor.id,
        },
      });
      return project!.id;
    });

    const access = await this.authorization.projectAccess(actor, projectId);
    return this.detail(access!);
  }

  /** Detalle de un proyecto para quien tiene acceso, con sus permisos efectivos. */
  async detail(access: ProjectAccess, executor: DbExecutor = this.db): Promise<ProjectDetail> {
    const [owner] = await executor
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, access.project.ownerId))
      .limit(1);
    return toProjectDetail(access.project, {
      ownerName: owner ? fullName(owner) : '',
      isOwner: access.isOwner,
      myRole: access.roleKey,
      permissions: access.permissions,
    });
  }

  /** Detalle del proyecto tal como queda tras una operación (vuelve a resolver el acceso). */
  async detailFor(actor: UserRow, projectId: string): Promise<ProjectDetail> {
    const access = await this.authorization.projectAccess(actor, projectId, { allowTrashed: true });
    if (!access) throw new AppError(404, ErrorCode.NOT_FOUND, 'Proyecto no encontrado.');
    return this.detail(access);
  }

  /**
   * "Mis proyectos" (`mine`): aquellos en los que el usuario es miembro activo. `all` lista todos
   * los proyectos (solo con `projects.list_all`, §5). Nunca incluye los de la papelera.
   */
  async list(actor: UserRow, scope: 'mine' | 'all'): Promise<ProjectSummary[]> {
    const base = this.db
      .select({
        project: projects,
        ownerFirst: users.firstName,
        ownerLast: users.lastName,
        roleKey: roles.key,
        roleName: roles.name,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId));

    const membershipJoin = and(
      eq(projectMembers.projectId, projects.id),
      eq(projectMembers.userId, actor.id),
      eq(projectMembers.status, 'ACTIVE'),
    );
    const rows =
      scope === 'mine'
        ? await base
            .innerJoin(projectMembers, membershipJoin)
            .innerJoin(roles, eq(roles.id, projectMembers.roleId))
            .where(ne(projects.status, 'TRASHED'))
            .orderBy(desc(projects.createdAt))
        : await base
            .leftJoin(projectMembers, membershipJoin)
            .leftJoin(roles, eq(roles.id, projectMembers.roleId))
            .where(ne(projects.status, 'TRASHED'))
            .orderBy(desc(projects.createdAt));

    return rows.map((row) =>
      toProjectSummary(row.project, {
        ownerName: fullName({ firstName: row.ownerFirst, lastName: row.ownerLast }),
        isOwner: row.project.ownerId === actor.id,
        myRole: row.roleKey ?? row.roleName ?? null,
      }),
    );
  }

  /**
   * Papelera de proyectos: los propios (de los que el usuario es propietario) o, si su rol global
   * incluye `project.restore` (Administrador Global), todos (§105.3, §105.5).
   */
  async listTrash(
    actor: UserRow,
    globalPermissions: ReadonlySet<PermissionCode>,
  ): Promise<ProjectSummary[]> {
    const canRestoreAny = globalPermissions.has('project.restore');
    const rows = await this.db
      .select({ project: projects, ownerFirst: users.firstName, ownerLast: users.lastName })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(
        canRestoreAny
          ? eq(projects.status, 'TRASHED')
          : and(eq(projects.status, 'TRASHED'), eq(projects.ownerId, actor.id)),
      )
      .orderBy(desc(projects.deletedAt));

    return rows.map((row) =>
      toProjectSummary(row.project, {
        ownerName: fullName({ firstName: row.ownerFirst, lastName: row.ownerLast }),
        isOwner: row.project.ownerId === actor.id,
        myRole: null,
      }),
    );
  }

  /**
   * Edita la configuración con control de concurrencia optimista y auditoría campo por campo
   * (§24, §96). La moneda no se modifica; la zona horaria sí, con auditoría (§105.6).
   */
  async update(
    access: ProjectAccess,
    actor: UserRow,
    input: UpdateProjectInput,
  ): Promise<ProjectRow> {
    const changes: Partial<Pick<ProjectRow, (typeof UPDATABLE_FIELDS)[number]>> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.description !== undefined) changes.description = input.description;
    if (input.timezone !== undefined) changes.timezone = input.timezone;
    if (input.dateFormat !== undefined) changes.dateFormat = input.dateFormat;

    return this.db.transaction(async (tx) => {
      const updated = expectUpdated(
        await tx
          .update(projects)
          .set({ ...changes, version: nextVersion(projects.version) })
          .where(and(eq(projects.id, access.project.id), eq(projects.version, input.version)))
          .returning(),
        'projects',
      );
      const diff = diffFields(access.project, updated, UPDATABLE_FIELDS);
      if (diff) {
        await this.audit.record(tx, {
          action: 'project.updated',
          entityType: 'project',
          entityId: updated.id,
          projectId: updated.id,
          actorUserId: actor.id,
          ...diff,
        });
      }
      return updated;
    });
  }
}
