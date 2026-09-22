import { Inject, Injectable } from '@nestjs/common';
import {
  compareMoney,
  ErrorCode,
  type DecideWithdrawalInput,
  type RequestWithdrawalInput,
  type WithdrawalRequestSummary,
} from '@letfer/shared';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { expectUpdated, nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  financialMovements,
  houses,
  projectMembers,
  rolePermissions,
  stages,
  users,
  withdrawalRequests,
  type UserRow,
  type WithdrawalRequestRow,
} from '../database/schema/index.js';
import { fullName } from '../projects/project-mappers.js';
import { computeHouseBalances } from './balances.js';
import {
  assertFinanceReady,
  financeConflict,
  financeNotFound,
  insufficientBalance,
} from './finance-errors.js';

interface NameLookup {
  houseName: string;
  requestedByName: string;
  decidedByName: string | null;
}

function toSummary(request: WithdrawalRequestRow, names: NameLookup): WithdrawalRequestSummary {
  return {
    id: request.id,
    projectId: request.projectId,
    stageId: request.stageId,
    houseId: request.houseId,
    houseName: names.houseName,
    amount: request.amount,
    reason: request.reason,
    status: request.status,
    requestedBy: { id: request.requestedBy, name: names.requestedByName },
    requestedAt: request.createdAt.toISOString(),
    decidedBy: request.decidedBy
      ? { id: request.decidedBy, name: names.decidedByName ?? '' }
      : null,
    decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
    decisionReason: request.decisionReason,
    movementId: request.movementId,
    version: request.version,
  };
}

const notYourRequest = () =>
  new AppError(403, ErrorCode.FORBIDDEN, 'No puedes decidir sobre la solicitud de otra persona.');
const mustBeApprovedByOther = () =>
  new AppError(
    403,
    ErrorCode.FORBIDDEN,
    'Otro Administrador de Proyecto (o el Administrador Global) debe aprobar tu propia solicitud.',
  );

