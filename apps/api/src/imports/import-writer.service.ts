import {
  ErrorCode,
  PROJECT_TRASH_RETENTION_DAYS,
  ZERO_MONEY,
  addMoney,
  calculateBetReturn,
  compareMoney,
  type ImportBatchAnnulResult,
  type ImportBatchReport,
  type ImportBatchWriteResult,
  type ImportWarning,
  type MoneyString,
} from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  betSelections,
  bets,
  financialMovements,
  houses,
  importBatches,
  importRows,
  projects,
  reconciliationCheckpoints,
  stages,
  withdrawalRequests,
  type BetRow,
  type StageRow,
} from '../database/schema/index.js';
import { deriveBetType } from '../bets/bets.service.js';
import { computeHouseBalances } from '../finance/balances.js';
import {
  applyBetLedgerPlan,
  assertAvailableNotNegative,
  betFinancialSnapshot,
  betHold,
  correctionConflict,
  desiredBetLedgerLines,
  derivedProfitLoss,
  holdEntry,
  liveBetLedgerRows,
  recordBetCorrection,
  signedEntry,
  type BetLedgerPlan,
} from '../finance/bet-ledger.js';
import {
  findWorstOrderConflicts,
  newTimelineConflicts,
  type TimelineEntry,
} from '../finance/bet-ledger-timeline.js';
import { invalidateCheckpoints } from '../finance/checkpoint-invalidation.js';
import { ImportAuditService } from './import-audit.service.js';
import { validateImportInput } from './import-input-validation.js';
import {
  IMPORT_ANNULMENT_FIXED_REASON,
  type ImportBatchAnnulInput,
  type ImportBatchWriteInput,
} from './import-types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Todas las columnas del lote salvo el archivo original (hasta 10 MB), que aquí no hace falta.
const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;
type BatchRow = Omit<typeof importBatches.$inferSelect, 'sourceFile'>;

const invalidState = (message: string): AppError =>
  new AppError(409, ErrorCode.INVALID_STATE, message);

/**
 * Escritor de importación histórica (Fase 9.1.5, §113, ADR 0020, D-X27). Recibe datos ya
 * normalizados y los escribe en una sola transacción bajo el bloqueo financiero del proyecto:
 * etapas del lote, capital inicial histórico y apuestas, con las filas del ledger generadas por el
 * motor de la Fase 8.5 (`desiredBetLedgerLines`, `applyBetLedgerPlan`). **No** reutiliza
 * `BetsService.create/settle`: comprueban el disponible de hoy, exigen etapa activa, auditan por
 * apuesta e invalidan checkpoints, todo pensado para la operación diaria.
 *
 * - Antes de escribir se valida la línea de tiempo **completa del lote** (los instantes se evalúan
 *   agrupados, sin inventar un orden dentro del mismo, D-X16) y, después, el disponible y que el
 *   saldo del ledger sea exactamente el esperado (capital + ganancia/pérdida de las apuestas). Si algo
 *   falla, la transacción se revierte entera.
 * - Anular un lote revierte con `REVERSAL` lo que escribió, elimina lógicamente sus apuestas con el
 *   motivo fijo "Lote anulado" (D-X25) y anula sus etapas si quedaron vacías. Nunca borra nada.
 *
 * Quien llama debe haber comprobado ya el permiso `import.run`, la reautenticación y, en una
 * importación real, el backup reciente (§113.9): este servicio recibe la operación autorizada.
 */
