import { Inject, Injectable } from '@nestjs/common';
import {
  PROJECT_TRASH_RETENTION_DAYS,
  ZERO_MONEY,
  calculateBetReturn,
  compareMoney,
  type BetCorrectionEntry,
  type BetCorrectionKind,
  type BetLedgerEntry,
  type BetLedgerHistory,
  type CorrectSettlementInput,
  type CorrectionConflictInfo,
  type CorrectionLine,
  type CorrectionPreview,
  type MoneyString,
  type ReopenBetInput,
} from '@letfer/shared';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { diffFields } from '../audit/audit-values.js';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { expectUpdated, nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import {
  betCorrections,
  bets,
  financialMovements,
  houses,
  reconciliationCheckpoints,
  stages,
  users,
  type BetRow,
  type NewBet,
  type StageRow,
  type UserRow,
} from '../database/schema/index.js';
import { computeHouseBalances } from '../finance/balances.js';
import {
  applyBetLedgerPlan,
  assertAvailableNotNegative,
  betFinancialSnapshot,
  betHold,
  correctionConflict,
  derivedProfitLoss,
  desiredBetLedgerLines,
  effectiveBetAmount,
  pendingIdsOf,
  planBetLedgerChange,
  recordBetCorrection,
  type BetLedgerPlan,
} from '../finance/bet-ledger.js';
import { invalidateCheckpoints } from '../finance/checkpoint-invalidation.js';
import { fullName } from '../projects/project-mappers.js';
import { betConflict, betNotFound, invalidBetStructure } from './bet-errors.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Señal interna: una vista previa ejecuta la corrección completa y la revierte lanzando esto. */
class PreviewRollback extends Error {
  constructor(readonly preview: CorrectionPreview) {
    super('preview');
  }
}

interface CorrectionRequest {
  access: ProjectAccess;
  actor: UserRow;
  betId: string;
  kind: BetCorrectionKind;
  reason: string;
  /** Versión leída por el cliente; sin ella (papelera/restauración) basta el bloqueo de la fila. */
  expectedVersion?: number;
  /** La restauración opera sobre una apuesta que está en la papelera. */
  allowTrashed?: boolean;
  audit: { action: string; metadata?: Record<string, unknown> };
  /** Cambios que la corrección hace a la apuesta; lanza un error de negocio si no procede. */
  build: (bet: BetRow, stage: StageRow) => Partial<NewBet>;
}

/**
 * Correcciones financieras de apuestas liquidadas (§112.3, ADR 0019): corregir, reabrir, enviar a la
 * papelera y restaurar. Todas usan el mismo camino: bloquear el proyecto y la apuesta, aplicar el
 * cambio a la apuesta, calcular con el motor de §112.1 qué filas del ledger revertir y añadir,
 * validar la línea de tiempo (incluido el comprometido histórico, D-A5) y el disponible, registrar
 * la corrección, invalidar checkpoints (§112.5) y auditar. La vista previa ejecuta exactamente ese
 * camino y lo revierte, así que nunca puede diferir de lo que se aplicaría.
 *
 * Los valores previos de retorno calculado y oficial no se pierden al reabrir: la fila de la apuesta
 * los limpia (una pendiente no tiene retorno) pero `bet_corrections.before` y la auditoría los
 * conservan, y las filas del ledger anuladas siguen ahí con sus reversiones.
 */
@Injectable()
export class BetCorrectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  correctSettlement(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: CorrectSettlementInput,
  ): Promise<BetRow> {
    return this.apply(this.settlementRequest(access, actor, betId, input));
  }

  previewSettlementCorrection(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: CorrectSettlementInput,
  ): Promise<CorrectionPreview> {
    return this.preview(this.settlementRequest(access, actor, betId, input));
  }

  reopen(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: ReopenBetInput,
  ): Promise<BetRow> {
    return this.apply(this.reopenRequest(access, actor, betId, input));
  }

  previewReopen(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: ReopenBetInput,
  ): Promise<CorrectionPreview> {
    return this.preview(this.reopenRequest(access, actor, betId, input));
  }

  /** Papelera de una apuesta liquidada: reversión completa de su efecto (D-A7). */
  async trashSettled(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    reason: string,
  ): Promise<void> {
    await this.apply({
      access,
      actor,
      betId,
      kind: 'TRASH_REVERSAL',
      reason,
      audit: { action: 'bet.trashed', metadata: { ledgerReversal: true } },
      build: (bet) => {
        if (bet.status === 'PENDING') {
          throw betConflict('Una apuesta pendiente no tiene efecto en el ledger que revertir.');
        }
        const now = this.clock.now();
        return {
          deletedAt: now,
          deletionReason: reason,
          deletedBy: actor.id,
          purgeEligibleAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_DAYS * MS_PER_DAY),
        };
      },
    });
  }

  /** Restaura una apuesta liquidada: vuelve a registrar su efecto con filas nuevas (D-A7). */
  async restoreSettled(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    reason: string,
  ): Promise<void> {
    await this.apply({
      access,
      actor,
      betId,
      kind: 'RESTORE_REPOST',
      reason,
      allowTrashed: true,
      audit: { action: 'bet.restored', metadata: { ledgerRepost: true } },
      build: (bet) => {
        if (bet.deletedAt === null) throw betConflict('Esta apuesta no está en la papelera.');
        return { deletedAt: null, deletionReason: null, deletedBy: null, purgeEligibleAt: null };
      },
    });
  }

  /** Historial financiero de la apuesta: filas del ledger (con reversiones) y correcciones. */
  async history(access: ProjectAccess, betId: string): Promise<BetLedgerHistory> {
    const [bet] = await this.db
      .select({ id: bets.id })
      .from(bets)
      .where(and(eq(bets.id, betId), eq(bets.projectId, access.project.id)))
      .limit(1);
    if (!bet) throw betNotFound();

    const rows = await this.db
      .select({ row: financialMovements, houseName: houses.name })
      .from(financialMovements)
      .leftJoin(houses, eq(houses.id, financialMovements.houseId))
      .where(
        and(
          eq(financialMovements.projectId, access.project.id),
          eq(financialMovements.operationId, betId),
        ),
      )
      .orderBy(
        asc(financialMovements.occurredAt),
        asc(financialMovements.createdAt),
        asc(financialMovements.id),
      );
    const reversed = new Set(
      rows.flatMap(({ row }) => (row.reversesMovementId ? [row.reversesMovementId] : [])),
    );
    const movements: BetLedgerEntry[] = rows.map(({ row, houseName }) => ({
      id: row.id,
      type: row.type,
      direction: row.direction,
      houseId: row.houseId,
      houseName,
      amount: row.amount,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      reversesMovementId: row.reversesMovementId,
      correctionId: row.correctionId,
      live: row.type !== 'REVERSAL' && !reversed.has(row.id),
    }));

    const corrections = await this.db
      .select({ correction: betCorrections, firstName: users.firstName, lastName: users.lastName })
      .from(betCorrections)
      .innerJoin(users, eq(users.id, betCorrections.createdBy))
      .where(eq(betCorrections.betId, betId))
      .orderBy(asc(betCorrections.createdAt), asc(betCorrections.id));
    return {
      movements,
      corrections: corrections.map(({ correction, firstName, lastName }): BetCorrectionEntry => ({
        id: correction.id,
        kind: correction.kind,
        before: correction.before,
        after: correction.after,
        reason: correction.reason,
        createdBy: { id: correction.createdBy, name: fullName({ firstName, lastName }) },
        createdAt: correction.createdAt.toISOString(),
      })),
    };
  }

  // --- Solicitudes ---------------------------------------------------------------------------

  private settlementRequest(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: CorrectSettlementInput,
  ): CorrectionRequest {
    return {
      access,
      actor,
      betId,
      kind: 'SETTLEMENT_CORRECTION',
      reason: input.reason,
      expectedVersion: input.version,
      audit: { action: 'bet.settlement_corrected' },
      build: (bet, stage) => this.settlementPatch(bet, stage, input),
    };
  }

  private reopenRequest(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: ReopenBetInput,
  ): CorrectionRequest {
    return {
      access,
      actor,
      betId,
      kind: 'REOPEN',
      reason: input.reason,
      expectedVersion: input.version,
      audit: { action: 'bet.reopened' },
      build: (bet) => {
        if (bet.status === 'PENDING') throw betConflict('Esta apuesta ya está pendiente.');
        // Una pendiente no tiene retorno ni fecha de liquidación: la fila los limpia; los valores
        // anteriores quedan en `bet_corrections.before` y en la auditoría (no se pierde nada). La
        // nueva liquidación generará valores nuevos.
        // Un monto que solo era el calculado congelado al liquidar vuelve a seguir la unidad de la
        // etapa (§76); uno confirmado se conserva.
        return {
          status: 'PENDING',
          settledAt: null,
          settledTimeKnown: true,
          officialRealizedReturn: null,
          calculatedRealizedReturn: null,
          officialAmount: bet.amountConfirmed ? bet.officialAmount : null,
        };
      },
    };
  }

  /**
   * Cambios de una corrección de liquidación (§112.3): el estado, el monto oficial, el retorno y
   * las fechas. Lo que no se indica se conserva. El retorno calculado siempre se recalcula con el
   * monto vigente (una ganada); el oficial solo cambia si se indica (es la autoridad, §77).
   */
  private settlementPatch(
    bet: BetRow,
    stage: StageRow,
    input: CorrectSettlementInput,
  ): Partial<NewBet> {
    if (bet.status === 'PENDING') {
      throw betConflict(
        'Una apuesta pendiente se edita directamente; solo las liquidadas se corrigen.',
      );
    }
    const status = input.status ?? bet.status;
    const sameStatus = status === bet.status;
    const amount = input.officialAmount ?? bet.officialAmount ?? effectiveBetAmount(bet, stage);
    const amountChanged = amount !== bet.officialAmount;

    let official: MoneyString | null;
    let calculated: MoneyString | null = null;
    switch (status) {
      case 'LOST':
        official = null;
        break;
      case 'WON':
        official = input.officialRealizedReturn ?? (sameStatus ? bet.officialRealizedReturn : null);
        calculated = calculateBetReturn(amount, bet.visibleTotalOdds);
        break;
      case 'VOID':
        // Anulada: retorno = monto (§21.4). Si el monto cambió, el retorno anterior ya no vale.
        official =
          input.officialRealizedReturn ??
          (sameStatus && !amountChanged ? bet.officialRealizedReturn : amount);
        break;
      case 'CASHOUT':
        official = input.officialRealizedReturn ?? (sameStatus ? bet.officialRealizedReturn : null);
        if (official === null) throw invalidBetStructure('Un cash out exige el retorno oficial.');
        break;
      default:
        throw invalidBetStructure('Estado de liquidación no válido.');
    }

    const placedAt = input.placedAt ? new Date(input.placedAt) : bet.placedAt;
    const settledAt = input.settledAt ? new Date(input.settledAt) : bet.settledAt!;
    if (placedAt.getTime() > settledAt.getTime()) {
      throw invalidBetStructure(
        'La fecha de colocación no puede ser posterior a la de liquidación.',
      );
    }

    const patch: Partial<NewBet> = {
      status,
      officialAmount: amount,
      amountConfirmed: input.officialAmount !== undefined ? true : bet.amountConfirmed,
      officialRealizedReturn: official,
      calculatedRealizedReturn: calculated,
      placedAt,
      placedTimeKnown: input.placedTimeKnown ?? bet.placedTimeKnown,
      settledAt,
      settledTimeKnown: input.settledTimeKnown ?? bet.settledTimeKnown,
    };
    const unchanged =
      patch.status === bet.status &&
      patch.officialAmount === bet.officialAmount &&
      patch.amountConfirmed === bet.amountConfirmed &&
      patch.officialRealizedReturn === bet.officialRealizedReturn &&
      patch.calculatedRealizedReturn === bet.calculatedRealizedReturn &&
      placedAt.getTime() === bet.placedAt.getTime() &&
      patch.placedTimeKnown === bet.placedTimeKnown &&
      settledAt.getTime() === bet.settledAt!.getTime() &&
      patch.settledTimeKnown === bet.settledTimeKnown;
    if (unchanged) throw betConflict('La corrección no cambia nada.');
    return patch;
  }

  // --- Ejecución -----------------------------------------------------------------------------

  private async apply(request: CorrectionRequest): Promise<BetRow> {
    const { bet } = await this.execute(request, 'apply');
    return bet;
  }

  private async preview(request: CorrectionRequest): Promise<CorrectionPreview> {
    try {
      await this.execute(request, 'preview');
    } catch (error) {
      if (error instanceof PreviewRollback) return error.preview;
      throw error;
    }
    throw new Error('La vista previa debe revertirse siempre.');
  }

  private async execute(
    request: CorrectionRequest,
    mode: 'apply' | 'preview',
  ): Promise<{ bet: BetRow; preview: CorrectionPreview }> {
    const projectId = request.access.project.id;
    return this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${projectId}`);
      const [bet] = await tx
        .select()
        .from(bets)
        .where(and(eq(bets.id, request.betId), eq(bets.projectId, projectId)))
        .for('update')
        .limit(1);
      if (!bet) throw betNotFound();
      if (!request.allowTrashed && bet.deletedAt !== null) {
        throw betConflict('Esta apuesta está en la papelera: restáurala antes de continuar.');
      }
      const [stage] = await tx.select().from(stages).where(eq(stages.id, bet.stageId)).limit(1);
      const balancesBefore = await computeHouseBalances(tx, projectId);
      const now = this.clock.now();

      const patch = request.build(bet, stage!);
      const updated = expectUpdated(
        await tx
          .update(bets)
          .set({ ...patch, version: nextVersion(bets.version) })
          .where(
            and(
              eq(bets.id, bet.id),
              request.expectedVersion === undefined
                ? undefined
                : eq(bets.version, request.expectedVersion),
            ),
          )
          .returning(),
        'bets',
      );

      const plan = await planBetLedgerChange(tx, {
        projectId,
        betId: bet.id,
        desired: desiredBetLedgerLines(updated, stage!),
        now,
        subject: { before: betHold(bet, stage!), after: betHold(updated, stage!) },
      });
      if (mode === 'apply' && plan.conflicts.length > 0) throw correctionConflict(plan.conflicts);

      const beforeSnapshot = betFinancialSnapshot(bet);
      const afterSnapshot = betFinancialSnapshot(updated);
      const correction = await recordBetCorrection(tx, {
        projectId,
        betId: bet.id,
        kind: request.kind,
        before: beforeSnapshot,
        after: afterSnapshot,
        reason: request.reason,
        actorId: request.actor.id,
      });
      if (plan.conflicts.length === 0) {
        await applyBetLedgerPlan(tx, plan, {
          actorId: request.actor.id,
          correctionId: correction.id,
          reason: request.reason,
          stageId: updated.stageId,
        });
      }

      // Casas cuyo saldo o comprometido cambian: las del ledger y las de la apuesta.
      const affected = [...new Set([...plan.affectedHouseIds, bet.houseId, updated.houseId])];
      const balancesAfter = await computeHouseBalances(tx, projectId);
      const short = affected.filter(
        (houseId) =>
          compareMoney(balancesAfter.get(houseId)?.available ?? ZERO_MONEY, ZERO_MONEY) < 0,
      );
      if (mode === 'apply' && short.length > 0) {
        await assertAvailableNotNegative(tx, projectId, short);
      }

      const houseRows = await tx
        .select({ id: houses.id, name: houses.name })
        .from(houses)
        .where(eq(houses.projectId, projectId));
      const houseName = new Map(houseRows.map((row) => [row.id, row.name]));

      // Checkpoints `MATCHED` de las casas afectadas, de fecha igual o posterior a la fecha más
      // antigua de lo que cambia en el ledger (§112.5).
      const impacted =
        plan.changed && plan.earliestAffectedAt
          ? await tx
              .select({
                id: reconciliationCheckpoints.id,
                houseId: reconciliationCheckpoints.houseId,
                occurredAt: reconciliationCheckpoints.occurredAt,
              })
              .from(reconciliationCheckpoints)
              .where(
                and(
                  eq(reconciliationCheckpoints.projectId, projectId),
                  inArray(reconciliationCheckpoints.houseId, plan.affectedHouseIds),
                  eq(reconciliationCheckpoints.status, 'MATCHED'),
                  gte(reconciliationCheckpoints.occurredAt, plan.earliestAffectedAt),
                ),
              )
          : [];

      const preview = this.previewOf({
        kind: request.kind,
        plan,
        stage: stage!,
        bet,
        updated,
        beforeSnapshot,
        afterSnapshot,
        balancesBefore,
        balancesAfter,
        affected,
        short,
        impacted,
        houseName,
      });

      if (mode === 'preview') throw new PreviewRollback(preview);

      if (plan.changed && plan.earliestAffectedAt) {
        for (const houseId of plan.affectedHouseIds) {
          await invalidateCheckpoints(tx, {
            houseId,
            from: plan.earliestAffectedAt,
            reason: `Corrección financiera de una apuesta (${request.kind}) con efecto en el ledger en o antes de este checkpoint.`,
            now,
          });
        }
      }
      const diff = diffFields(beforeSnapshot, afterSnapshot);
      await this.audit.record(tx, {
        action: request.audit.action,
        entityType: 'bet',
        entityId: bet.id,
        projectId,
        actorUserId: request.actor.id,
        oldValues: diff?.oldValues ?? null,
        newValues: diff?.newValues ?? null,
        metadata: {
          correctionId: correction.id,
          reason: request.reason,
          ledgerChanged: plan.changed,
          reversedRows: plan.reversals.length,
          insertedRows: plan.inserts.length,
          ...request.audit.metadata,
        },
      });
      return { bet: updated, preview };
    });
  }

  private previewOf(input: {
    kind: BetCorrectionKind;
    plan: BetLedgerPlan;
    stage: StageRow;
    bet: BetRow;
    updated: BetRow;
    beforeSnapshot: Record<string, unknown>;
    afterSnapshot: Record<string, unknown>;
    balancesBefore: Awaited<ReturnType<typeof computeHouseBalances>>;
    balancesAfter: Awaited<ReturnType<typeof computeHouseBalances>>;
    affected: string[];
    short: string[];
    impacted: { id: string; houseId: string; occurredAt: Date }[];
    houseName: Map<string, string>;
  }): CorrectionPreview {
    const name = (houseId: string) => input.houseName.get(houseId) ?? '';
    const zero = { balance: ZERO_MONEY, committed: ZERO_MONEY, available: ZERO_MONEY };
    const reversals: CorrectionLine[] = input.plan.reversals.map((row) => ({
      type: 'REVERSAL',
      direction: row.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      houseId: row.houseId!,
      houseName: name(row.houseId!),
      amount: row.amount,
      occurredAt: row.occurredAt.toISOString(),
      reverses: row.type as 'BET_PLACEMENT' | 'BET_SETTLEMENT',
    }));
    const inserts: CorrectionLine[] = input.plan.inserts.map((line) => ({
      type: line.type,
      direction: line.direction,
      houseId: line.houseId,
      houseName: name(line.houseId),
      amount: line.amount,
      occurredAt: line.occurredAt.toISOString(),
    }));
    const conflicts: CorrectionConflictInfo[] = input.plan.conflicts.map((conflict) => ({
      houseId: conflict.houseId,
      houseName: name(conflict.houseId),
      occurredAt: conflict.occurredAt.toISOString(),
      balance: conflict.balance,
      movementIds: conflict.entryIds.filter((id) => !id.includes(':')),
      pendingIds: pendingIdsOf(conflict),
    }));
    const availabilityProblems = input.short.map((houseId) => ({
      houseId,
      houseName: name(houseId),
      available: input.balancesAfter.get(houseId)?.available ?? ZERO_MONEY,
    }));
    return {
      kind: input.kind,
      valid: conflicts.length === 0 && availabilityProblems.length === 0,
      ledgerChanged: input.plan.changed,
      reversals,
      inserts,
      balances: input.affected.map((houseId) => {
        const before = input.balancesBefore.get(houseId) ?? zero;
        const after = input.balancesAfter.get(houseId) ?? zero;
        return {
          houseId,
          houseName: name(houseId),
          balanceBefore: before.balance,
          balanceAfter: after.balance,
          availableBefore: before.available,
          availableAfter: after.available,
        };
      }),
      checkpointsToInvalidate: input.impacted.map((checkpoint) => ({
        id: checkpoint.id,
        houseId: checkpoint.houseId,
        houseName: name(checkpoint.houseId),
        occurredAt: checkpoint.occurredAt.toISOString(),
      })),
      conflicts,
      availabilityProblems,
      profitLossBefore: derivedProfitLoss(input.bet, input.stage),
      profitLossAfter: derivedProfitLoss(input.updated, input.stage),
      before: input.beforeSnapshot,
      after: input.afterSnapshot,
    };
  }
}