/**
 * Solicitudes de retiro (§16.2, §79, D5). El monto se reserva de inmediato (cuenta como
 * comprometido, §17) y solo se convierte en salida efectiva del ledger al aprobarse.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(access: ProjectAccess): Promise<WithdrawalRequestSummary[]> {
    const rows = await this.db
      .select({
        request: withdrawalRequests,
        houseName: houses.name,
      })
      .from(withdrawalRequests)
      .innerJoin(houses, eq(houses.id, withdrawalRequests.houseId))
      .where(eq(withdrawalRequests.projectId, access.project.id))
      .orderBy(desc(withdrawalRequests.createdAt));
    if (rows.length === 0) return [];

    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.request.requestedBy);
      if (row.request.decidedBy) userIds.add(row.request.decidedBy);
    }
    const names = await this.namesOf(this.db, [...userIds]);
    return rows.map((row) =>
      toSummary(row.request, {
        houseName: row.houseName,
        requestedByName: names.get(row.request.requestedBy) ?? '',
        decidedByName: row.request.decidedBy ? (names.get(row.request.decidedBy) ?? null) : null,
      }),
    );
  }

  /** Solicita un retiro: reserva el monto de inmediato (§16.2, §17). */
  async request(
    access: ProjectAccess,
    actor: UserRow,
    input: RequestWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    assertFinanceReady(access);
    const created = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const [house] = await tx.select().from(houses).where(eq(houses.id, input.houseId)).limit(1);
      if (!house || house.projectId !== access.project.id) {
        throw financeNotFound('Casa no encontrada.');
      }
      if (house.status !== 'ACTIVE') {
        throw financeConflict('La casa está desactivada.');
      }

      const balances = await computeHouseBalances(tx, access.project.id);
      const available = balances.get(input.houseId)?.available ?? '0.00';
      if (compareMoney(available, input.amount) < 0) throw insufficientBalance();

      const stageId = await this.currentStageId(tx, access.project.id);
      const [row] = await tx
        .insert(withdrawalRequests)
        .values({
          projectId: access.project.id,
          stageId,
          houseId: input.houseId,
          amount: input.amount,
          reason: input.reason,
          requestedBy: actor.id,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'withdrawal.requested',
        entityType: 'withdrawal_request',
        entityId: row!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: { houseId: input.houseId, amount: input.amount, reason: input.reason },
      });
      return row!;
    });
    return this.summaryOf(this.db, created);
  }

  /**
   * Aprueba la solicitud: genera el movimiento definitivo del ledger (D5). Si quien aprueba es
   * quien la solicitó, exige que no haya otro Administrador de Proyecto habilitado (§79); el
   * Administrador Global siempre puede aprobar según sus permisos globales.
   */
  async approve(
    access: ProjectAccess,
    actor: UserRow,
    requestId: string,
    input: DecideWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    const updated = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const request = await this.lockPending(tx, access.project.id, requestId);

      if (request.requestedBy === actor.id) {
        const other = await this.hasOtherEligibleApprover(tx, access.project.id, actor.id);
        if (other) throw mustBeApprovedByOther();
      }

      // La aprobación revalida el saldo dentro de la transacción (§79).
      const balances = await computeHouseBalances(tx, access.project.id);
      const balance = balances.get(request.houseId)?.balance ?? '0.00';
      if (compareMoney(balance, request.amount) < 0) throw insufficientBalance();

      const now = this.clock.now();
      const [movement] = await tx
        .insert(financialMovements)
        .values({
          projectId: access.project.id,
          stageId: request.stageId,
          type: 'WITHDRAWAL',
          direction: 'DEBIT',
          houseId: request.houseId,
          amount: request.amount,
          reason: request.reason,
          occurredAt: now,
          createdBy: actor.id,
        })
        .returning();

      const updated = expectUpdated(
        await tx
          .update(withdrawalRequests)
          .set({
            status: 'APPROVED',
            decidedBy: actor.id,
            decidedAt: now,
            movementId: movement!.id,
            version: nextVersion(withdrawalRequests.version),
          })
          .where(
            and(
              eq(withdrawalRequests.id, request.id),
              eq(withdrawalRequests.version, input.version),
            ),
          )
          .returning(),
        'withdrawal_requests',
      );

      await this.audit.record(tx, {
        action: 'withdrawal.approved',
        entityType: 'withdrawal_request',
        entityId: request.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: { movementId: movement!.id },
        metadata: { selfApproved: request.requestedBy === actor.id },
      });
      return updated;
    });
    return this.summaryOf(this.db, updated);
  }

  /** Rechaza la solicitud: libera la reserva sin dejar rastro en el ledger. */
  async reject(
    access: ProjectAccess,
    actor: UserRow,
    requestId: string,
    input: DecideWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    return this.decideWithoutMovement(
      access,
      actor,
      requestId,
      input,
      'REJECTED',
      'withdrawal.rejected',
    );
  }

  /** Cancela la propia solicitud (o, con permiso de aprobar, la de otra persona). */
  async cancel(
    access: ProjectAccess,
    actor: UserRow,
    requestId: string,
    input: DecideWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    return this.decideWithoutMovement(
      access,
      actor,
      requestId,
      input,
      'CANCELLED',
      'withdrawal.cancelled',
      (request) => {
        if (request.requestedBy !== actor.id && !access.permissions.has('withdrawals.approve')) {
          throw notYourRequest();
        }
      },
    );
  }

  private async decideWithoutMovement(
    access: ProjectAccess,
    actor: UserRow,
    requestId: string,
    input: DecideWithdrawalInput,
    status: 'REJECTED' | 'CANCELLED',
    action: string,
    check?: (request: WithdrawalRequestRow) => void,
  ): Promise<WithdrawalRequestSummary> {
    const updated = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const request = await this.lockPending(tx, access.project.id, requestId);
      check?.(request);

      const now = this.clock.now();
      const updated = expectUpdated(
        await tx
          .update(withdrawalRequests)
          .set({
            status,
            decidedBy: actor.id,
            decidedAt: now,
            decisionReason: input.reason ?? null,
            version: nextVersion(withdrawalRequests.version),
          })
          .where(
            and(
              eq(withdrawalRequests.id, request.id),
              eq(withdrawalRequests.version, input.version),
            ),
          )
          .returning(),
        'withdrawal_requests',
      );
      await this.audit.record(tx, {
        action,
        entityType: 'withdrawal_request',
        entityId: request.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: { status, reason: input.reason ?? null },
      });
      return updated;
    });
    return this.summaryOf(this.db, updated);
  }

  private async lockPending(
    executor: DbExecutor,
    projectId: string,
    requestId: string,
  ): Promise<WithdrawalRequestRow> {
    const [request] = await executor
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId))
      .for('update')
      .limit(1);
    if (!request || request.projectId !== projectId) {
      throw financeNotFound('Solicitud de retiro no encontrada.');
    }
    if (request.status !== 'PENDING') {
      throw financeConflict('Esta solicitud ya no está pendiente.');
    }
    return request;
  }

  /** ¿Hay, aparte de `excludeUserId`, otro miembro activo del proyecto que pueda aprobar retiros? */
  private async hasOtherEligibleApprover(
    executor: DbExecutor,
    projectId: string,
    excludeUserId: string,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, projectMembers.roleId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.status, 'ACTIVE'),
          ne(projectMembers.userId, excludeUserId),
          eq(rolePermissions.permissionCode, 'withdrawals.approve'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async currentStageId(executor: DbExecutor, projectId: string): Promise<string> {
    const [stage] = await executor
      .select({ id: stages.id })
      .from(stages)
      .where(and(eq(stages.projectId, projectId), eq(stages.status, 'ACTIVE')))
      .limit(1);
    // assertFinanceReady ya garantiza que el setup se completó (siempre hay una etapa activa).
    if (!stage) throw financeConflict('El proyecto todavía no tiene una etapa activa.');
    return stage.id;
  }

  private async namesOf(executor: DbExecutor, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await executor
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, userIds));
    return new Map(rows.map((row) => [row.id, fullName(row)]));
  }

  private async summaryOf(
    executor: DbExecutor,
    request: WithdrawalRequestRow,
  ): Promise<WithdrawalRequestSummary> {
    const [house] = await executor
      .select({ name: houses.name })
      .from(houses)
      .where(eq(houses.id, request.houseId))
      .limit(1);
    const userIds = [request.requestedBy, ...(request.decidedBy ? [request.decidedBy] : [])];
    const names = await this.namesOf(executor, userIds);
    return toSummary(request, {
      houseName: house?.name ?? '',
      requestedByName: names.get(request.requestedBy) ?? '',
      decidedByName: request.decidedBy ? (names.get(request.decidedBy) ?? null) : null,
    });
  }
}
