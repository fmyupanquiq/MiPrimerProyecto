import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  INVITATION_TOKEN_PATTERN,
  type AcceptInvitationResult,
  type InvitationPreview,
} from '@letfer/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { maskEmail } from '../common/mask-email.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  invitationAcceptances,
  invitations,
  projectMembers,
  projects,
  roles,
  users,
  type InvitationRow,
  type ProjectRow,
  type RoleRow,
  type UserRow,
} from '../database/schema/index.js';
import { hashToken } from '../sessions/session.service.js';
import { deriveInvitationStatus } from './invitations.service.js';
import { MembersService } from './members.service.js';

/** Todo enlace inválido responde igual: no se revela si existió, venció o se deshabilitó. */
const invalidInvitation = () =>
  new AppError(400, ErrorCode.INVALID_TOKEN, 'La invitación no es válida o ha caducado.');

const notForYou = () =>
  new AppError(403, ErrorCode.FORBIDDEN, 'Esta invitación no está dirigida a tu cuenta.');

interface UsableInvitation {
  invitation: InvitationRow;
  project: ProjectRow;
  role: RoleRow;
  creator: UserRow;
}

/**
 * Vista previa, aceptación y rechazo de invitaciones a partir del enlace (§84, §105.7).
 * Una invitación solo es utilizable si está vigente, el proyecto está `ACTIVE` y su creador sigue
 * autorizado a crearla con ese rol.
 */
