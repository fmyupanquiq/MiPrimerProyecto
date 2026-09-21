import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  INVITATION_EXPIRY_HOURS,
  type CreateInvitationInput,
  type CreatedInvitation,
  type InvitationStatus,
  type InvitationSummary,
} from '@letfer/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import {
  AuthorizationService,
  type ProjectAccess,
} from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { maskEmail } from '../common/mask-email.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import {
  invitationAcceptances,
  invitations,
  roles,
  users,
  type InvitationRow,
  type UserRow,
} from '../database/schema/index.js';
import { hashToken } from '../sessions/session.service.js';

const MS_PER_HOUR = 60 * 60 * 1000;

/** Nuevo token de invitación: 256 bits aleatorios en base64url (43 caracteres). */
export const generateInvitationToken = (): string => randomBytes(32).toString('base64url');

/**
 * Estado derivado (§105.7): `DISABLED` si fue deshabilitada; si no, `ACCEPTED` si es de un solo
 * uso y ya se consumió; si no, `EXPIRED` si venció; si no, `ACTIVE`.
 */
export function deriveInvitationStatus(
  invitation: Pick<InvitationRow, 'disabledAt' | 'consumedAt' | 'singleUse' | 'expiresAt'>,
  now: Date,
): InvitationStatus {
  if (invitation.disabledAt) return 'DISABLED';
  if (invitation.singleUse && invitation.consumedAt) return 'ACCEPTED';
  if (invitation.expiresAt && invitation.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

/** Crear, listar y deshabilitar las invitaciones de un proyecto (§105.7). */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
  ) {}

  /**
   * Crea una invitación. El proyecto debe estar `ACTIVE` y el rol dentro del límite de asignación
   * de quien invita. El token en claro solo existe en esta respuesta: en la base de datos queda su
   * hash, así que el enlace no se puede volver a mostrar.
   */
  async create(
    access: ProjectAccess,
    actor: UserRow,
    input: CreateInvitationInput,
  ): Promise<CreatedInvitation> {
    if (access.project.status !== 'ACTIVE') {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'Solo se pueden crear invitaciones en un proyecto activo.',
      );
    }
    const role = await this.authorization.loadRole(input.roleId);
    if (!role || !this.authorization.canAssignRole(access, role)) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No puedes invitar con ese rol.');
    }

    const now = this.clock.now();
    const hours = INVITATION_EXPIRY_HOURS[input.expiry];
    const token = generateInvitationToken();

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(invitations)
        .values({
          projectId: access.project.id,
          roleId: input.roleId,
          createdBy: actor.id,
          tokenHash: hashToken(token),
          singleUse: input.singleUse,
          expiresAt: hours === null ? null : new Date(now.getTime() + hours * MS_PER_HOUR),
          restrictedEmail: input.restrictedEmail,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'invitation.created',
        entityType: 'invitation',
        entityId: row!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: {
          role: role.key,
          roleId: input.roleId,
          singleUse: row!.singleUse,
          expiresAt: row!.expiresAt,
          // El correo se audita enmascarado y jamás el token ni su hash.
          restrictedEmail: row!.restrictedEmail ? maskEmail(row!.restrictedEmail) : null,
        },
      });
      return row!;
    });

    const summary = this.toSummary(created, {
      roleKey: role.role.key,
      roleName: role.role.name,
      creatorName: `${actor.firstName} ${actor.lastName}`.trim(),
      acceptedCount: 0,
      now,
    });
    return { ...summary, token, link: `${this.config.appBaseUrl}/invite?token=${token}` };
  }

  /** Invitaciones del proyecto, las más recientes primero (sin token: no se conserva). */
  async list(access: ProjectAccess): Promise<InvitationSummary[]> {
    const rows = await this.db
      .select({ invitation: invitations, role: roles, creator: users })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .innerJoin(users, eq(users.id, invitations.createdBy))
      .where(eq(invitations.projectId, access.project.id))
      .orderBy(desc(invitations.createdAt), desc(invitations.id));
    if (rows.length === 0) return [];

    const counts = await this.db
      .select({ invitationId: invitationAcceptances.invitationId, total: count() })
      .from(invitationAcceptances)
      .where(
        inArray(
          invitationAcceptances.invitationId,
          rows.map((row) => row.invitation.id),
        ),
      )
      .groupBy(invitationAcceptances.invitationId);
    const acceptedBy = new Map(counts.map((row) => [row.invitationId, row.total]));

    const now = this.clock.now();
    return rows.map(({ invitation, role, creator }) =>
      this.toSummary(invitation, {
        roleKey: role.key,
        roleName: role.name,
        creatorName: `${creator.firstName} ${creator.lastName}`.trim(),
        acceptedCount: acceptedBy.get(invitation.id) ?? 0,
        now,
      }),
    );
  }

  /**
   * Deshabilita una invitación (irreversible). Es idempotente: deshabilitar una ya deshabilitada
   * no cambia nada ni vuelve a auditar. Una invitación de otro proyecto responde 404.
   */
  async disable(
    access: ProjectAccess,
    actor: UserRow,
    invitationId: string,
  ): Promise<InvitationSummary> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.id, invitationId), eq(invitations.projectId, access.project.id)))
        .for('update')
        .limit(1);
      if (!current) throw new AppError(404, ErrorCode.NOT_FOUND, 'Invitación no encontrada.');
      if (current.disabledAt) return;

      await tx
        .update(invitations)
        .set({
          disabledAt: this.clock.now(),
          disabledBy: actor.id,
          version: nextVersion(invitations.version),
        })
        .where(eq(invitations.id, current.id));
      await this.audit.record(tx, {
        action: 'invitation.disabled',
        entityType: 'invitation',
        entityId: current.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: deriveInvitationStatus(current, this.clock.now()) },
        newValues: { status: 'DISABLED' },
      });
    });

    const found = (await this.list(access)).find((item) => item.id === invitationId);
    if (!found) throw new AppError(404, ErrorCode.NOT_FOUND, 'Invitación no encontrada.');
    return found;
  }

  private toSummary(
    invitation: InvitationRow,
    context: {
      roleKey: string | null;
      roleName: string;
      creatorName: string;
      acceptedCount: number;
      now: Date;
    },
  ): InvitationSummary {
    return {
      id: invitation.id,
      projectId: invitation.projectId,
      roleId: invitation.roleId,
      roleKey: context.roleKey,
      roleName: context.roleName,
      status: deriveInvitationStatus(invitation, context.now),
      singleUse: invitation.singleUse,
      expiresAt: invitation.expiresAt ? invitation.expiresAt.toISOString() : null,
      restrictedEmail: invitation.restrictedEmail,
      createdAt: invitation.createdAt.toISOString(),
      createdBy: { id: invitation.createdBy, name: context.creatorName },
      acceptedCount: context.acceptedCount,
      disabledAt: invitation.disabledAt ? invitation.disabledAt.toISOString() : null,
    };
  }
}
