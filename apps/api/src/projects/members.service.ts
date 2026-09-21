import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  isPermissionSubset,
  type AssignableRole,
  type ChangeMemberRoleInput,
  type MemberListFilter,
  type MemberSummary,
} from '@letfer/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import {
  AuthorizationService,
  type ProjectAccess,
} from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  projectMembers,
  roles,
  users,
  type ProjectMemberRow,
  type UserRow,
} from '../database/schema/index.js';

export type AddMemberOutcome = 'ADDED' | 'REACTIVATED' | 'ALREADY_MEMBER';

const forbidden = (message = 'No tienes permiso para esta acción.') =>
  new AppError(403, ErrorCode.FORBIDDEN, message);
const memberNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Miembro no encontrado.');
const ownerProtected = (message: string) => new AppError(409, ErrorCode.OWNER_PROTECTED, message);

/**
 * Miembros del proyecto (§6, §105.4): listado, cambio de rol, expulsión, salida voluntaria e
 * incorporación (usada por las invitaciones). Nunca se borran filas: se reutiliza la misma
 * membresía cuando alguien sale y vuelve.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
  ) {}

  /**
   * Miembros del proyecto. Por defecto solo los activos; consultar a quienes salieron o fueron
   * expulsados exige poder gestionar roles. El correo solo se muestra a quien gestiona roles.
   */
  async list(access: ProjectAccess, filter: MemberListFilter): Promise<MemberSummary[]> {
    const canManage = access.permissions.has('members.update_role');
    if (filter !== 'ACTIVE' && !canManage) throw forbidden();

    const rows = await this.db
      .select({ member: projectMembers, user: users, role: roles })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(roles, eq(roles.id, projectMembers.roleId))
      .where(
        filter === 'ALL'
          ? eq(projectMembers.projectId, access.project.id)
          : and(eq(projectMembers.projectId, access.project.id), eq(projectMembers.status, filter)),
      )
      .orderBy(asc(users.firstName), asc(users.lastName), asc(projectMembers.id));

    const members = rows.map(({ member, user, role }): MemberSummary => ({
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: canManage ? user.email : null,
      roleId: role.id,
      roleKey: role.key,
      roleName: role.name,
      isOwner: user.id === access.project.ownerId,
      status: member.status,
      joinedAt: member.joinedAt.toISOString(),
      leftAt: member.leftAt ? member.leftAt.toISOString() : null,
      removedAt: member.removedAt ? member.removedAt.toISOString() : null,
      version: member.version,
    }));
    // El propietario siempre primero.
    return members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  }

  /** Roles que el actor puede asignar (para invitaciones y cambios de rol). */
  async assignableRoles(access: ProjectAccess): Promise<AssignableRole[]> {
    const loaded = await this.authorization.assignableRoles(access);
    return loaded.map(({ role }) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
    }));
  }

  /** Cambia el rol de un miembro activo (con versión, límite de asignación y propietario protegido). */
  async changeRole(
    access: ProjectAccess,
    actor: UserRow,
    userId: string,
    input: ChangeMemberRoleInput,
  ): Promise<MemberSummary> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockActiveMember(tx, access, userId);
      if (userId === access.project.ownerId) {
        throw ownerProtected('El rol del propietario del proyecto no se puede cambiar.');
      }
      await this.assertCanManageCurrentRole(tx, access, current);

      const target = await this.authorization.loadRole(input.roleId, tx);
      if (!target || !this.authorization.canAssignRole(access, target)) {
        throw forbidden('No puedes asignar ese rol.');
      }

      const [updated] = await tx
        .update(projectMembers)
        .set({ roleId: input.roleId, version: nextVersion(projectMembers.version) })
        .where(and(eq(projectMembers.id, current.id), eq(projectMembers.version, input.version)))
        .returning();
      if (!updated) {
        throw new AppError(
          409,
          ErrorCode.CONCURRENCY_CONFLICT,
          'El miembro cambió mientras se editaba; recarga e inténtalo de nuevo.',
        );
      }

      if (current.roleId !== input.roleId) {
        const before = await this.authorization.loadRole(current.roleId, tx);
        await this.audit.record(tx, {
          action: 'member.role_changed',
          entityType: 'project_member',
          entityId: current.id,
          projectId: access.project.id,
          actorUserId: actor.id,
          oldValues: { roleId: current.roleId, role: before?.key ?? null },
          newValues: { roleId: input.roleId, role: target.key },
          metadata: { memberUserId: userId },
        });
      }
    });
    return this.memberSummary(access, userId);
  }

  /** Expulsa a un miembro activo (queda `REMOVED`; podrá volver con una invitación). */
  async remove(
    access: ProjectAccess,
    actor: UserRow,
    userId: string,
    reason: string | undefined,
  ): Promise<void> {
    if (userId === actor.id) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'Para salir del proyecto usa "Salir del proyecto".',
      );
    }
    await this.db.transaction(async (tx) => {
      const current = await this.lockActiveMember(tx, access, userId);
      if (userId === access.project.ownerId) {
        throw ownerProtected('El propietario del proyecto no se puede expulsar.');
      }
      await this.assertCanManageCurrentRole(tx, access, current);

      await tx
        .update(projectMembers)
        .set({
          status: 'REMOVED',
          removedAt: this.clock.now(),
          removedBy: actor.id,
          removalReason: reason ?? null,
          version: nextVersion(projectMembers.version),
        })
        .where(eq(projectMembers.id, current.id));
      await this.audit.record(tx, {
        action: 'member.removed',
        entityType: 'project_member',
        entityId: current.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'REMOVED' },
        metadata: { memberUserId: userId, reason: reason ?? null },
      });
    });
  }

  /** El propio usuario abandona el proyecto (queda `LEFT`). El propietario no puede. */
  async leave(access: ProjectAccess, actor: UserRow): Promise<void> {
    if (!access.membership) throw memberNotFound();
    if (actor.id === access.project.ownerId) {
      throw ownerProtected(
        'El propietario no puede salir del proyecto; la propiedad debe transferirse antes.',
      );
    }
    await this.db.transaction(async (tx) => {
      const current = await this.lockActiveMember(tx, access, actor.id);
      await tx
        .update(projectMembers)
        .set({
          status: 'LEFT',
          leftAt: this.clock.now(),
          version: nextVersion(projectMembers.version),
        })
        .where(eq(projectMembers.id, current.id));
      await this.audit.record(tx, {
        action: 'member.left',
        entityType: 'project_member',
        entityId: current.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'LEFT' },
        metadata: { memberUserId: actor.id },
      });
    });
  }

  /**
   * Incorpora a un usuario al proyecto o reactiva su membresía anterior (LEFT o REMOVED),
   * reutilizando la misma fila (§105.4). Si ya es miembro activo no cambia nada (idempotente).
   * No audita: lo hace quien la invoca (p. ej. la aceptación de una invitación).
   */
  async addOrReactivate(
    tx: DbExecutor,
    input: { projectId: string; userId: string; roleId: string },
  ): Promise<{ membership: ProjectMemberRow; outcome: AddMemberOutcome }> {
    const [existing] = await tx
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)),
      )
      .for('update')
      .limit(1);

    const now = this.clock.now();
    if (!existing) {
      const [created] = await tx
        .insert(projectMembers)
        .values({ ...input, joinedAt: now })
        .returning();
      return { membership: created!, outcome: 'ADDED' };
    }
    if (existing.status === 'ACTIVE') return { membership: existing, outcome: 'ALREADY_MEMBER' };

    const [reactivated] = await tx
      .update(projectMembers)
      .set({
        roleId: input.roleId,
        status: 'ACTIVE',
        joinedAt: now,
        leftAt: null,
        removedAt: null,
        removedBy: null,
        removalReason: null,
        version: nextVersion(projectMembers.version),
      })
      .where(eq(projectMembers.id, existing.id))
      .returning();
    return { membership: reactivated!, outcome: 'REACTIVATED' };
  }

  /** Membresía activa bloqueada para modificarla; 404 si no existe o ya no es activa. */
  private async lockActiveMember(
    tx: DbExecutor,
    access: ProjectAccess,
    userId: string,
  ): Promise<ProjectMemberRow> {
    const [member] = await tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, access.project.id),
          eq(projectMembers.userId, userId),
          eq(projectMembers.status, 'ACTIVE'),
        ),
      )
      .for('update')
      .limit(1);
    if (!member) throw memberNotFound();
    return member;
  }

  /**
   * Nadie gestiona a un miembro cuyo rol actual otorgue permisos que el actor no tiene
   * (evita que un rol personalizado con menos permisos degrade o expulse a uno superior).
   */
  private async assertCanManageCurrentRole(
    tx: DbExecutor,
    access: ProjectAccess,
    member: ProjectMemberRow,
  ): Promise<void> {
    const current = await this.authorization.loadRole(member.roleId, tx);
    if (!current || !isPermissionSubset(current.permissions, access.permissions)) {
      throw forbidden('No puedes gestionar a un miembro con un rol superior al tuyo.');
    }
  }

  /** Resumen de un miembro tras modificarlo (el actor puede gestionar roles, así que ve `ALL`). */
  private async memberSummary(access: ProjectAccess, userId: string): Promise<MemberSummary> {
    const members = await this.list(access, 'ALL');
    const member = members.find((item) => item.userId === userId);
    if (!member) throw memberNotFound();
    return member;
  }
}
