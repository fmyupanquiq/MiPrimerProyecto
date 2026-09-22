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
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
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
import { roleIdByKey, roleKeyById } from '../database/role-lookup.js';
import {
  projectMembers,
  projects,
  roles,
  stages,
  users,
  type ProjectRow,
  type UserRow,
} from '../database/schema/index.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import {
  fullName,
  toProjectDetail,
  toProjectSummary,
  type SummaryContext,
} from './project-mappers.js';

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
      activeStage: await this.activeStageOf(access.project.id, executor),
    });
  }

  /** Etapa activa del proyecto (§50), o `null` si todavía no tiene ninguna (antes del setup). */
  private async activeStageOf(
    projectId: string,
    executor: DbExecutor,
  ): Promise<SummaryContext['activeStage']> {
    const [stage] = await executor
      .select({ id: stages.id, name: stages.name, unitStake: stages.unitStake })
      .from(stages)
      .where(and(eq(stages.projectId, projectId), eq(stages.status, 'ACTIVE')))
      .limit(1);
    return stage ?? null;
  }

  /** Igual que `activeStageOf`, pero para muchos proyectos a la vez (evita N+1 en los listados). */
  private async activeStagesByProject(
    projectIds: readonly string[],
    executor: DbExecutor,
  ): Promise<Map<string, NonNullable<SummaryContext['activeStage']>>> {
    if (projectIds.length === 0) return new Map();
    const rows = await executor
      .select({
        projectId: stages.projectId,
        id: stages.id,
        name: stages.name,
        unitStake: stages.unitStake,
      })
      .from(stages)
      .where(and(inArray(stages.projectId, [...new Set(projectIds)]), eq(stages.status, 'ACTIVE')));
    return new Map(rows.map((row) => [row.projectId, row]));
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

    const activeStages = await this.activeStagesByProject(
      rows.map((row) => row.project.id),
      this.db,
    );
    return rows.map((row) =>
      toProjectSummary(row.project, {
        ownerName: fullName({ firstName: row.ownerFirst, lastName: row.ownerLast }),
        isOwner: row.project.ownerId === actor.id,
        myRole: row.roleKey ?? row.roleName ?? null,
        activeStage: activeStages.get(row.project.id) ?? null,
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

    // Enviar el proyecto a la papelera no toca sus etapas (§86 no lo exige): la etapa que
    // estaba activa sigue existiendo, solo queda inaccesible mientras el proyecto lo esté.
    const activeStages = await this.activeStagesByProject(
      rows.map((row) => row.project.id),
      this.db,
    );
    return rows.map((row) =>
      toProjectSummary(row.project, {
        ownerName: fullName({ firstName: row.ownerFirst, lastName: row.ownerLast }),
        isOwner: row.project.ownerId === actor.id,
        myRole: null,
        activeStage: activeStages.get(row.project.id) ?? null,
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

  /**
   * Transfiere la propiedad a otro miembro activo (§105.4, F4). Solo la invoca el Administrador
   * Global. El nuevo propietario pasa a Administrador de Proyecto (si no lo era) y el anterior
   * conserva su membresía de Administrador. Todo ocurre en una transacción: el disparador diferido
   * de la base de datos exige que, al confirmar, el propietario sea un Administrador activo.
   */
  async transferOwnership(actor: UserRow, projectId: string, newOwnerId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update')
        .limit(1);
      if (!project) throw new AppError(404, ErrorCode.NOT_FOUND, 'Proyecto no encontrado.');
      if (project.ownerId === newOwnerId) {
        throw new AppError(
          409,
          ErrorCode.INVALID_STATE,
          'Esa persona ya es la propietaria del proyecto.',
        );
      }

      const [target] = await tx
        .select({ member: projectMembers, user: users })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, newOwnerId),
            eq(projectMembers.status, 'ACTIVE'),
          ),
        )
        .for('update', { of: projectMembers })
        .limit(1);
      if (!target || target.user.status !== 'ACTIVE') {
        throw new AppError(
          409,
          ErrorCode.INVALID_STATE,
          'La nueva persona propietaria debe ser miembro activo del proyecto.',
        );
      }

      const adminRoleId = await roleIdByKey(tx, OWNER_MEMBERSHIP_ROLE_KEY);
      const previousRoleId = target.member.roleId;
      if (previousRoleId !== adminRoleId) {
        await tx
          .update(projectMembers)
          .set({ roleId: adminRoleId, version: nextVersion(projectMembers.version) })
          .where(eq(projectMembers.id, target.member.id));
      }
      await tx
        .update(projects)
        .set({ ownerId: newOwnerId, version: nextVersion(projects.version) })
        .where(eq(projects.id, projectId));

      const previousRoleKey = await roleKeyById(tx, previousRoleId);
      if (previousRoleId !== adminRoleId) {
        await this.audit.record(tx, {
          action: 'member.role_changed',
          entityType: 'project_member',
          entityId: target.member.id,
          projectId,
          actorUserId: actor.id,
          oldValues: { roleId: previousRoleId, role: previousRoleKey },
          newValues: { roleId: adminRoleId, role: OWNER_MEMBERSHIP_ROLE_KEY },
          metadata: { memberUserId: newOwnerId, reason: 'ownership_transfer' },
        });
      }
      await this.audit.record(tx, {
        action: 'project.ownership_transferred',
        entityType: 'project',
        entityId: projectId,
        projectId,
        actorUserId: actor.id,
        oldValues: { ownerId: project.ownerId },
        newValues: { ownerId: newOwnerId },
        metadata: { newOwnerPreviousRole: previousRoleKey },
      });
    });
  }
}
