import { Inject, Injectable } from '@nestjs/common';
import {
  addMoney,
  compareMoney,
  deriveEffectiveOdds,
  isPositiveMoney,
  multiplyMoney,
  subtractMoney,
  BET_TRASH_LIMITS,
  PROJECT_TRASH_RETENTION_DAYS,
  ZERO_MONEY,
  type AmountSource,
  type BetDetail,
  type BetSelectionInput,
  type BetSelectionSummary,
  type BetSummary,
  type BetType,
  type CreateBetInput,
  type ListBetsQuery,
  type MoneyString,
  type MoveBetStageInput,
  type PermissionCode,
  type SettleBetInput,
  type TrashBetInput,
  type UpdateBetInput,
} from '@letfer/shared';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { diffFields } from '../audit/audit-values.js';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
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
  financialMovements,
  houses,
  stages,
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
import { assertFinanceReady, financeNotFound } from '../finance/finance-errors.js';
import {
  betConflict,
  betForbidden,
  betInsufficientBalance,
  betNotFound,
  invalidBetStructure,
} from './bet-errors.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Deriva Simple/Creada/Múltiple de la estructura real de selecciones (§20, §90). */
function deriveBetType(selections: readonly BetSelectionInput[]): BetType {
  const groups = new Set(selections.map((s) => s.eventGroup));
  if (groups.size === 1) return selections.length === 1 ? 'SIMPLE' : 'CREATED';
  return 'MULTIPLE';
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

  /** Registra una apuesta manual (§18-§20). Valida saldo disponible antes de crearla (§75). */
  async create(access: ProjectAccess, actor: UserRow, input: CreateBetInput): Promise<BetDetail> {
    assertFinanceReady(access);
    const betType = deriveBetType(input.selections);
    const created = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const house = await this.assertActiveHouse(tx, access.project.id, input.houseId);
      const stage = await this.resolveStage(tx, access.project.id, input.stageId);

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
          visibleTotalOdds: input.visibleTotalOdds,
          officialPotentialReturn: input.officialPotentialReturn ?? null,
          placedAt: new Date(input.placedAt),
          placedTimeKnown: input.placedTimeKnown,
          reason: input.reason ?? null,
        })
        .returning();
      await this.insertSelections(tx, bet!.id, input.selections);

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
        if (input.officialAmount !== undefined) patch.officialAmount = input.officialAmount;
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
   * positivo (D-B2), `BET_SETTLEMENT`, ambos con su `occurredAt` real (§107.3).
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
      this.assertOwnOrAny(access, bet, actor, 'bets.update_any', 'bets.update_own');
      if (bet.status !== 'PENDING') throw betConflict('Esta apuesta ya está liquidada.');

      const stage = await this.stageById(tx, bet.stageId);
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
      await tx.insert(financialMovements).values({
        projectId: access.project.id,
        stageId: bet.stageId,
        type: 'BET_PLACEMENT',
        direction: 'DEBIT',
        houseId: bet.houseId,
        amount: officialAmount,
        operationId: bet.id,
        occurredAt: bet.placedAt,
        createdBy: actor.id,
      });

      // D-B2: sin fila de liquidación cuando no hay retorno positivo (perdida, o un cash out
      // degenerado de $0 tratado igual por consistencia con el CHECK de monto > 0 del ledger).
      const realizedReturn =
        input.status === 'LOST' ? null : (input.officialRealizedReturn ?? null);
      if (realizedReturn !== null && isPositiveMoney(realizedReturn)) {
        await tx.insert(financialMovements).values({
          projectId: access.project.id,
          stageId: bet.stageId,
          type: 'BET_SETTLEMENT',
          direction: 'CREDIT',
          houseId: bet.houseId,
          amount: realizedReturn,
          operationId: bet.id,
          occurredAt: settledAt,
          createdBy: actor.id,
        });
      }

      const updated = expectUpdated(
        await tx
          .update(bets)
          .set({
            status: input.status,
            officialAmount,
            officialRealizedReturn: realizedReturn,
            settledAt,
            settledTimeKnown: input.settledTimeKnown,
            version: nextVersion(bets.version),
          })
          .where(and(eq(bets.id, bet.id), eq(bets.version, input.version)))
          .returning(),
        'bets',
      );

      await this.audit.record(tx, {
        action: 'bet.settled',
        entityType: 'bet',
        entityId: bet.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: 'PENDING' },
        newValues: { status: input.status, officialAmount, officialRealizedReturn: realizedReturn },
      });
      return updated;
    });
    return this.detailOf(this.db, updated);
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
    const amountSource: AmountSource = bet.officialAmount ? 'CONFIRMED' : 'CALCULATED';
    let profitLoss: MoneyString | null = null;
    let effectiveOdds = null;
    if (bet.status === 'LOST') {
      profitLoss = subtractMoney(ZERO_MONEY, effectiveAmount);
    } else if (bet.officialRealizedReturn !== null) {
      profitLoss = subtractMoney(bet.officialRealizedReturn, effectiveAmount);
      effectiveOdds = deriveEffectiveOdds(bet.officialRealizedReturn, effectiveAmount);
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
    return {
      ...this.toSummary(bet, contexts.get(bet.id)!),
      selections: selections.map(toSelectionSummary),
    };
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
