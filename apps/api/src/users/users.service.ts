import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_GLOBAL_ROLE_KEY,
  ErrorCode,
  normalizeEmail,
  type PublicUser,
  type UserStatus,
} from '@letfer/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { diffFields } from '../audit/audit-values.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import {
  expectUpdated,
  nextVersion,
  restoreValues,
  softDeleteValues,
} from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { roleIdByKey } from '../database/role-lookup.js';
import { PG_UNIQUE_VIOLATION, pgConstraintName, pgErrorCode } from '../database/pg-errors.js';
import { users, type UserRow } from '../database/schema/index.js';
import { SessionService } from '../sessions/session.service.js';

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  /** Clave del rol global; por defecto `USER` (§105.1). */
  globalRole?: string;
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
}

export const EMAIL_UNIQUE_CONSTRAINT = 'users_email_lower_unique';

/** Proyección segura de un usuario para la API: nunca incluye el hash de contraseña. */
export function toPublicUser(user: UserRow, globalRole: string): PublicUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    avatarRef: user.avatarRef,
    status: user.status,
    globalRole,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    version: user.version,
  };
}

/** Conversión del error de índice único del correo al error de negocio. */
export function emailInUseIfUniqueViolation(error: unknown): unknown {
  if (
    pgErrorCode(error) === PG_UNIQUE_VIOLATION &&
    pgConstraintName(error) === EMAIL_UNIQUE_CONSTRAINT
  ) {
    return new AppError(409, ErrorCode.EMAIL_IN_USE, 'Ese correo ya está registrado.');
  }
  return error;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async findById(id: string, executor: DbExecutor = this.db): Promise<UserRow | null> {
    const [user] = await executor.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  /** Busca por correo sin distinguir mayúsculas ni espacios en los extremos. */
  async findByEmail(email: string, executor: DbExecutor = this.db): Promise<UserRow | null> {
    const [user] = await executor
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .limit(1);
    return user ?? null;
  }

  /** Crea un usuario. El llamador decide qué auditar (p. ej. el bootstrap del administrador). */
  async create(input: CreateUserInput, executor: DbExecutor = this.db): Promise<UserRow> {
    try {
      const [user] = await executor
        .insert(users)
        .values({
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email: normalizeEmail(input.email),
          passwordHash: input.passwordHash,
          globalRoleId: await roleIdByKey(executor, input.globalRole ?? DEFAULT_GLOBAL_ROLE_KEY),
        })
        .returning();
      return user!;
    } catch (error) {
      throw emailInUseIfUniqueViolation(error);
    }
  }

  /**
   * Edita nombre y apellido con control de concurrencia optimista (§96) y auditoría campo por
   * campo (§24, §104.7). Falla con `ConcurrencyConflictError` si la versión ya cambió.
   */
  async updateProfile(
    userId: string,
    expectedVersion: number,
    patch: ProfilePatch,
    executor: DbExecutor = this.db,
  ): Promise<UserRow> {
    const changes: ProfilePatch = {};
    if (patch.firstName !== undefined) changes.firstName = patch.firstName.trim();
    if (patch.lastName !== undefined) changes.lastName = patch.lastName.trim();

    const [before] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
    const updated = expectUpdated(
      await executor
        .update(users)
        .set({ ...changes, version: nextVersion(users.version) })
        .where(and(eq(users.id, userId), eq(users.version, expectedVersion)))
        .returning(),
      'users',
    );

    const diff = before ? diffFields(before, updated, ['firstName', 'lastName']) : null;
    if (diff) {
      await this.audit.record(executor, {
        action: 'user.profile.updated',
        entityType: 'user',
        entityId: userId,
        ...diff,
      });
    }
    return updated;
  }

  /**
   * Cambia el estado de cuenta (§104.6). `DELETED` es un borrado lógico con motivo y autor;
   * volver a `ACTIVE` lo restaura. Se audita con el estado anterior y el nuevo (§104.7).
   */
  async setStatus(
    userId: string,
    status: UserStatus,
    options: { actorUserId?: string | null; reason?: string; expectedVersion?: number },
    executor: DbExecutor = this.db,
  ): Promise<UserRow> {
    const [before] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!before) throw new AppError(404, ErrorCode.NOT_FOUND, 'Usuario no encontrado.');

    const deletion =
      status === 'DELETED'
        ? {
            ...softDeleteValues({ now: this.clock.now(), reason: options.reason }),
            deletedBy: options.actorUserId ?? null,
          }
        : { ...restoreValues(), deletedBy: null };

    // Con `expectedVersion` (§96) una edición sobre datos ya cambiados falla en vez de pisarlos.
    const changed = await executor
      .update(users)
      .set({ status, ...deletion, version: nextVersion(users.version) })
      .where(
        and(
          eq(users.id, userId),
          options.expectedVersion === undefined
            ? undefined
            : eq(users.version, options.expectedVersion),
        ),
      )
      .returning();
    const updated =
      options.expectedVersion === undefined ? changed[0]! : expectUpdated(changed, 'users');

    // Desactivar o eliminar la cuenta cierra sus sesiones (§104.6); reactivarla no las revive.
    const revokedSessions =
      status === 'ACTIVE'
        ? 0
        : await this.sessions.revokeAllForUser(
            userId,
            `account_${status.toLowerCase()}`,
            {},
            executor,
          );

    await this.audit.record(executor, {
      action: 'user.status.changed',
      entityType: 'user',
      entityId: userId,
      ...(options.actorUserId !== undefined && { actorUserId: options.actorUserId }),
      oldValues: { status: before.status },
      newValues: { status },
      metadata: { ...(options.reason && { reason: options.reason }), revokedSessions },
    });
    return updated;
  }

  /** Registra el último acceso (§2). */
  async markLogin(userId: string, executor: DbExecutor = this.db): Promise<void> {
    await executor.update(users).set({ lastLoginAt: this.clock.now() }).where(eq(users.id, userId));
  }
}