@Injectable()
export class ImportWriterService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: ImportAuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Importar
  // ---------------------------------------------------------------------------------------------

  async importBatch(input: ImportBatchWriteInput): Promise<ImportBatchWriteResult> {
    const issues = validateImportInput(input);
    if (issues.length > 0) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'El lote contiene datos no válidos.', {
        details: { issues },
      });
    }

    return this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${input.projectId}`);
      const batch = await this.lockBatch(tx, input.projectId, input.batchId);
      if (batch.status === 'IMPORTED' || batch.status === 'ANNULLED') {
        throw invalidState('Este lote ya se importó: no se puede importar dos veces.');
      }
      if (batch.status !== 'VALIDATED' || batch.houseId === null) {
        throw invalidState('El lote debe estar validado, con su casa confirmada, para importarse.');
      }
      const houseId = batch.houseId;
      await this.assertProjectFit(tx, input, batch);

      const now = this.clock.now();

      // --- Estado previo de la casa (sin haber escrito nada todavía) -------------------------
      const balanceBefore =
        (await computeHouseBalances(tx, input.projectId)).get(houseId)?.balance ?? ZERO_MONEY;
      const existing = await this.houseTimeline(tx, input.projectId, houseId, []);

      // --- Filas de staging que enlazarán su apuesta ------------------------------------------
      const rowNumbers = input.bets.flatMap((bet) => (bet.rowNumber ? [bet.rowNumber] : []));
      if (rowNumbers.length > 0) await this.assertStagingRows(tx, batch.id, rowNumbers);

      // --- Etapas del lote --------------------------------------------------------------------
      const stageByKey = new Map<string, StageRow>();
      for (const stage of input.stages) {
        const [created] = await tx
          .insert(stages)
          .values({
            projectId: input.projectId,
            name: stage.name.trim(),
            unitStake: stage.unitStake,
            status: stage.status,
            startsAt: stage.startsAt,
            batchId: batch.id,
          })
          .returning();
        stageByKey.set(stage.key, created!);
      }

      // --- Apuestas (sin ledger todavía) ------------------------------------------------------
      const created: { bet: BetRow; stage: StageRow; rowNumber: number | undefined }[] = [];
      const ordered = [...input.bets].sort(
        (a, b) =>
          a.placedAt.getTime() - b.placedAt.getTime() || (a.rowNumber ?? 0) - (b.rowNumber ?? 0),
      );
      for (const item of ordered) {
        const stage = stageByKey.get(item.stageKey)!;
        const settled = item.status !== 'PENDING';
        const [bet] = await tx
          .insert(bets)
          .values({
            projectId: input.projectId,
            stageId: stage.id,
            houseId,
            createdBy: input.actorUserId,
            batchId: batch.id,
            betType: deriveBetType(item.selections),
            stakeAmount: item.stake,
            // El monto del archivo es el oficial NO confirmado (D-X19).
            officialAmount: item.amount,
            amountConfirmed: false,
            visibleTotalOdds: item.visibleTotalOdds,
            status: item.status,
            // Una ganada importada queda provisional: retorno calculado por LetFer, sin oficial (D-X4).
            calculatedRealizedReturn:
              item.status === 'WON' ? calculateBetReturn(item.amount, item.visibleTotalOdds) : null,
            officialRealizedReturn: null,
            placedAt: item.placedAt,
            placedTimeKnown: item.placedTimeKnown,
            settledAt: settled ? (item.settledAt ?? item.placedAt) : null,
            settledTimeKnown: settled ? item.settledTimeKnown : true,
            reason: item.reason?.trim() ? item.reason.trim() : null,
          })
          .returning();
        await tx.insert(betSelections).values(
          item.selections.map((selection) => ({
            betId: bet!.id,
            eventGroup: selection.eventGroup,
            position: selection.position,
            sport: selection.sport ?? null,
            event: selection.event,
            market: selection.market ?? null,
            selection: selection.selection,
            visibleOdds: selection.visibleOdds,
          })),
        );
        created.push({ bet: bet!, stage, rowNumber: item.rowNumber });
      }

      // --- Validación de la línea de tiempo completa del lote ---------------------------------
      const lines = created.map(({ bet, stage }) => ({
        bet,
        stage,
        lines: desiredBetLedgerLines(bet, stage),
      }));
      const capital = input.initialCapital;
      const newEntries: TimelineEntry[] = [];
      if (capital) {
        newEntries.push({
          id: 'plan:initial-capital',
          occurredAt: capital.occurredAt,
          effects: [{ houseId, direction: 'CREDIT', amount: capital.amount }],
        });
      }
      for (const { bet, lines: betLines } of lines) {
        betLines.forEach((line, index) =>
          newEntries.push(
            signedEntry(`plan:bet:${bet.id}:${index}`, {
              ...line,
              fromHouseId: null,
              toHouseId: null,
            }),
          ),
        );
      }
      for (const { bet, stage } of lines) {
        const hold = betHold(bet, stage);
        if (hold) newEntries.push(holdEntry(`hold:bet:${bet.id}`, hold));
      }
      const houseSet = new Set([houseId]);
      const after = [...existing, ...newEntries];
      const conflicts = newTimelineConflicts(existing, after, houseSet);
      if (conflicts.length > 0) throw correctionConflict(conflicts);
      const worstBefore = new Set(
        findWorstOrderConflicts(existing, houseSet).map(
          (c) => `${c.houseId}|${c.occurredAt.getTime()}`,
        ),
      );
      const warnings: ImportWarning[] = findWorstOrderConflicts(after, houseSet)
        .filter((c) => !worstBefore.has(`${c.houseId}|${c.occurredAt.getTime()}`))
        .map((c) => ({
          code: 'WORST_ORDER_NEGATIVE_BALANCE',
          houseId: c.houseId,
          occurredAt: c.occurredAt.toISOString(),
          balance: c.balance,
          message:
            'Si las filas de un mismo instante ocurrieran en el peor orden, el saldo quedaría negativo. ' +
            'El saldo agrupado por instante es válido.',
        }));

      // --- Escritura en el ledger --------------------------------------------------------------
      let capitalMovementId: string | null = null;
      let ledgerRows = 0;
      if (capital) {
        const [row] = await tx
          .insert(financialMovements)
          .values({
            projectId: input.projectId,
            stageId: stageByKey.get(capital.stageKey)!.id,
            type: 'INITIAL_CAPITAL',
            direction: 'CREDIT',
            houseId,
            amount: capital.amount,
            // Fecha histórica del movimiento; nunca la hora del servidor.
            occurredAt: capital.occurredAt,
            occurredAtKnown: capital.occurredAtKnown,
            batchId: batch.id,
            createdBy: input.actorUserId,
          })
          .returning({ id: financialMovements.id });
        capitalMovementId = row!.id;
        ledgerRows += 1;
      }
      let profitLoss: MoneyString = ZERO_MONEY;
      for (const { bet, stage, lines: betLines } of lines) {
        const plan: BetLedgerPlan = {
          projectId: input.projectId,
          betId: bet.id,
          reversals: [],
          inserts: betLines,
          kept: [],
          changed: betLines.length > 0,
          affectedHouseIds: [houseId],
          earliestAffectedAt: null,
          conflicts: [],
        };
        const applied = await applyBetLedgerPlan(tx, plan, {
          actorId: input.actorUserId,
          correctionId: null,
          stageId: stage.id,
          batchId: batch.id,
        });
        ledgerRows += applied.insertedIds.length;
        const profit = derivedProfitLoss(bet, stage);
        if (profit !== null) profitLoss = addMoney(profitLoss, profit);
      }

      // --- Verificación: disponible y saldo exacto ---------------------------------------------
      await assertAvailableNotNegative(tx, input.projectId, [houseId]);
      const balanceAfter =
        (await computeHouseBalances(tx, input.projectId)).get(houseId)?.balance ?? ZERO_MONEY;
      const expected = addMoney(balanceBefore, capital?.amount ?? ZERO_MONEY, profitLoss);
      if (compareMoney(balanceAfter, expected) !== 0) {
        throw new Error(
          `Invariante financiera rota al importar el lote ${batch.id}: saldo ${balanceAfter}, esperado ${expected}.`,
        );
      }

      // --- Enlaza las filas de staging con las apuestas creadas --------------------------------
      for (const { bet, rowNumber } of created) {
        if (rowNumber === undefined) continue;
        await tx
          .update(importRows)
          .set({ createdBetId: bet.id })
          .where(and(eq(importRows.importBatchId, batch.id), eq(importRows.rowNumber, rowNumber)));
      }

      // --- Informe y lote importado ------------------------------------------------------------
      const count = (status: 'WON' | 'LOST' | 'PENDING') =>
        input.bets.filter((bet) => bet.status === status).length;
      const report: ImportBatchReport = {
        houseId,
        stages: input.stages.length,
        initialCapital: capital?.amount ?? null,
        bets: {
          total: input.bets.length,
          won: count('WON'),
          lost: count('LOST'),
          pending: count('PENDING'),
        },
        ledgerRows,
        profitLoss,
        balanceBefore,
        balanceAfter,
        warnings,
      };
      const [imported] = await tx
        .update(importBatches)
        .set({
          status: 'IMPORTED',
          importedAt: now,
          importedBy: input.actorUserId,
          importReason: input.reason.trim(),
          isRehearsal: input.isRehearsal ?? false,
          stagePlan: {
            stages: input.stages.map((stage) => ({
              key: stage.key,
              name: stage.name,
              unitStake: stage.unitStake,
              startsAt: stage.startsAt ? stage.startsAt.toISOString() : null,
              status: stage.status,
            })),
          },
          report,
          version: nextVersion(importBatches.version),
        })
        .where(eq(importBatches.id, batch.id))
        .returning(BATCH_COLUMNS);
      await this.audit.imported(tx, imported!, input.actorUserId, { reason: input.reason.trim() });

      return {
        batch: imported!,
        stageIds: input.stages.map((stage) => stageByKey.get(stage.key)!.id),
        initialCapitalMovementId: capitalMovementId,
        betIds: created.map(({ bet }) => bet.id),
        report,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Anular
  // ---------------------------------------------------------------------------------------------

  async annulBatch(input: ImportBatchAnnulInput): Promise<ImportBatchAnnulResult> {
    if (!input.reason?.trim()) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El motivo de la anulación es obligatorio.',
      );
    }
    return this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${input.projectId}`);
      const batch = await this.lockBatch(tx, input.projectId, input.batchId);
      if (batch.status === 'ANNULLED') throw invalidState('Este lote ya está anulado.');
      if (batch.status !== 'IMPORTED' || batch.houseId === null) {
        throw invalidState('Solo se puede anular un lote que ya fue importado.');
      }
      const houseId = batch.houseId;
      const now = this.clock.now();
      const fixed = IMPORT_ANNULMENT_FIXED_REASON;

      const batchBets = await tx
        .select({ bet: bets, stage: stages })
        .from(bets)
        .innerJoin(stages, eq(stages.id, bets.stageId))
        .where(and(eq(bets.projectId, input.projectId), eq(bets.batchId, batch.id)))
        .for('update', { of: bets });
      const capitalRows = await this.liveCapitalRows(tx, input.projectId, batch.id);

      // --- Qué se revierte y si la línea de tiempo resultante es válida -------------------------
      const plans = new Map<string, BetLedgerPlan>();
      for (const { bet } of batchBets) {
        const live = await liveBetLedgerRows(tx, input.projectId, bet.id);
        plans.set(bet.id, {
          projectId: input.projectId,
          betId: bet.id,
          reversals: live,
          inserts: [],
          kept: [],
          changed: live.length > 0,
          affectedHouseIds: [houseId],
          earliestAffectedAt: live.length > 0 ? live[0]!.occurredAt : null,
          conflicts: [],
        });
      }
      const batchBetIds = new Set(batchBets.map(({ bet }) => bet.id));
      const before = await this.houseTimeline(tx, input.projectId, houseId, []);
      const reversed = [...plans.values()].flatMap((plan) => plan.reversals).concat(capitalRows);
      // Las pendientes del lote dejan de reservar saldo al anularse.
      const batchPendingHoldIds = new Set(
        batchBets
          .filter(({ bet, stage }) => betHold(bet, stage) !== null)
          .map(({ bet }) => `hold:bet:${bet.id}`),
      );
      const after: TimelineEntry[] = [
        ...before.filter((entry) => !batchPendingHoldIds.has(entry.id)),
        ...reversed.map((row) => signedEntry(`plan:reversal:${row.id}`, row, true)),
      ];
      const conflicts = newTimelineConflicts(before, after, new Set([houseId]));
      if (conflicts.length > 0) throw correctionConflict(conflicts);

      // --- Apuestas: reversión del ledger y eliminación lógica --------------------------------
      const annulledBetIds: string[] = [];
      const reversedMovementIds: string[] = [];
      let earliest: Date | null = null;
      for (const { bet, stage } of batchBets) {
        const plan = plans.get(bet.id)!;
        if (plan.reversals.length > 0) {
          const correction = await recordBetCorrection(tx, {
            projectId: input.projectId,
            betId: bet.id,
            kind: 'TRASH_REVERSAL',
            before: betFinancialSnapshot(bet),
            after: { ...betFinancialSnapshot(bet), trashed: true },
            reason: fixed,
            actorId: input.actorUserId,
          });
          const applied = await applyBetLedgerPlan(tx, plan, {
            actorId: input.actorUserId,
            correctionId: correction.id,
            reason: fixed,
            stageId: stage.id,
            batchId: batch.id,
          });
          reversedMovementIds.push(...applied.reversalIds);
          for (const row of plan.reversals) {
            if (earliest === null || row.occurredAt < earliest) earliest = row.occurredAt;
          }
        }
        if (bet.deletedAt === null) {
          await tx
            .update(bets)
            .set({
              deletedAt: now,
              deletionReason: fixed,
              deletedBy: input.actorUserId,
              purgeEligibleAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_DAYS * MS_PER_DAY),
              version: nextVersion(bets.version),
            })
            .where(eq(bets.id, bet.id));
          annulledBetIds.push(bet.id);
        }
      }

      // --- Capital inicial del lote --------------------------------------------------------------
      for (const row of capitalRows) {
        const [reversal] = await tx
          .insert(financialMovements)
          .values({
            projectId: row.projectId,
            stageId: row.stageId,
            type: 'REVERSAL',
            direction: row.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
            houseId: row.houseId,
            amount: row.amount,
            operationId: row.operationId,
            occurredAt: row.occurredAt,
            // La reversión copia la misma fecha que la fila original: si esa fecha era un instante
            // técnico (D-X29), la reversión sigue siéndolo. No confundir con una fecha nueva y conocida.
            occurredAtKnown: row.occurredAtKnown,
            reversesMovementId: row.id,
            reason: fixed,
            batchId: batch.id,
            createdBy: input.actorUserId,
          })
          .returning({ id: financialMovements.id });
        reversedMovementIds.push(reversal!.id);
        if (earliest === null || row.occurredAt < earliest) earliest = row.occurredAt;
      }

      // Una conciliación posterior al import dejó de ser cierta si el ledger cambió (§112.5).
      if (earliest !== null) {
        await invalidateCheckpoints(tx, {
          houseId,
          from: earliest,
          reason:
            'Se anuló un lote de importación con filas fechadas en o antes de este checkpoint.',
          now,
        });
      }

      // --- Etapas del lote: se anulan si quedaron vacías ------------------------------------------
      const annulledStageIds: string[] = [];
      const keptStageIds: string[] = [];
      const batchStages = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.projectId, input.projectId), eq(stages.batchId, batch.id)))
        .for('update');
      for (const stage of batchStages) {
        if (stage.deletedAt !== null) continue;
        const [foreignBet] = await tx
          .select({ id: bets.id })
          .from(bets)
          .where(
            and(
              eq(bets.stageId, stage.id),
              isNull(bets.deletedAt),
              or(isNull(bets.batchId), eq(bets.batchId, batch.id)),
            ),
          )
          .limit(1);
        const [foreignMovement] = await tx
          .select({ id: financialMovements.id })
          .from(financialMovements)
          .where(and(eq(financialMovements.stageId, stage.id), isNull(financialMovements.batchId)))
          .limit(1);
        if (foreignBet || foreignMovement) {
          keptStageIds.push(stage.id);
          continue;
        }
        await tx
          .update(stages)
          .set({
            status: 'TRASHED',
            deletedAt: now,
            deletionReason: fixed,
            deletedBy: input.actorUserId,
            purgeEligibleAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_DAYS * MS_PER_DAY),
            version: nextVersion(stages.version),
          })
          .where(eq(stages.id, stage.id));
        annulledStageIds.push(stage.id);
      }

      // --- Verificación: ninguna fila vigente del lote --------------------------------------------
      const stillLive = await this.liveCapitalRows(tx, input.projectId, batch.id);
      for (const betId of batchBetIds) {
        const live = await liveBetLedgerRows(tx, input.projectId, betId);
        if (live.length > 0) stillLive.push(...live);
      }
      if (stillLive.length > 0) {
        throw new Error(`Al anular el lote ${batch.id} quedaron filas vigentes en el ledger.`);
      }
      await assertAvailableNotNegative(tx, input.projectId, [houseId]);

      const [annulled] = await tx
        .update(importBatches)
        .set({
          status: 'ANNULLED',
          annulledAt: now,
          annulledBy: input.actorUserId,
          annulmentReason: input.reason.trim(),
          version: nextVersion(importBatches.version),
        })
        .where(eq(importBatches.id, batch.id))
        .returning(BATCH_COLUMNS);
      await this.audit.annulled(tx, annulled!, input.actorUserId, { reason: input.reason.trim() });

      return {
        batch: annulled!,
        annulledBetIds,
        reversedMovementIds,
        annulledStageIds,
        keptStageIds,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Auxiliares
  // ---------------------------------------------------------------------------------------------

  private async lockBatch(tx: DbExecutor, projectId: string, batchId: string): Promise<BatchRow> {
    const [batch] = await tx
      .select(BATCH_COLUMNS)
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.projectId, projectId)))
      .for('update')
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    return batch;
  }

  /**
   * Un proyecto es apto para importar (D-X1): activo, con su configuración inicial completa, con la
   * casa activa y sin actividad ordinaria ni conciliaciones en ella, y sin otro lote importado con
   * el mismo archivo. Un archivo se importa una sola vez por casa mientras su lote siga vigente.
   */
  private async assertProjectFit(
    tx: DbExecutor,
    input: ImportBatchWriteInput,
    batch: BatchRow,
  ): Promise<void> {
    const houseId = batch.houseId!;
    const [project] = await tx
      .select({ status: projects.status, setupCompletedAt: projects.setupCompletedAt })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project || project.status !== 'ACTIVE' || project.setupCompletedAt === null) {
      throw invalidState('El proyecto debe estar activo y con su configuración inicial completa.');
    }
    const [house] = await tx
      .select({ status: houses.status })
      .from(houses)
      .where(and(eq(houses.id, houseId), eq(houses.projectId, input.projectId)))
      .limit(1);
    if (!house || house.status !== 'ACTIVE') {
      throw invalidState('La casa del lote no existe en el proyecto o no está activa.');
    }

    const [duplicate] = await tx
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.projectId, input.projectId),
          eq(importBatches.houseId, houseId),
          eq(importBatches.sourceSha256, batch.sourceSha256),
          eq(importBatches.status, 'IMPORTED'),
        ),
      )
      .limit(1);
    if (duplicate) throw invalidState('Este archivo ya se importó en esa casa.');

    const [ordinaryBet] = await tx
      .select({ id: bets.id })
      .from(bets)
      .where(and(eq(bets.houseId, houseId), isNull(bets.batchId)))
      .limit(1);
    const [ordinaryMovement] = await tx
      .select({ id: financialMovements.id })
      .from(financialMovements)
      .where(
        and(
          isNull(financialMovements.batchId),
          or(
            eq(financialMovements.houseId, houseId),
            eq(financialMovements.fromHouseId, houseId),
            eq(financialMovements.toHouseId, houseId),
          ),
        ),
      )
      .limit(1);
    const [checkpoint] = await tx
      .select({ id: reconciliationCheckpoints.id })
      .from(reconciliationCheckpoints)
      .where(eq(reconciliationCheckpoints.houseId, houseId))
      .limit(1);
    if (ordinaryBet || ordinaryMovement || checkpoint) {
      throw invalidState(
        'La casa ya tiene apuestas, movimientos o conciliaciones ajenos a un lote: importa en un proyecto de ensayo.',
      );
    }

    if (input.stages.some((stage) => stage.status === 'ACTIVE')) {
      const [active] = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.projectId, input.projectId), eq(stages.status, 'ACTIVE')))
        .limit(1);
      if (active) {
        throw invalidState(
          'El proyecto ya tiene una etapa activa: las rondas del lote deben quedar cerradas.',
        );
      }
    }
  }

  /** Cada fila referida existe en el lote y es válida (solo esas pueden enlazar una apuesta). */
  private async assertStagingRows(
    tx: DbExecutor,
    batchId: string,
    rowNumbers: readonly number[],
  ): Promise<void> {
    const rows = await tx
      .select({ rowNumber: importRows.rowNumber, status: importRows.status })
      .from(importRows)
      .where(
        and(eq(importRows.importBatchId, batchId), inArray(importRows.rowNumber, [...rowNumbers])),
      );
    const valid = new Set(rows.filter((row) => row.status === 'VALID').map((row) => row.rowNumber));
    const missing = rowNumbers.filter((number) => !valid.has(number));
    if (missing.length > 0) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'El lote contiene datos no válidos.', {
        details: {
          issues: missing.map((number) => `La fila ${number} no existe en el lote o no es válida.`),
        },
      });
    }
  }

  /** Filas del ledger de la casa y reservas de sus pendientes y retiros, como línea de tiempo. */
  private async houseTimeline(
    tx: DbExecutor,
    projectId: string,
    houseId: string,
    excludeBetIds: readonly string[],
  ): Promise<TimelineEntry[]> {
    const rows = await tx
      .select()
      .from(financialMovements)
      .where(
        and(
          eq(financialMovements.projectId, projectId),
          or(
            eq(financialMovements.houseId, houseId),
            eq(financialMovements.fromHouseId, houseId),
            eq(financialMovements.toHouseId, houseId),
          ),
        ),
      );
    const pendingBets = await tx
      .select({ bet: bets, stage: stages })
      .from(bets)
      .innerJoin(stages, eq(stages.id, bets.stageId))
      .where(
        and(
          eq(bets.projectId, projectId),
          eq(bets.houseId, houseId),
          eq(bets.status, 'PENDING'),
          isNull(bets.deletedAt),
        ),
      );
    const pendingWithdrawals = await tx
      .select()
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.projectId, projectId),
          eq(withdrawalRequests.houseId, houseId),
          eq(withdrawalRequests.status, 'PENDING'),
        ),
      );
    const entries: TimelineEntry[] = rows.map((row) => signedEntry(row.id, row));
    for (const { bet, stage } of pendingBets) {
      if (excludeBetIds.includes(bet.id)) continue;
      const hold = betHold(bet, stage);
      if (hold) entries.push(holdEntry(`hold:bet:${bet.id}`, hold));
    }
    for (const request of pendingWithdrawals) {
      entries.push(
        holdEntry(`hold:withdrawal:${request.id}`, {
          houseId: request.houseId,
          amount: request.amount,
          occurredAt: request.createdAt,
        }),
      );
    }
    return entries;
  }

  /** Filas `INITIAL_CAPITAL` del lote que ninguna reversión ha anulado. */
  private async liveCapitalRows(tx: DbExecutor, projectId: string, batchId: string) {
    const reversal = alias(financialMovements, 'capital_reversal');
    const rows = await tx
      .select({ row: financialMovements })
      .from(financialMovements)
      .leftJoin(reversal, eq(reversal.reversesMovementId, financialMovements.id))
      .where(
        and(
          eq(financialMovements.projectId, projectId),
          eq(financialMovements.batchId, batchId),
          eq(financialMovements.type, 'INITIAL_CAPITAL'),
          isNull(reversal.id),
        ),
      );
    return rows.map(({ row }) => row);
  }
}
