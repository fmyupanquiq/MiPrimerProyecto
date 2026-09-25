import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AccountDeletionRequestSummary,
  type AccountDeletionStatus,
  type DecideAccountDeletionInput,
  type RequestAccountDeletionInput,
} from '@letfer/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { expectUpdated, nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { PG_UNIQUE_VIOLATION, pgConstraintName, pgErrorCode } from '../database/pg-errors.js';
import {
  accountDeletionRequests,
  users,
  type AccountDeletionRequestRow,
  type UserRow,
} from '../database/schema/index.js';
import { UsersService } from '../users/users.service.js';
import { AccountProtectionService } from './account-protection.service.js';

const ONE_PENDING_CONSTRAINT = 'account_deletion_requests_one_pending';

const requestNotFound = () =>
  new AppError(404, ErrorCode.NOT_FOUND, 'Solicitud de eliminación no encontrada.');
const notPending = () =>
  new AppError(409, ErrorCode.INVALID_STATE, 'Esta solicitud ya no está pendiente.');

const fullName = (user: { firstName: string; lastName: string }) =>
  `${user.firstName} ${user.lastName}`.trim();

/**
 * Solicitudes de eliminación de cuenta (§8, §111.3, D8-5). La persona usuaria solicita, consulta y
 * cancela la suya; solo el Administrador Global aprueba o rechaza. Aprobar deja la cuenta
 * eliminada lógicamente (nunca de forma física) y cierra sus sesiones, salvo que la protección lo
 * impida (propietario de proyectos, último Administrador Global).
 */
