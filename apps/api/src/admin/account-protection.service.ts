import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@letfer/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { pgConstraintName } from '../database/pg-errors.js';
import { roleIdByKey } from '../database/role-lookup.js';
import { projects, users, type UserRow } from '../database/schema/index.js';

/** Misma clave que el disparador `protect_last_global_admin` (migración 0027). */
export const GLOBAL_ADMINS_LOCK = 'users:global-admins';
const LAST_ADMIN_CONSTRAINT = 'users_last_global_admin';

/** Qué se intentaba hacer con la cuenta cuando la protección lo impidió. */
export type DeactivationAttempt = 'disable' | 'delete';

const BLOCKING_CODES: ReadonlySet<string> = new Set([
  ErrorCode.LAST_GLOBAL_ADMIN,
  ErrorCode.OWNS_PROJECTS,
]);

const lastGlobalAdmin = () =>
  new AppError(
    409,
    ErrorCode.LAST_GLOBAL_ADMIN,
    'No se puede deshabilitar ni eliminar al último Administrador Global activo: el sistema no puede quedarse sin capacidad administrativa.',
  );

const ownsProjects = (owned: { id: string; name: string }[]) =>
  new AppError(
    409,
    ErrorCode.OWNS_PROJECTS,
    'Esta cuenta es propietaria de proyectos. Transfiere su propiedad antes de deshabilitarla o eliminarla.',
    { details: { projects: owned.map(({ id, name }) => ({ id, name })) } },
  );

/**
 * Reglas que protegen al sistema al deshabilitar o eliminar una cuenta (§111.3, §111.4, D8-6,
 * D8-10): nunca el último Administrador Global activo y nunca a quien aún es propietario de
 * proyectos. Todo intento bloqueado queda auditado, **fuera** de la transacción que se revierte
 * (si se registrara dentro, el rechazo la deshacería y el intento no dejaría rastro).
 */
@Injectable()
export class AccountProtectionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Ejecuta `work` en una transacción que serializa las operaciones sobre Administradores
   * Globales. Si una regla de protección lo impide, audita el intento y propaga el error.
   */
  async guard<T>(
    input: { actor: UserRow; targetUserId: string; attempted: DeactivationAttempt },
    work: (tx: DbExecutor) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        // Primero el bloqueo lógico y después las filas: todas las rutas toman el mismo orden.
        await lockByKey(tx, GLOBAL_ADMINS_LOCK);
        return work(tx);
      });
    } catch (error) {
      const blocked = this.asBlockingError(error);
      if (blocked) {
        await this.recordBlocked(input, blocked);
        throw blocked;
      }
      throw error;
    }
  }

  /**
   * Comprueba, con la fila del usuario ya bloqueada dentro de una transacción de `guard`, que
   * puede deshabilitarse o eliminarse.
   */
  async assertCanDeactivate(executor: DbExecutor, target: UserRow): Promise<void> {
    if (await this.isLastActiveGlobalAdmin(executor, target)) throw lastGlobalAdmin();

    const owned = await executor
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.ownerId, target.id));
    if (owned.length > 0) throw ownsProjects(owned);
  }

  private async isLastActiveGlobalAdmin(executor: DbExecutor, target: UserRow): Promise<boolean> {
    if (target.status !== 'ACTIVE') return false;
    const adminRoleId = await roleIdByKey(executor, 'GLOBAL_ADMIN');
    if (target.globalRoleId !== adminRoleId) return false;
    const [others] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.globalRoleId, adminRoleId),
          eq(users.status, 'ACTIVE'),
          ne(users.id, target.id),
        ),
      );
    return (others?.count ?? 0) === 0;
  }

  /** Reconoce nuestros errores de protección, incluido el que lanza el disparador de la base. */
  private asBlockingError(error: unknown): AppError | null {
    if (error instanceof AppError && BLOCKING_CODES.has(error.code)) return error;
    if (pgConstraintName(error) === LAST_ADMIN_CONSTRAINT) return lastGlobalAdmin();
    return null;
  }

  private async recordBlocked(
    input: { actor: UserRow; targetUserId: string; attempted: DeactivationAttempt },
    blocked: AppError,
  ): Promise<void> {
    await this.audit.record(this.db, {
      action: 'admin.user_deactivation.blocked',
      entityType: 'user',
      entityId: input.targetUserId,
      actorUserId: input.actor.id,
      metadata: { attempted: input.attempted, reason: blocked.code },
    });
  }
}