@Injectable()
export class InvitationAcceptanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly members: MembersService,
    private readonly clock: Clock,
  ) {}

  /** Datos mínimos para mostrar antes de aceptar. Público: solo con el token. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.findByToken(this.db, token, false);
    if (!invitation) throw invalidInvitation();
    const usable = await this.assertUsable(this.db, invitation);
    return {
      projectName: usable.project.name,
      roleName: usable.role.name,
      invitedBy: `${usable.creator.firstName} ${usable.creator.lastName}`.trim(),
      expiresAt: invitation.expiresAt ? invitation.expiresAt.toISOString() : null,
      singleUse: invitation.singleUse,
      restrictedEmailHint: invitation.restrictedEmail
        ? maskEmail(invitation.restrictedEmail)
        : null,
    };
  }

  /**
   * Acepta la invitación e incorpora al usuario (o reactiva su membresía). Idempotente: si ya es
   * miembro activo no cambia nada. Una invitación de un solo uso se consume de forma atómica y
   * cada persona solo puede usar una misma invitación una vez.
   */
  async accept(user: UserRow, token: string): Promise<AcceptInvitationResult> {
    return this.db.transaction(async (tx) => {
      // El bloqueo de la fila serializa las aceptaciones simultáneas de una misma invitación.
      const invitation = await this.findByToken(tx, token, true);
      if (!invitation) throw invalidInvitation();

      const [previous] = await tx
        .select({ id: invitationAcceptances.id })
        .from(invitationAcceptances)
        .where(
          and(
            eq(invitationAcceptances.invitationId, invitation.id),
            eq(invitationAcceptances.userId, user.id),
          ),
        )
        .limit(1);
      const [membership] = await tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, invitation.projectId),
            eq(projectMembers.userId, user.id),
          ),
        )
        .limit(1);
      const isActiveMember = membership?.status === 'ACTIVE';

      if (previous) {
        // Repetir la aceptación no hace nada; quien ya la usó y salió (o fue expulsado) necesita
        // una invitación nueva.
        if (isActiveMember) return this.result(tx, invitation, 'ALREADY_MEMBER');
        throw invalidInvitation();
      }

      await this.assertUsable(tx, invitation);
      this.assertAddressedTo(invitation, user);
      if (isActiveMember) return this.result(tx, invitation, 'ALREADY_MEMBER');

      const { outcome } = await this.members.addOrReactivate(tx, {
        projectId: invitation.projectId,
        userId: user.id,
        roleId: invitation.roleId,
      });

      if (invitation.singleUse) {
        const consumed = await tx
          .update(invitations)
          .set({
            consumedAt: this.clock.now(),
            consumedBy: user.id,
            version: nextVersion(invitations.version),
          })
          .where(and(eq(invitations.id, invitation.id), isNull(invitations.consumedAt)))
          .returning({ id: invitations.id });
        if (consumed.length === 0) throw invalidInvitation();
      }
      await tx.insert(invitationAcceptances).values({
        invitationId: invitation.id,
        userId: user.id,
        outcome,
        acceptedAt: this.clock.now(),
      });

      const [role] = await tx.select().from(roles).where(eq(roles.id, invitation.roleId)).limit(1);
      await this.audit.record(tx, {
        action: 'invitation.accepted',
        entityType: 'invitation',
        entityId: invitation.id,
        projectId: invitation.projectId,
        actorUserId: user.id,
        newValues: { outcome, role: role?.key ?? role?.name ?? null },
        metadata: { memberUserId: user.id, singleUse: invitation.singleUse },
      });
      return this.result(tx, invitation, outcome);
    });
  }

  /** Rechaza la invitación: solo se audita; no consume ni deshabilita el enlace (§105.7). */
  async reject(user: UserRow, token: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const invitation = await this.findByToken(tx, token, false);
      if (!invitation) throw invalidInvitation();
      await this.assertUsable(tx, invitation);
      this.assertAddressedTo(invitation, user);
      await this.audit.record(tx, {
        action: 'invitation.rejected',
        entityType: 'invitation',
        entityId: invitation.id,
        projectId: invitation.projectId,
        actorUserId: user.id,
        metadata: { userId: user.id },
      });
    });
  }

  /** Invitación por token (por su hash), opcionalmente bloqueada. `null` si no existe. */
  private async findByToken(
    executor: DbExecutor,
    token: string,
    lock: boolean,
  ): Promise<InvitationRow | null> {
    if (!INVITATION_TOKEN_PATTERN.test(token)) return null;
    const query = executor
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)))
      .limit(1);
    const [invitation] = await (lock ? query.for('update') : query);
    return invitation ?? null;
  }

  /**
   * La invitación debe estar vigente, el proyecto `ACTIVE` y su creador seguir activo y
   * autorizado a crearla con ese rol (§105.7). Cualquier fallo responde igual.
   */
  private async assertUsable(
    executor: DbExecutor,
    invitation: InvitationRow,
  ): Promise<UsableInvitation> {
    if (deriveInvitationStatus(invitation, this.clock.now()) !== 'ACTIVE')
      throw invalidInvitation();

    const [project] = await executor
      .select()
      .from(projects)
      .where(eq(projects.id, invitation.projectId))
      .limit(1);
    if (!project || project.status !== 'ACTIVE') throw invalidInvitation();

    const [creator] = await executor
      .select()
      .from(users)
      .where(eq(users.id, invitation.createdBy))
      .limit(1);
    if (!creator || creator.status !== 'ACTIVE') throw invalidInvitation();

    const access = await this.authorization.projectAccess(creator, project.id, {}, executor);
    const role = await this.authorization.loadRole(invitation.roleId, executor);
    if (
      !access ||
      !access.permissions.has('invitations.create') ||
      !role ||
      !this.authorization.canAssignRole(access, role)
    ) {
      throw invalidInvitation();
    }
    return { invitation, project, role: role.role, creator };
  }

  /** La restricción por correo se valida siempre en el servidor. */
  private assertAddressedTo(invitation: InvitationRow, user: UserRow): void {
    if (
      invitation.restrictedEmail &&
      invitation.restrictedEmail !== user.email.trim().toLowerCase()
    ) {
      throw notForYou();
    }
  }

  private async result(
    executor: DbExecutor,
    invitation: InvitationRow,
    outcome: AcceptInvitationResult['outcome'],
  ): Promise<AcceptInvitationResult> {
    const [row] = await executor
      .select({ projectName: projects.name, roleName: roles.name })
      .from(projects)
      .innerJoin(roles, eq(roles.id, invitation.roleId))
      .where(eq(projects.id, invitation.projectId))
      .limit(1);
    return {
      projectId: invitation.projectId,
      projectName: row?.projectName ?? '',
      roleName: row?.roleName ?? '',
      outcome,
    };
  }
}
