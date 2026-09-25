import { Inject, Injectable } from '@nestjs/common';
import {
  addMoney,
  calculateBetReturn,
  compareMoney,
  deriveEffectiveOdds,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  BET_TRASH_LIMITS,
  ErrorCode,
  PROJECT_TRASH_RETENTION_DAYS,
  ZERO_MONEY,
  type AmountSource,
  type BetDetail,
  type BetSelectionInput,
  type BetSelectionSummary,
  type BetSummary,
  type BetType,
  type ConfirmBetReturnInput,
  type CreateBetInput,
  type ListBetsQuery,
  type MoneyString,
  type MoveBetStageInput,
  type PermissionCode,
  type ReturnDifferenceItem,
  type ReturnDifferencesByHouse,
  type ReturnDifferencesReport,
  type ReturnMismatchDetails,
  type ReturnSource,
  type SettleBetInput,
  type TrashBetInput,
  type UnconfirmedReturnItem,
  type UpdateBetInput,
} from '@letfer/shared';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { diffFields } from '../audit/audit-values.js';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { startOfDayInTimeZone } from '../common/timezone.js';
import { lockByKey } from '../database/advisory-lock.js';
import { expectUpdated, nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  auditLogs,
  betSelections,
  bets,
  houses,
  reconciliationCheckpoints,
  stages,
  tickets,
  users,
  type BetRow,
  type BetSelectionRow,
  type HouseRow,
  type NewBet,
  type StageRow,
  type UserRow,
} from '../database/schema/index.js';
import { fullName } from '../projects/project-mappers.js';
import { computeHouseBalances } from '../finance/balances.js';
import {
  applyBetLedgerPlan,
  assertAvailableNotNegative,
  betFinancialSnapshot,
  desiredBetLedgerLines,
  effectiveBetReturn,
  planBetLedgerChange,
  recordBetCorrection,
} from '../finance/bet-ledger.js';
import { assertFinanceReady, financeNotFound } from '../finance/finance-errors.js';
import {
  betConflict,
  betForbidden,
  betInsufficientBalance,
  betNotFound,
  invalidBetStructure,
  ticketNotFound,
} from './bet-errors.js';
import { ticketsForBets } from '../tickets/ticket-queries.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Deriva Simple/Creada/Múltiple de la estructura real de selecciones (§20, §90). */
function deriveBetType(selections: readonly BetSelectionInput[]): BetType {
  const groups = new Set(selections.map((s) => s.eventGroup));
  if (groups.size === 1) return selections.length === 1 ? 'SIMPLE' : 'CREATED';
  return 'MULTIPLE';
}

/**
 * Retornos que quedan guardados al liquidar (§77, §112.2, D-A3): `WON` siempre guarda el calculado
 * (`monto × cuota visible`) y el oficial solo si se indicó; `VOID` es oficial (por defecto, el
 * monto: sin ganancia ni pérdida, §21.4); `CASHOUT` exige el oficial; `LOST` no lleva retorno.
 */
function settlementReturns(
  input: SettleBetInput,
  amount: MoneyString,
  visibleTotalOdds: string,
): { official: MoneyString | null; calculated: MoneyString | null } {
  switch (input.status) {
    case 'LOST':
      return { official: null, calculated: null };
    case 'WON':
      return {
        official: input.officialRealizedReturn ?? null,
        calculated: calculateBetReturn(amount, visibleTotalOdds),
      };
    case 'VOID':
      return { official: input.officialRealizedReturn ?? amount, calculated: null };
    case 'CASHOUT':
      return { official: input.officialRealizedReturn ?? ZERO_MONEY, calculated: null };
  }
}

function returnSourceOf(returns: {
  official: MoneyString | null;
  calculated: MoneyString | null;
}): ReturnSource | null {
  if (returns.official !== null) return 'OFFICIAL';
  return returns.calculated !== null ? 'CALCULATED' : null;
}

interface SummaryContext {
  stageName: string;
  stageUnitStake: MoneyString;
  houseName: string;
  createdByName: string;
}

function toSelectionSummary(row: BetSelectionRow): BetSelectionSummary {
  return {
    id: row.id,
    eventGroup: row.eventGroup,
    position: row.position,
    sport: row.sport,
    event: row.event,
    market: row.market,
    selection: row.selection,
    visibleOdds: row.visibleOdds,
  };
}

/**
 * Apuestas, selecciones y liquidaciones (§18-§27, §90, §107, ADR 0014). El monto/retorno
 * calculados y la ganancia/pérdida derivada no se guardan (D-B7): se calculan aquí, en cada
 * lectura. Mientras una apuesta está `PENDING`, su monto se refleja en el comprometido de la
 * casa mediante `computeHouseBalances` (§107.3), sin ninguna fila del ledger todavía.
 */