@Injectable()
export class AccountDeletionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly protection: AccountProtectionService,
  ) {}

  /** La última solicitud de una persona (pendiente o ya decidida), o `null` si nunca pidió una. */
  async latestFor(userId: string): Promise<AccountDeletionRequestSummary | null> {
    const [request] = await this.db
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.userId, userId))
      .orderBy(desc(accountDeletionRequests.createdAt), desc(accountDeletionRequests.id))
      .limit(1);
    return request ? this.summaryOf(this.db, request) : null;
  }

  /** Solicitudes para el Administrador Global; las pendientes primero. */
  async list(status?: AccountDeletionStatus): Promise<AccountDeletionRequestSummary[]> {
    const requester = alias(users, 'requester');
    const decider = alias(users, 'decider');
    const rows = await this.db
      .select({ request: accountDeletionRequests, requester, decider })
      .from(accountDeletionRequests)
      .innerJoin(requester, eq(requester.id, accountDeletionRequests.userId))
      .leftJoin(decider, eq(decider.id, accountDeletionRequests.decidedBy))
      .where(status ? eq(accountDeletionRequests.status, status) : undefined)
      .orderBy(
        sql`(${accountDeletionRequests.status} = 'PENDING') DESC`,
        desc(accountDeletionRequests.createdAt),
        desc(accountDeletionRequests.id),
      );
    return rows.map(({ request, requester: who, decider: by }) => this.toSummary(request, who, by));
  }

  /** La persona pide eliminar su cuenta. Solo una solicitud pendiente a la vez. */
  async request(
    user: UserRow,
    input: RequestAccountDeletionInput,
  ): Promise<AccountDeletionRequestSummary> {
    try {
      const created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(accountDeletionRequests)
          .values({ userId: user.id, reason: input.reason ?? null })
          .returning();
        await this.audit.record(tx, {
          action: 'account_deletion.requested',
          entityType: 'account_deletion_request',
          entityId: row!.id,
          actorUserId: user.id,
          newValues: { userId: user.id, reason: input.reason ?? null },
        });
        return row!;
      });
      return await this.summaryOf(this.db, created);
    } catch (error) {
      if (
        pgErrorCode(error) === PG_UNIQUE_VIOLATION &&
        pgConstraintName(error) === ONE_PENDING_CONSTRAINT
      ) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Ya tienes una solicitud de eliminación de cuenta pendiente.',
        );
      }
      throw error;
    }
  }

  /** La persona retira su propia solicitud mientras siga pendiente. */
  async cancelOwn(user: UserRow): Promise<AccountDeletionRequestSummary> {
    const updated = await this.db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(accountDeletionRequests)
        .where(
          and(
            eq(accountDeletionRequests.userId, user.id),
            eq(accountDeletionRequests.status, 'PENDING'),
          ),
        )
        .for('update')
        .limit(1);
      if (!pending) throw requestNotFound();
      return this.decide(tx, pending, 'CANCELLED', user, {}, 'account_deletion.cancelled');
    });
    return this.summaryOf(this.db, updated);
  }

  async reject(
    actor: UserRow,
    requestId: string,
    input: DecideAccountDeletionInput,
  ): Promise<AccountDeletionRequestSummary> {
    const updated = await this.db.transaction(async (tx) => {
      const pending = await this.lockPending(tx, requestId);
      return this.decide(tx, pending, 'REJECTED', actor, input, 'account_deletion.rejected');
    });
    return this.summaryOf(this.db, updated);
  }

  /**
   * Aprueba: deja la cuenta eliminada lógicamente y cierra sus sesiones, todo en una transacción.
   * Si es propietaria de proyectos o es el último Administrador Global, se rechaza (y se audita el
   * intento) sin cambiar nada.
   */
  async approve(
    actor: UserRow,
    requestId: string,
    input: DecideAccountDeletionInput,
  ): Promise<AccountDeletionRequestSummary> {
    const [existing] = await this.db
      .select({ userId: accountDeletionRequests.userId })
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, requestId))
      .limit(1);
    if (!existing) throw requestNotFound();

    const updated = await this.protection.guard(
      { actor, targetUserId: existing.userId, attempted: 'delete' },
      async (tx) => {
        const pending = await this.lockPending(tx, requestId);
        const [target] = await tx
          .select()
          .from(users)
          .where(eq(users.id, pending.userId))
          .for('update')
          .limit(1);
        if (!target || target.status === 'DELETED') {
          throw new AppError(409, ErrorCode.INVALID_STATE, 'Esa cuenta ya está eliminada.');
        }
        await this.protection.assertCanDeactivate(tx, target);
        await this.users.setStatus(
          target.id,
          'DELETED',
          { actorUserId: actor.id, reason: 'account_deletion_request' },
          tx,
        );
        return this.decide(tx, pending, 'APPROVED', actor, input, 'account_deletion.approved');
      },
    );
    return this.summaryOf(this.db, updated);
  }

  private async lockPending(
    executor: DbExecutor,
    requestId: string,
  ): Promise<AccountDeletionRequestRow> {
    const [request] = await executor
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, requestId))
      .for('update')
      .limit(1);
    if (!request) throw requestNotFound();
    if (request.status !== 'PENDING') throw notPending();
    return request;
  }

  private async decide(
    executor: DbExecutor,
    request: AccountDeletionRequestRow,
    status: Exclude<AccountDeletionStatus, 'PENDING'>,
    decidedBy: UserRow,
    input: { version?: number; reason?: string | undefined },
    action: string,
  ): Promise<AccountDeletionRequestRow> {
    const updated = expectUpdated(
      await executor
        .update(accountDeletionRequests)
        .set({
          status,
          decidedBy: decidedBy.id,
          decidedAt: this.clock.now(),
          decisionReason: input.reason ?? null,
          version: nextVersion(accountDeletionRequests.version),
        })
        .where(
          and(
            eq(accountDeletionRequests.id, request.id),
            eq(accountDeletionRequests.version, input.version ?? request.version),
          ),
        )
        .returning(),
      'account_deletion_requests',
    );
    await this.audit.record(executor, {
      action,
      entityType: 'account_deletion_request',
      entityId: request.id,
      actorUserId: decidedBy.id,
      oldValues: { status: request.status },
      newValues: { status, reason: input.reason ?? null },
      metadata: { userId: request.userId },
    });
    return updated;
  }

  private async summaryOf(
    executor: DbExecutor,
    request: AccountDeletionRequestRow,
  ): Promise<AccountDeletionRequestSummary> {
    const [requester] = await executor
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);
    const [decider] = request.decidedBy
      ? await executor.select().from(users).where(eq(users.id, request.decidedBy)).limit(1)
      : [];
    return this.toSummary(request, requester!, decider ?? null);
  }

  private toSummary(
    request: AccountDeletionRequestRow,
    requester: UserRow,
    decider: UserRow | null,
  ): AccountDeletionRequestSummary {
    return {
      id: request.id,
      userId: request.userId,
      userName: fullName(requester),
      userEmail: requester.email,
      status: request.status,
      reason: request.reason,
      requestedAt: request.createdAt.toISOString(),
      decidedBy: decider ? { id: decider.id, name: fullName(decider) } : null,
      decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
      decisionReason: request.decisionReason,
      version: request.version,
    };
  }
}