@Injectable()
export class BetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(access: ProjectAccess, query: ListBetsQuery): Promise<BetSummary[]> {
    const conditions = [eq(bets.projectId, access.project.id)];
    if (query.stageId) conditions.push(eq(bets.stageId, query.stageId));
    if (query.houseId) conditions.push(eq(bets.houseId, query.houseId));
    if (query.status === 'TRASHED') {
      conditions.push(isNotNull(bets.deletedAt));
    } else {
      conditions.push(isNull(bets.deletedAt));
      if (query.status) conditions.push(eq(bets.status, query.status));
    }
    const rows = await this.db
      .select()
      .from(bets)
      .where(and(...conditions))
      .orderBy(desc(bets.placedAt), desc(bets.id));
    return this.summariesOf(this.db, rows);
  }

  async detail(access: ProjectAccess, betId: string): Promise<BetDetail> {
    const bet = await this.findOwned(this.db, access.project.id, betId);
    return this.detailOf(this.db, bet);
  }

  /**
   * Registra una apuesta manual (§18-§20). Valida saldo disponible antes de crearla (§75).
   * Solo quien puede mover apuestas de etapa (§25, `bets.move_stage`) puede indicar `stageId`
   * explícitamente; sin ese permiso, solo puede crear en la etapa activa, y se rechaza si pidió
   * explícitamente otra distinta (revisión de arquitectura previa a integrar la Fase 4: crear
   * directamente en otra etapa no debe servir para evadir la restricción de administrador que sí
   * aplica a moverla; se rechaza en vez de ignorar el `stageId` en silencio).
   */
  async create(access: ProjectAccess, actor: UserRow, input: CreateBetInput): Promise<BetDetail> {
    assertFinanceReady(access);
    const betType = deriveBetType(input.selections);
    const canChooseStage = access.permissions.has('bets.move_stage');
    const created = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const house = await this.assertActiveHouse(tx, access.project.id, input.houseId);
      if (input.stageId !== undefined && !canChooseStage) {
        const active = await this.resolveStage(tx, access.project.id, undefined);
        if (input.stageId !== active.id) {
          throw betForbidden('Solo puedes registrar apuestas en la etapa activa.');
        }
      }
      const stage = await this.resolveStage(
        tx,
        access.project.id,
        canChooseStage ? input.stageId : undefined,
      );

      const effectiveAmount = input.officialAmount ?? multiplyMoney(stage.unitStake, input.stake);
      const balances = await computeHouseBalances(tx, access.project.id);
      const available = balances.get(house.id)?.available ?? ZERO_MONEY;
      if (compareMoney(available, effectiveAmount) < 0) throw betInsufficientBalance();

      const [bet] = await tx
        .insert(bets)
        .values({
          projectId: access.project.id,
          stageId: stage.id,
          houseId: house.id,
          createdBy: actor.id,
          betType,
          stakeAmount: input.stake,
          officialAmount: input.officialAmount ?? null,
          // Un monto indicado al registrar viene de un ticket o de una persona que lo confirma (§76).
          amountConfirmed: input.officialAmount !== undefined,
          visibleTotalOdds: input.visibleTotalOdds,
          officialPotentialReturn: input.officialPotentialReturn ?? null,
          placedAt: new Date(input.placedAt),
          placedTimeKnown: input.placedTimeKnown,
          reason: input.reason ?? null,
        })
        .returning();
      await this.insertSelections(tx, bet!.id, input.selections);
      await this.invalidateAffectedCheckpoints(
        tx,
        house.id,
        bet!.placedAt,
        'Se registró una apuesta nueva fechada en o antes de este checkpoint.',
      );
      if (input.ticketId) await this.linkTicket(tx, access.project.id, bet!.id, input.ticketId);

      await this.audit.record(tx, {
        action: 'bet.created',
        entityType: 'bet',
        entityId: bet!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: {
          houseId: house.id,
          stageId: stage.id,
          betType,
          stake: input.stake,
          officialAmount: input.officialAmount ?? null,
        },
      });
      return bet!;
    });
    return this.detailOf(this.db, created);
  }

  /**
   * Edita una apuesta (§24). `PENDING` admite todos los campos; una ya liquidada, solo `reason`,
   * `placedAt` y `placedTimeKnown` (§107.9: corregir sus valores financieros o sus selecciones
   * queda fuera de esta fase).
   */
  async update(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: UpdateBetInput,
  ): Promise<BetDetail> {
    const updated = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const bet = await this.lockOwned(tx, access.project.id, betId);
      this.assertNotTrashed(bet);
      this.assertOwnOrAny(access, bet, actor, 'bets.update_any', 'bets.update_own');

      const patch: Partial<NewBet> = {};
      let newSelections: BetSelectionInput[] | undefined;

      if (bet.status !== 'PENDING') {
        if (
          input.houseId !== undefined ||
          input.stageId !== undefined ||
          input.stake !== undefined ||
          input.officialAmount !== undefined ||
          input.visibleTotalOdds !== undefined ||
          input.officialPotentialReturn !== undefined ||
          input.selections !== undefined
        ) {
          throw betConflict(
            'Esta apuesta ya está liquidada: solo puedes corregir el motivo y la fecha de colocación.',
          );
        }
      } else {
        let newHouse: HouseRow | null = null;
        let newStage: StageRow | null = null;
        if (input.houseId !== undefined) {
          newHouse = await this.assertActiveHouse(tx, access.project.id, input.houseId);
          patch.houseId = newHouse.id;
        }
        if (input.stageId !== undefined) {
          newStage = await this.resolveStage(tx, access.project.id, input.stageId);
          patch.stageId = newStage.id;
        }
        if (input.stake !== undefined) patch.stakeAmount = input.stake;
        if (input.officialAmount !== undefined) {
          patch.officialAmount = input.officialAmount;
          patch.amountConfirmed = true; // indicado por una persona o un ticket (§76)
        }
        if (input.visibleTotalOdds !== undefined) patch.visibleTotalOdds = input.visibleTotalOdds;
        if (input.officialPotentialReturn !== undefined) {
          patch.officialPotentialReturn = input.officialPotentialReturn;
        }
        if (input.selections !== undefined) {
          newSelections = input.selections;
          patch.betType = deriveBetType(input.selections);
        }

        const effectiveHouseId = newHouse?.id ?? bet.houseId;
        const effectiveStage = newStage ?? (await this.stageById(tx, patch.stageId ?? bet.stageId));
        const newOfficialAmount =
          patch.officialAmount !== undefined ? patch.officialAmount : bet.officialAmount;
        const newStake = patch.stakeAmount ?? bet.stakeAmount;
        const newEffectiveAmount =
          newOfficialAmount ?? multiplyMoney(effectiveStage.unitStake, newStake);

        const currentStage = await this.stageById(tx, bet.stageId);
        const currentEffectiveAmount =
          bet.officialAmount ?? multiplyMoney(currentStage.unitStake, bet.stakeAmount);
        const balances = await computeHouseBalances(tx, access.project.id);
        if (effectiveHouseId === bet.houseId) {
          const availableExcludingSelf = addMoney(
            balances.get(bet.houseId)?.available ?? ZERO_MONEY,
            currentEffectiveAmount,
          );
          if (compareMoney(availableExcludingSelf, newEffectiveAmount) < 0) {
            throw betInsufficientBalance();
          }
        } else {
          const newHouseAvailable = balances.get(effectiveHouseId)?.available ?? ZERO_MONEY;
          if (compareMoney(newHouseAvailable, newEffectiveAmount) < 0)
            throw betInsufficientBalance();
        }
      }
      if (input.placedAt !== undefined) patch.placedAt = new Date(input.placedAt);
      if (input.placedTimeKnown !== undefined) patch.placedTimeKnown = input.placedTimeKnown;
      if (input.reason !== undefined) patch.reason = input.reason ?? null;
      // Vincular un ticket no tiene efecto financiero (§110.3): se permite sin importar el
      // estado de la apuesta, a diferencia de los campos que sí lo tienen (§107.9).
      if (input.ticketId) await this.linkTicket(tx, access.project.id, bet.id, input.ticketId);

      const before = AUDITABLE_FIELDS.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = bet[key];
        return acc;
      }, {});
      const updated = expectUpdated(
        await tx
          .update(bets)
          .set({ ...patch, version: nextVersion(bets.version) })
          .where(and(eq(bets.id, bet.id), eq(bets.version, input.version)))
          .returning(),
        'bets',
      );
      if (newSelections) await this.replaceSelections(tx, bet.id, newSelections);

      // Solo la rama PENDING tiene efecto sobre el comprometido (§107.9); una edición de una
      // apuesta ya liquidada no toca ninguna cifra financiera y no invalida nada (§74, §109.1.3).
      if (bet.status === 'PENDING') {
        await this.invalidateAffectedCheckpoints(
          tx,
          updated.houseId,
          updated.placedAt,
          'Se editó una apuesta pendiente fechada en o antes de este checkpoint.',
        );
        if (updated.houseId !== bet.houseId) {
          await this.invalidateAffectedCheckpoints(
            tx,
            bet.houseId,
            bet.placedAt,
            'Se movió una apuesta pendiente a otra casa; afectaba al comprometido de esta.',
          );
        }
      }

      const after = AUDITABLE_FIELDS.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = updated[key];
        return acc;
      }, {});
      const diff = diffFields(before, after);
      await this.audit.record(tx, {
        action: 'bet.updated',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: diff?.oldValues ?? null,
        newValues: diff?.newValues ?? null,
      });
      return updated;
    });
    return this.detailOf(this.db, updated);
  }

  /**
   * Liquida una apuesta pendiente (§21, §77, §78). Inserta `BET_PLACEMENT` y, si hay un retorno
   * positivo (D-B2), `BET_SETTLEMENT`, ambos con su `occurredAt` real (§107.3). Operación
   * financiera protegida por `bets.settle` (revisión de arquitectura previa a integrar la
   * Fase 4): no depende de la propiedad de la apuesta, el controlador ya exigió el permiso.
   */
  async settle(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: SettleBetInput,
  ): Promise<BetDetail> {
    const updated = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const bet = await this.lockOwned(tx, access.project.id, betId);
      this.assertNotTrashed(bet);
      if (bet.status !== 'PENDING') throw betConflict('Esta apuesta ya está liquidada.');

      const stage = await this.stageById(tx, bet.stageId);
      // Un monto indicado al liquidar lo confirma una persona (§76); si no, se conserva el que ya
      // estaba confirmado, o se congela el calculado SIN marcarlo como confirmado (§112.2).
      const amountConfirmed = input.officialAmount !== undefined || bet.amountConfirmed;
      const officialAmount =
        input.officialAmount ??
        bet.officialAmount ??
        multiplyMoney(stage.unitStake, bet.stakeAmount);

      // El monto que se registrará en el ledger debe caber en el saldo bruto de la casa
      // (todavía no se ha debitado nada de esta apuesta, D-B7/§107.3).
      const balances = await computeHouseBalances(tx, access.project.id);
      const grossBalance = balances.get(bet.houseId)?.balance ?? ZERO_MONEY;
      if (compareMoney(grossBalance, officialAmount) < 0) throw betInsufficientBalance();

      const settledAt = new Date(input.settledAt);
      const returns = settlementReturns(input, officialAmount, bet.visibleTotalOdds);
      const updated = expectUpdated(
        await tx
          .update(bets)
          .set({
            status: input.status,
            officialAmount,
            amountConfirmed,
            officialRealizedReturn: returns.official,
            calculatedRealizedReturn: returns.calculated,
            settledAt,
            settledTimeKnown: input.settledTimeKnown,
            version: nextVersion(bets.version),
          })
          .where(and(eq(bets.id, bet.id), eq(bets.version, input.version)))
          .returning(),
        'bets',
      );

      // El efecto en el ledger (BET_PLACEMENT y, con retorno positivo, BET_SETTLEMENT; D-B2) lo
      // calcula y valida el motor único de §112.1, también para la primera liquidación: además del
      // saldo bruto actual, comprueba la línea de tiempo (una colocación fechada antes de un depósito
      // dejaría la casa en negativo en el pasado, §74).
      const plan = await planBetLedgerChange(tx, {
        projectId: access.project.id,
        betId: bet.id,
        desired: desiredBetLedgerLines(updated, stage),
        now: this.clock.now(),
      });
      await applyBetLedgerPlan(tx, plan, {
        actorId: actor.id,
        correctionId: null,
        stageId: updated.stageId,
      });
      // El BET_PLACEMENT recién insertado está fechado en bet.placedAt (§107.3), que puede ser
      // anterior a un checkpoint existente: esa fotografía asumía "sin ledger todavía" (D-B7) y
      // acaba de dejar de ser cierta (§74, §109.1.3).
      await this.invalidateAffectedCheckpoints(
        tx,
        bet.houseId,
        bet.placedAt,
        'Se liquidó una apuesta cuyo BET_PLACEMENT quedó fechado en o antes de este checkpoint.',
      );

      await this.audit.record(tx, {
        action: 'bet.settled',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: 'PENDING' },
        newValues: {
          status: input.status,
          officialAmount,
          amountConfirmed,
          officialRealizedReturn: returns.official,
          calculatedRealizedReturn: returns.calculated,
          returnSource: returnSourceOf(returns),
        },
      });
      return updated;
    });
    return this.detailOf(this.db, updated);
  }

  /**
   * Confirma el retorno oficial de una ganada liquidada con retorno calculado (§77, §112.2).
   *
   * - Solo una `WON` con retorno calculado sin confirmar; una ya confirmada se corrige con la
   *   corrección de liquidación (8.5.3), nunca aquí.
   * - Si el oficial coincide con el calculado, solo se marca confirmado (el ledger ya es correcto).
   * - Si difiere y no hay `acknowledgeDifference`, 409 `RETURN_MISMATCH` con calculado, oficial y
   *   diferencia, sin cambiar nada. Con la confirmación explícita (que el controlador exige con
   *   reautenticación reciente, D-A12) el oficial pasa a ser la autoridad: el motor de §112.1
   *   revierte la liquidación calculada y registra la oficial, valida la línea de tiempo, se
   *   invalidan los checkpoints afectados (§112.5) y se audita.
   * - `amount_confirmed` no se toca: confirmar el retorno no confirma el monto (§76).
   */
  async confirmReturn(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: ConfirmBetReturnInput,
  ): Promise<BetDetail> {
    const confirmed = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const bet = await this.lockOwned(tx, access.project.id, betId);
      this.assertNotTrashed(bet);
      if (bet.status !== 'WON' || bet.calculatedRealizedReturn === null) {
        throw betConflict(
          'Solo una apuesta ganada con retorno calculado admite esta confirmación.',
        );
      }
      if (bet.officialRealizedReturn !== null) {
        throw betConflict('El retorno oficial de esta apuesta ya está confirmado.');
      }

      const calculated = bet.calculatedRealizedReturn;
      const official = input.officialRealizedReturn;
      const delta = subtractMoney(official, calculated);
      const differs = compareMoney(official, calculated) !== 0;
      if (differs && !input.acknowledgeDifference) {
        const details: ReturnMismatchDetails = { calculated, official, delta };
        throw new AppError(
          409,
          ErrorCode.RETURN_MISMATCH,
          'El retorno oficial difiere del calculado: confirma la diferencia para continuar.',
          { details },
        );
      }

      const stage = await this.stageById(tx, bet.stageId);
      const updated = expectUpdated(
        await tx
          .update(bets)
          .set({ officialRealizedReturn: official, version: nextVersion(bets.version) })
          .where(and(eq(bets.id, bet.id), eq(bets.version, input.version)))
          .returning(),
        'bets',
      );
      const plan = await planBetLedgerChange(tx, {
        projectId: access.project.id,
        betId: bet.id,
        desired: desiredBetLedgerLines(updated, stage),
        now: this.clock.now(),
      });
      const correction = await recordBetCorrection(tx, {
        projectId: access.project.id,
        betId: bet.id,
        kind: 'RETURN_CONFIRMATION',
        before: betFinancialSnapshot(bet),
        after: betFinancialSnapshot(updated),
        reason: input.reason?.trim() ? input.reason.trim() : null,
        actorId: actor.id,
      });
      await applyBetLedgerPlan(tx, plan, {
        actorId: actor.id,
        correctionId: correction.id,
        reason: input.reason?.trim() || 'Confirmación del retorno oficial',
        stageId: updated.stageId,
      });
      if (plan.changed) {
        await assertAvailableNotNegative(tx, access.project.id, plan.affectedHouseIds);
        for (const houseId of plan.affectedHouseIds) {
          await this.invalidateAffectedCheckpoints(
            tx,
            houseId,
            plan.earliestAffectedAt!,
            'Se confirmó un retorno oficial distinto del calculado, con efecto en el ledger en o antes de este checkpoint.',
          );
        }
      }

      await this.audit.record(tx, {
        action: 'bet.return_confirmed',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { officialRealizedReturn: null, returnSource: 'CALCULATED' },
        newValues: { officialRealizedReturn: official, returnSource: 'OFFICIAL' },
        metadata: {
          calculatedRealizedReturn: calculated,
          delta,
          differed: differs,
          ledgerChanged: plan.changed,
          correctionId: correction.id,
          ...(input.reason?.trim() && { reason: input.reason.trim() }),
        },
      });
      return updated;
    });
    return this.detailOf(this.db, confirmed);
  }

  /** Ganadas liquidadas cuyo retorno sigue siendo el calculado, las más recientes primero (§77). */
  async unconfirmedReturns(access: ProjectAccess): Promise<UnconfirmedReturnItem[]> {
    const rows = await this.db
      .select({ bet: bets, houseName: houses.name, stage: stages })
      .from(bets)
      .innerJoin(houses, eq(houses.id, bets.houseId))
      .innerJoin(stages, eq(stages.id, bets.stageId))
      .where(
        and(
          eq(bets.projectId, access.project.id),
          eq(bets.status, 'WON'),
          isNull(bets.officialRealizedReturn),
          isNull(bets.deletedAt),
        ),
      )
      .orderBy(desc(bets.settledAt), desc(bets.id));
    return rows.map(({ bet, houseName, stage }) => {
      const effectiveAmount = bet.officialAmount ?? multiplyMoney(stage.unitStake, bet.stakeAmount);
      const calculated = bet.calculatedRealizedReturn ?? ZERO_MONEY;
      return {
        betId: bet.id,
        houseName,
        stageName: stage.name,
        settledAt: bet.settledAt!.toISOString(),
        effectiveAmount,
        calculatedRealizedReturn: calculated,
        provisionalProfit: subtractMoney(calculated, effectiveAmount),
      };
    });
  }

  /**
   * Compara los retornos calculado y oficial de las ganadas que tienen ambos (§77). Es la
   * evidencia para decidir el redondeo (D-B8): no decide nada ni modifica datos.
   */
  async returnDifferences(access: ProjectAccess): Promise<ReturnDifferencesReport> {
    const rows = await this.db
      .select({ bet: bets, houseName: houses.name, stage: stages })
      .from(bets)
      .innerJoin(houses, eq(houses.id, bets.houseId))
      .innerJoin(stages, eq(stages.id, bets.stageId))
      .where(
        and(
          eq(bets.projectId, access.project.id),
          eq(bets.status, 'WON'),
          isNotNull(bets.officialRealizedReturn),
          isNotNull(bets.calculatedRealizedReturn),
          isNull(bets.deletedAt),
        ),
      )
      .orderBy(desc(bets.settledAt), desc(bets.id));

    const items: ReturnDifferenceItem[] = rows.map(({ bet, houseName, stage }) => ({
      betId: bet.id,
      houseId: bet.houseId,
      houseName,
      betType: bet.betType,
      settledAt: bet.settledAt!.toISOString(),
      effectiveAmount: bet.officialAmount ?? multiplyMoney(stage.unitStake, bet.stakeAmount),
      visibleTotalOdds: bet.visibleTotalOdds,
      calculatedRealizedReturn: bet.calculatedRealizedReturn!,
      officialRealizedReturn: bet.officialRealizedReturn!,
      delta: subtractMoney(bet.officialRealizedReturn!, bet.calculatedRealizedReturn!),
    }));
    const differing = items.filter((item) => compareMoney(item.delta, ZERO_MONEY) !== 0);

    const byHouse = new Map<string, ReturnDifferencesByHouse>();
    for (const item of items) {
      const current = byHouse.get(item.houseId) ?? {
        houseId: item.houseId,
        houseName: item.houseName,
        compared: 0,
        differing: 0,
        totalDelta: ZERO_MONEY,
      };
      current.compared += 1;
      if (compareMoney(item.delta, ZERO_MONEY) !== 0) current.differing += 1;
      current.totalDelta = addMoney(current.totalDelta, item.delta);
      byHouse.set(item.houseId, current);
    }

    return {
      compared: items.length,
      differing: differing.length,
      totalDelta: sumMoney(items.map((item) => item.delta)),
      byHouse: [...byHouse.values()].sort((a, b) => a.houseName.localeCompare(b.houseName)),
      items: differing.slice(0, 200),
    };
  }

  /** Mueve una apuesta a otra etapa del proyecto (§25: solo administradores autorizados). */
  async moveStage(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: MoveBetStageInput,
  ): Promise<BetDetail> {
    const updated = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const bet = await this.lockOwned(tx, access.project.id, betId);
      this.assertNotTrashed(bet);
      const newStage = await this.resolveStage(tx, access.project.id, input.stageId);
      if (newStage.id === bet.stageId) throw betConflict('La apuesta ya está en esa etapa.');

      const updated = expectUpdated(
        await tx
          .update(bets)
          .set({ stageId: newStage.id, version: nextVersion(bets.version) })
          .where(and(eq(bets.id, bet.id), eq(bets.version, input.version)))
          .returning(),
        'bets',
      );
      // Hallazgo H1 (revisión de arquitectura de la Fase 5.5): una PENDING sin monto oficial
      // calcula su comprometido con la unidad de SU etapa (computeHouseBalances); moverla a una
      // etapa con otra unidad cambia ese comprometido igual que editarla, aunque sea la misma
      // casa. Con monto oficial confirmado, la unidad no interviene: no hace falta invalidar.
      if (bet.status === 'PENDING' && bet.officialAmount === null) {
        await this.invalidateAffectedCheckpoints(
          tx,
          bet.houseId,
          bet.placedAt,
          'Se movió de etapa una apuesta pendiente sin monto oficial; pudo cambiar su comprometido.',
        );
      }
      await this.audit.record(tx, {
        action: 'bet.moved_stage',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { stageId: bet.stageId },
        newValues: { stageId: newStage.id },
      });
      return updated;
    });
    return this.detailOf(this.db, updated);
  }

  /** Envía una apuesta a la papelera (§26). El Colaborador tiene un límite diario (§88, D-B6). */
  async trash(
    access: ProjectAccess,
    actor: UserRow,
    betId: string,
    input: TrashBetInput,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // M4 (revisión de arquitectura de la Fase 5.5): serializa contra confirm() de conciliación
      // y contra el resto de operaciones financieras, evitando una carrera en la que el
      // comprometido calculado durante una conciliación quede desactualizado.
      await lockByKey(tx, `finance:${access.project.id}`);
      const bet = await this.lockOwned(tx, access.project.id, betId);
      if (bet.deletedAt !== null) throw betConflict('Esta apuesta ya está en la papelera.');
      this.assertOwnOrAny(access, bet, actor, 'bets.trash_any', 'bets.trash_own');
      if (!access.permissions.has('bets.trash_any')) {
        await this.assertWithinDailyTrashLimit(tx, access, actor);
      }

      const now = this.clock.now();
      await tx
        .update(bets)
        .set({
          deletedAt: now,
          deletionReason: input.reason ?? null,
          deletedBy: actor.id,
          purgeEligibleAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_DAYS * MS_PER_DAY),
          version: nextVersion(bets.version),
        })
        .where(eq(bets.id, bet.id));
      // Solo una apuesta PENDING tiene efecto sobre el comprometido al enviarse a la papelera
      // (§107.3: una liquidada ya tiene su ledger insertado, inmutable, sin cambios); §74, §109.1.3.
      if (bet.status === 'PENDING') {
        await this.invalidateAffectedCheckpoints(
          tx,
          bet.houseId,
          bet.placedAt,
          'Se envió a la papelera una apuesta pendiente fechada en o antes de este checkpoint.',
        );
      }
      await this.audit.record(tx, {
        action: 'bet.trashed',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: { reason: input.reason ?? null },
      });
    });
  }

  /** Restaura una apuesta desde la papelera (§26: solo administradores autorizados). */
  async restore(access: ProjectAccess, actor: UserRow, betId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // M4: mismo motivo que trash().
      await lockByKey(tx, `finance:${access.project.id}`);
      const bet = await this.lockOwned(tx, access.project.id, betId);
      if (bet.deletedAt === null) throw betConflict('Esta apuesta no está en la papelera.');
      await tx
        .update(bets)
        .set({
          deletedAt: null,
          deletionReason: null,
          deletedBy: null,
          purgeEligibleAt: null,
          version: nextVersion(bets.version),
        })
        .where(eq(bets.id, bet.id));
      // Simétrico a trash(): restaurar una PENDING vuelve a sumarla al comprometido (§74, §109.1.3).
      if (bet.status === 'PENDING') {
        await this.invalidateAffectedCheckpoints(
          tx,
          bet.houseId,
          bet.placedAt,
          'Se restauró una apuesta pendiente fechada en o antes de este checkpoint.',
        );
      }
      await this.audit.record(tx, {
        action: 'bet.restored',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
      });
    });
  }

  // --- Helpers privados --------------------------------------------------------------------

  /**
   * Una apuesta en la papelera no admite ninguna operación financiera ni edición (revisión de
   * arquitectura previa a integrar la Fase 4): hay que restaurarla primero. `trash()` ya
   * comprueba esto por su cuenta (con un mensaje propio, "ya está en la papelera"); `restore()`
   * es la única acción que opera sobre una apuesta en este estado.
   */
  private assertNotTrashed(bet: BetRow): void {
    if (bet.deletedAt !== null) {
      throw betConflict('Esta apuesta está en la papelera: restáurala antes de continuar.');
    }
  }

  /**
   * Invalida los checkpoints de conciliación `MATCHED` de una casa cuya fotografía ya no es
   * correcta (§74, §109.1.3, ADR 0016): una apuesta con efecto financiero potencial (colocada,
   * editada, liquidada, eliminada o restaurada) fechada en o antes de `occurredAt` de un
   * checkpoint significa que ese checkpoint asumía un estado que acaba de cambiar. Una apuesta
   * posterior nunca invalida nada: es actividad nueva, no una corrección retroactiva. Se llama
   * dentro de la misma transacción que la acción sobre la apuesta.
   */
  private async invalidateAffectedCheckpoints(
    tx: DbExecutor,
    houseId: string,
    placedAt: Date,
    reason: string,
  ): Promise<void> {
    await tx
      .update(reconciliationCheckpoints)
      .set({
        status: 'INVALIDATED',
        invalidatedAt: this.clock.now(),
        invalidatedReason: reason,
      })
      .where(
        and(
          eq(reconciliationCheckpoints.houseId, houseId),
          eq(reconciliationCheckpoints.status, 'MATCHED'),
          gte(reconciliationCheckpoints.occurredAt, placedAt),
        ),
      );
  }

  /** `any` permite actuar sobre cualquier apuesta; sin él, hace falta `own` y ser quien la creó. */
  private assertOwnOrAny(
    access: ProjectAccess,
    bet: BetRow,
    actor: UserRow,
    anyPermission: PermissionCode,
    ownPermission: PermissionCode,
  ): void {
    if (access.permissions.has(anyPermission)) return;
    if (access.permissions.has(ownPermission) && bet.createdBy === actor.id) return;
    throw betForbidden('No tienes permiso para esta acción.');
  }

  private async assertWithinDailyTrashLimit(
    executor: DbExecutor,
    access: ProjectAccess,
    actor: UserRow,
  ): Promise<void> {
    const startOfDay = startOfDayInTimeZone(this.clock.now(), access.project.timezone);
    const [row] = await executor
      .select({ total: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.projectId, access.project.id),
          eq(auditLogs.actorUserId, actor.id),
          eq(auditLogs.action, 'bet.trashed'),
          gte(auditLogs.occurredAt, startOfDay),
        ),
      );
    if ((row?.total ?? 0) >= BET_TRASH_LIMITS.maxPerDay) {
      throw betConflict(
        `Alcanzaste el límite de ${BET_TRASH_LIMITS.maxPerDay} eliminaciones diarias.`,
      );
    }
  }

  private async assertActiveHouse(
    executor: DbExecutor,
    projectId: string,
    houseId: string,
  ): Promise<HouseRow> {
    const [house] = await executor.select().from(houses).where(eq(houses.id, houseId)).limit(1);
    if (!house || house.projectId !== projectId) throw financeNotFound('Casa no encontrada.');
    if (house.status !== 'ACTIVE') {
      throw betConflict('La casa está desactivada: reactívala antes de registrar apuestas.');
    }
    return house;
  }

  /** Sin `stageId`, la etapa activa del proyecto; con él, cualquier etapa no eliminada (§93). */
  private async resolveStage(
    executor: DbExecutor,
    projectId: string,
    stageId: string | undefined,
  ): Promise<StageRow> {
    if (stageId === undefined) {
      const [active] = await executor
        .select()
        .from(stages)
        .where(and(eq(stages.projectId, projectId), eq(stages.status, 'ACTIVE')))
        .limit(1);
      if (!active) throw betConflict('El proyecto todavía no tiene una etapa activa.');
      return active;
    }
    const [stage] = await executor
      .select()
      .from(stages)
      .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)))
      .limit(1);
    if (!stage || stage.status === 'TRASHED') throw financeNotFound('Etapa no encontrada.');
    return stage;
  }

  private async stageById(executor: DbExecutor, stageId: string): Promise<StageRow> {
    const [stage] = await executor.select().from(stages).where(eq(stages.id, stageId)).limit(1);
    if (!stage) throw financeNotFound('Etapa no encontrada.');
    return stage;
  }

  private async findOwned(executor: DbExecutor, projectId: string, betId: string): Promise<BetRow> {
    const [bet] = await executor
      .select()
      .from(bets)
      .where(and(eq(bets.id, betId), eq(bets.projectId, projectId)))
      .limit(1);
    if (!bet) throw betNotFound();
    return bet;
  }

  private async lockOwned(executor: DbExecutor, projectId: string, betId: string): Promise<BetRow> {
    const [bet] = await executor
      .select()
      .from(bets)
      .where(and(eq(bets.id, betId), eq(bets.projectId, projectId)))
      .for('update')
      .limit(1);
    if (!bet) throw betNotFound();
    return bet;
  }

  private async insertSelections(
    executor: DbExecutor,
    betId: string,
    selections: readonly BetSelectionInput[],
  ): Promise<void> {
    if (selections.length === 0)
      throw invalidBetStructure('La apuesta necesita al menos una selección.');
    await executor.insert(betSelections).values(
      selections.map((selection) => ({
        betId,
        eventGroup: selection.eventGroup,
        position: selection.position,
        sport: selection.sport ?? null,
        event: selection.event,
        market: selection.market ?? null,
        selection: selection.selection,
        visibleOdds: selection.visibleOdds,
      })),
    );
  }

  private async replaceSelections(
    executor: DbExecutor,
    betId: string,
    selections: readonly BetSelectionInput[],
  ): Promise<void> {
    await executor.delete(betSelections).where(eq(betSelections.betId, betId));
    await this.insertSelections(executor, betId, selections);
  }

  private async selectionsOf(executor: DbExecutor, betId: string): Promise<BetSelectionRow[]> {
    return executor
      .select()
      .from(betSelections)
      .where(eq(betSelections.betId, betId))
      .orderBy(betSelections.eventGroup, betSelections.position);
  }

  private toSummary(bet: BetRow, ctx: SummaryContext): BetSummary {
    const effectiveAmount =
      bet.officialAmount ?? multiplyMoney(ctx.stageUnitStake, bet.stakeAmount);
    // `official_amount` puede ser el monto calculado congelado al liquidar: solo `amount_confirmed`
    // dice si alguien lo confirmó (§76, §112.2).
    const amountSource: AmountSource = bet.amountConfirmed ? 'CONFIRMED' : 'CALCULATED';
    const effectiveReturn = effectiveBetReturn(bet);
    const returnSource = returnSourceOf({
      official: bet.officialRealizedReturn,
      calculated: bet.calculatedRealizedReturn,
    });
    let profitLoss: MoneyString | null = null;
    let effectiveOdds = null;
    if (bet.status === 'LOST') {
      profitLoss = subtractMoney(ZERO_MONEY, effectiveAmount);
    } else if (effectiveReturn !== null) {
      profitLoss = subtractMoney(effectiveReturn, effectiveAmount);
      effectiveOdds = deriveEffectiveOdds(effectiveReturn, effectiveAmount);
    }
    return {
      id: bet.id,
      projectId: bet.projectId,
      stageId: bet.stageId,
      stageName: ctx.stageName,
      houseId: bet.houseId,
      houseName: ctx.houseName,
      betType: bet.betType,
      stake: bet.stakeAmount,
      officialAmount: bet.officialAmount,
      effectiveAmount,
      amountSource,
      visibleTotalOdds: bet.visibleTotalOdds,
      officialPotentialReturn: bet.officialPotentialReturn,
      officialRealizedReturn: bet.officialRealizedReturn,
      calculatedRealizedReturn: bet.calculatedRealizedReturn,
      effectiveReturn,
      returnSource,
      effectiveOdds,
      profitLoss,
      status: bet.status,
      placedAt: bet.placedAt.toISOString(),
      placedTimeKnown: bet.placedTimeKnown,
      settledAt: bet.settledAt ? bet.settledAt.toISOString() : null,
      settledTimeKnown: bet.settledTimeKnown,
      reason: bet.reason,
      createdBy: { id: bet.createdBy, name: ctx.createdByName },
      createdAt: bet.createdAt.toISOString(),
      updatedAt: bet.updatedAt.toISOString(),
      deletedAt: bet.deletedAt ? bet.deletedAt.toISOString() : null,
      purgeEligibleAt: bet.purgeEligibleAt ? bet.purgeEligibleAt.toISOString() : null,
      version: bet.version,
    };
  }

  private async summariesOf(executor: DbExecutor, rows: BetRow[]): Promise<BetSummary[]> {
    if (rows.length === 0) return [];
    const contexts = await this.contextsOf(executor, rows);
    return rows.map((bet) => this.toSummary(bet, contexts.get(bet.id)!));
  }

  private async detailOf(executor: DbExecutor, bet: BetRow): Promise<BetDetail> {
    const contexts = await this.contextsOf(executor, [bet]);
    const selections = await this.selectionsOf(executor, bet.id);
    const ticketsByBet = await ticketsForBets(executor, [bet.id]);
    return {
      ...this.toSummary(bet, contexts.get(bet.id)!),
      selections: selections.map(toSelectionSummary),
      tickets: ticketsByBet.get(bet.id) ?? [],
    };
  }

  /**
   * Vincula un ticket ya subido a esta apuesta (§110.3): comprueba en la misma transacción que
   * pertenece al proyecto y que no está ya vinculado a otra apuesta (`UPDATE ... WHERE bet_id IS
   * NULL`, atómico frente a dos vinculaciones simultáneas del mismo ticket). Nunca escribe nada
   * financiero — es la única responsabilidad de `tickets` que toca `BetsService`, y al revés:
   * `TicketsService` nunca escribe en `bets` (§51, sin vía financiera paralela).
   */
  private async linkTicket(
    tx: DbExecutor,
    projectId: string,
    betId: string,
    ticketId: string,
  ): Promise<void> {
    const [linked] = await tx
      .update(tickets)
      .set({ betId })
      .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, projectId), isNull(tickets.betId)))
      .returning({ id: tickets.id });
    if (linked) return;
    const [existing] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!existing || existing.projectId !== projectId) throw ticketNotFound();
    throw betConflict('Este ticket ya está vinculado a otra apuesta.');
  }

  private async contextsOf(
    executor: DbExecutor,
    rows: readonly BetRow[],
  ): Promise<Map<string, SummaryContext>> {
    const stageIds = [...new Set(rows.map((r) => r.stageId))];
    const houseIds = [...new Set(rows.map((r) => r.houseId))];
    const userIds = [...new Set(rows.map((r) => r.createdBy))];
    const [stageRows, houseRows, userRows] = await Promise.all([
      executor
        .select({ id: stages.id, name: stages.name, unitStake: stages.unitStake })
        .from(stages)
        .where(inArray(stages.id, stageIds)),
      executor
        .select({ id: houses.id, name: houses.name })
        .from(houses)
        .where(inArray(houses.id, houseIds)),
      executor
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(inArray(users.id, userIds)),
    ]);
    const stageById = new Map(stageRows.map((s) => [s.id, s]));
    const houseNameById = new Map(houseRows.map((h) => [h.id, h.name]));
    const userNameById = new Map(userRows.map((u) => [u.id, fullName(u)]));
    return new Map(
      rows.map((bet) => [
        bet.id,
        {
          stageName: stageById.get(bet.stageId)?.name ?? '',
          stageUnitStake: stageById.get(bet.stageId)?.unitStake ?? ZERO_MONEY,
          houseName: houseNameById.get(bet.houseId) ?? '',
          createdByName: userNameById.get(bet.createdBy) ?? '',
        },
      ]),
    );
  }
}

/** Campos auditados campo a campo en `update()` (§24), vía `diffFields`. */
const AUDITABLE_FIELDS = [
  'houseId',
  'stageId',
  'stakeAmount',
  'officialAmount',
  'visibleTotalOdds',
  'officialPotentialReturn',
  'placedAt',
  'placedTimeKnown',
  'reason',
] as const satisfies readonly (keyof BetRow)[];
