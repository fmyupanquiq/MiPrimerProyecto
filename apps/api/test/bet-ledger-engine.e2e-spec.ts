import {
  addMoney,
  subtractMoney,
  ZERO_MONEY,
  type ApiErrorBody,
  type MoneyString,
} from '@letfer/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/common/app-error.js';
import { lockByKey } from '../src/database/advisory-lock.js';
import type { DbExecutor } from '../src/database/database.types.js';
import {
  betCorrections,
  bets,
  financialMovements,
  type BetRow,
  type HouseRow,
  type NewBet,
  type StageRow,
  type UserRow,
} from '../src/database/schema/index.js';
import { computeHouseBalance } from '../src/finance/balances.js';
import {
  applyBetLedgerPlan,
  assertAvailableNotNegative,
  betFinancialSnapshot,
  desiredBetLedgerLines,
  effectiveBetAmount,
  effectiveBetReturn,
  liveBetLedgerRows,
  planBetLedgerChange,
  recordBetCorrection,
} from '../src/finance/bet-ledger.js';
import { createTestApp, type TestApp } from './support/create-app.js';
import { insertBet, insertHouse, insertProject, insertStage } from './support/factories.js';

/**
 * Fase 8.5.1 (§112.1, §112.4, ADR 0019): el motor de efecto financiero y el validador de línea de
 * tiempo, con PostgreSQL real. Aún sin endpoints: se ejercitan como los usarán las subfases 8.5.2 y
 * 8.5.3 (transacción, bloqueo financiero, plan, corrección y aplicación).
 */
describe('motor de efecto financiero de una apuesta (PostgreSQL real, §112.1, §112.4)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let projectId: string;
  let stage: StageRow;
  let house: HouseRow;
  let otherHouse: HouseRow;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const at = (iso: string) => new Date(iso);
  const D1 = at('2026-06-01T10:00:00.000Z');
  const D2 = at('2026-06-02T10:00:00.000Z');
  const D3 = at('2026-06-03T10:00:00.000Z');
  const D4 = at('2026-06-04T10:00:00.000Z');
  const NOW = at('2026-06-10T12:00:00.000Z');

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Grupo' })).project.id;
    stage = await insertStage(ctx.t.db, { projectId }); // unidad 10.00
    house = await insertHouse(ctx.t.db, { projectId });
    otherHouse = await insertHouse(ctx.t.db, { projectId });
    await deposit(house.id, '100.00', at('2026-05-01T10:00:00.000Z'));
    await deposit(otherHouse.id, '100.00', at('2026-05-01T10:00:00.000Z'));
  });

  async function deposit(houseId: string, amount: string, occurredAt: Date) {
    await ctx.t.db.insert(financialMovements).values({
      projectId,
      stageId: stage.id,
      type: 'DEPOSIT',
      direction: 'CREDIT',
      houseId,
      amount,
      occurredAt,
      createdBy: owner.id,
    });
  }
  async function withdraw(houseId: string, amount: string, occurredAt: Date) {
    await ctx.t.db.insert(financialMovements).values({
      projectId,
      stageId: stage.id,
      type: 'WITHDRAWAL',
      direction: 'DEBIT',
      houseId,
      amount,
      reason: 'Retiro de prueba',
      occurredAt,
      createdBy: owner.id,
    });
  }

  /** Apuesta de S/ 20.00 (stake 2 × unidad 10) con su ledger, como la dejaría `BetsService.settle`. */
  async function seedBet(overrides: Partial<NewBet> = {}, houseId = house.id): Promise<BetRow> {
    const { bet } = await insertBet(ctx.t.db, {
      projectId,
      stageId: stage.id,
      houseId,
      createdBy: owner.id,
      stakeAmount: '2.00',
      officialAmount: '20.00',
      status: 'WON',
      officialRealizedReturn: '39.00',
      placedAt: D2,
      settledAt: D3,
      ...overrides,
    });
    await writeLines(bet);
    return bet;
  }
  async function writeLines(bet: BetRow) {
    for (const line of desiredBetLedgerLines(bet, stage)) {
      await ctx.t.db.insert(financialMovements).values({
        projectId,
        stageId: bet.stageId,
        operationId: bet.id,
        createdBy: owner.id,
        ...line,
      });
    }
  }

  /** Efecto neto del ledger sobre la casa de la apuesta (crédito − débito, con reversiones). */
  async function netEffect(betId: string): Promise<MoneyString> {
    const rows = await ctx.t.db
      .select()
      .from(financialMovements)
      .where(eq(financialMovements.operationId, betId));
    return rows.reduce<MoneyString>(
      (sum, row) =>
        row.direction === 'CREDIT' ? addMoney(sum, row.amount) : subtractMoney(sum, row.amount),
      ZERO_MONEY,
    );
  }
  /** Cuerpo de la respuesta HTTP con que se rechazó la operación (código, mensaje y detalles). */
  async function rejectionOf(promise: Promise<unknown>): Promise<ApiErrorBody> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error, 'se esperaba un rechazo').toBeInstanceOf(AppError);
    return (error as AppError).getResponse() as ApiErrorBody;
  }
  const balanceOf = async (houseId: string) =>
    (await computeHouseBalance(ctx.t.db, projectId, houseId)).balance;

  /**
   * Flujo completo de una corrección, como lo harán las subfases siguientes: transacción, bloqueo
   * financiero, cambio de la apuesta, plan, registro de la corrección y aplicación.
   */
  async function correct(
    betId: string,
    patch: Partial<NewBet>,
    kind:
      | 'SETTLEMENT_CORRECTION'
      | 'REOPEN'
      | 'TRASH_REVERSAL'
      | 'RESTORE_REPOST' = 'SETTLEMENT_CORRECTION',
    executor: DbExecutor = ctx.t.db,
  ) {
    const run = async (tx: DbExecutor) => {
      await lockByKey(tx, `finance:${projectId}`);
      const [before] = await tx.select().from(bets).where(eq(bets.id, betId));
      const [after] = await tx.update(bets).set(patch).where(eq(bets.id, betId)).returning();
      const plan = await planBetLedgerChange(tx, {
        projectId,
        betId,
        desired: desiredBetLedgerLines(after!, stage),
        now: NOW,
      });
      const correction = await recordBetCorrection(tx, {
        projectId,
        betId,
        kind,
        before: betFinancialSnapshot(before!),
        after: betFinancialSnapshot(after!),
        reason: 'Corrección de prueba',
        actorId: owner.id,
      });
      const applied = await applyBetLedgerPlan(tx, plan, {
        actorId: owner.id,
        correctionId: correction.id,
        reason: 'Corrección de prueba',
        stageId: after!.stageId,
      });
      await assertAvailableNotNegative(tx, projectId, plan.affectedHouseIds);
      return { plan, applied, correction, after: after! };
    };
    return executor === ctx.t.db ? ctx.t.db.transaction(run) : run(executor);
  }

  describe('efecto deseado (§107.2, §107.3)', () => {
    it('una apuesta pendiente o en la papelera no tiene efecto en el ledger', async () => {
      const { bet } = await insertBet(ctx.t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
        stakeAmount: '2.00',
      });
      expect(desiredBetLedgerLines(bet, stage)).toEqual([]);
      const trashed = {
        ...(await seedBet()),
        deletedAt: NOW,
      } as BetRow;
      expect(desiredBetLedgerLines(trashed, stage)).toEqual([]);
    });

    it('ganada: colocación (débito) el día de colocación y liquidación (crédito) el de liquidación', async () => {
      const bet = await seedBet({}, house.id);
      expect(desiredBetLedgerLines(bet, stage)).toEqual([
        {
          type: 'BET_PLACEMENT',
          direction: 'DEBIT',
          houseId: house.id,
          amount: '20.00',
          occurredAt: D2,
        },
        {
          type: 'BET_SETTLEMENT',
          direction: 'CREDIT',
          houseId: house.id,
          amount: '39.00',
          occurredAt: D3,
        },
      ]);
    });

    it('perdida: solo la colocación; un retorno de cero tampoco genera liquidación (D-B2)', async () => {
      const lost = await seedBet({ status: 'LOST', officialRealizedReturn: null });
      expect(desiredBetLedgerLines(lost, stage).map((line) => line.type)).toEqual([
        'BET_PLACEMENT',
      ]);
      const zeroCashout = await seedBet({ status: 'CASHOUT', officialRealizedReturn: '0.00' });
      expect(desiredBetLedgerLines(zeroCashout, stage).map((line) => line.type)).toEqual([
        'BET_PLACEMENT',
      ]);
    });

    it('sin monto oficial usa stake × unidad; el retorno efectivo prefiere el oficial al calculado', async () => {
      const bet = await seedBet({
        officialAmount: null,
        status: 'WON',
        officialRealizedReturn: null,
        calculatedRealizedReturn: '39.00',
      });
      expect(effectiveBetAmount(bet, stage)).toBe('20.00');
      expect(effectiveBetReturn(bet)).toBe('39.00');
      expect(
        effectiveBetReturn({ officialRealizedReturn: '38.50', calculatedRealizedReturn: '39.00' }),
      ).toBe('38.50');
      expect(
        effectiveBetReturn({ officialRealizedReturn: null, calculatedRealizedReturn: null }),
      ).toBeNull();
    });
  });

  describe('filas vigentes y plan sin cambios', () => {
    it('una apuesta cuyo ledger ya es correcto no genera ninguna fila', async () => {
      const bet = await seedBet();
      const plan = await planBetLedgerChange(ctx.t.db, {
        projectId,
        betId: bet.id,
        desired: desiredBetLedgerLines(bet, stage),
        now: NOW,
      });
      expect(plan).toMatchObject({
        changed: false,
        reversals: [],
        inserts: [],
        conflicts: [],
        earliestAffectedAt: null,
        affectedHouseIds: [],
      });
      expect(plan.kept).toHaveLength(2);
      const before = await ctx.t.db.select().from(financialMovements);
      await ctx.t.db.transaction((tx) =>
        applyBetLedgerPlan(tx, plan, {
          actorId: owner.id,
          correctionId: '019a0000-0000-7000-8000-000000000009',
          reason: 'sin efecto',
          stageId: stage.id,
        }),
      );
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(before.length);
    });

    it('las filas revertidas dejan de ser vigentes; las reversiones nunca lo son', async () => {
      const bet = await seedBet();
      await correct(bet.id, { officialRealizedReturn: '45.00' });
      const live = await liveBetLedgerRows(ctx.t.db, projectId, bet.id);
      expect(live.map((row) => [row.type, row.amount])).toEqual([
        ['BET_PLACEMENT', '20.00'],
        ['BET_SETTLEMENT', '45.00'],
      ]);
    });
  });

  describe('correcciones (reversión más re-registro, D-A1, D-A2)', () => {
    it('corregir solo el retorno revierte la liquidación y conserva la colocación', async () => {
      const bet = await seedBet();
      const { plan, applied, correction } = await correct(bet.id, {
        officialRealizedReturn: '45.00',
      });

      expect(plan.reversals.map((row) => row.type)).toEqual(['BET_SETTLEMENT']);
      expect(plan.inserts.map((line) => [line.type, line.amount])).toEqual([
        ['BET_SETTLEMENT', '45.00'],
      ]);
      expect(plan.kept.map((row) => row.type)).toEqual(['BET_PLACEMENT']);
      expect(applied.reversalIds).toHaveLength(1);

      const rows = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.operationId, bet.id));
      expect(rows).toHaveLength(4); // colocación, liquidación, reversión, liquidación nueva
      const reversal = rows.find((row) => row.type === 'REVERSAL')!;
      expect(reversal).toMatchObject({
        direction: 'DEBIT',
        amount: '39.00',
        houseId: house.id,
        correctionId: correction.id,
        reason: 'Corrección de prueba',
      });
      // D-A2: la reversión conserva la fecha efectiva de la fila que anula.
      expect(reversal.occurredAt.toISOString()).toBe(D3.toISOString());
      expect(reversal.reversesMovementId).toBe(
        rows.find((row) => row.type === 'BET_SETTLEMENT' && row.amount === '39.00')!.id,
      );
      // El neto de la apuesta es su ganancia: 45.00 − 20.00.
      expect(await netEffect(bet.id)).toBe('25.00');
      expect(await balanceOf(house.id)).toBe('125.00'); // 100 − 20 + 45
    });

    it('ganada → perdida: solo se revierte la liquidación y el neto pasa a ser −monto', async () => {
      const bet = await seedBet();
      await correct(bet.id, { status: 'LOST', officialRealizedReturn: null });
      expect(await netEffect(bet.id)).toBe('-20.00');
      expect(await balanceOf(house.id)).toBe('80.00');
    });

    it('perdida → ganada: se inserta la liquidación que faltaba', async () => {
      const bet = await seedBet({ status: 'LOST', officialRealizedReturn: null });
      const { plan } = await correct(bet.id, { status: 'WON', officialRealizedReturn: '39.00' });
      expect(plan.reversals).toHaveLength(0);
      expect(plan.inserts.map((line) => line.type)).toEqual(['BET_SETTLEMENT']);
      expect(await netEffect(bet.id)).toBe('19.00');
    });

    it('reabrir (efecto deseado vacío) revierte todo y devuelve el saldo original', async () => {
      const bet = await seedBet();
      expect(await balanceOf(house.id)).toBe('119.00');
      const { plan } = await correct(
        bet.id,
        {
          status: 'PENDING',
          settledAt: null,
          officialRealizedReturn: null,
          calculatedRealizedReturn: null,
        },
        'REOPEN',
      );
      expect(plan.reversals).toHaveLength(2);
      expect(plan.inserts).toHaveLength(0);
      expect(await liveBetLedgerRows(ctx.t.db, projectId, bet.id)).toEqual([]);
      expect(await netEffect(bet.id)).toBe('0.00');
      // La apuesta pendiente vuelve a comprometer su monto: 100 de saldo, 20 comprometidos.
      expect(await computeHouseBalance(ctx.t.db, projectId, house.id)).toMatchObject({
        balance: '100.00',
        committed: '20.00',
        available: '80.00',
      });
    });

    it('papelera y restauración de una liquidada: reversión completa y re-registro', async () => {
      const bet = await seedBet();
      await correct(bet.id, { deletedAt: NOW, purgeEligibleAt: NOW }, 'TRASH_REVERSAL');
      expect(await netEffect(bet.id)).toBe('0.00');
      expect(await balanceOf(house.id)).toBe('100.00');

      const { plan } = await correct(
        bet.id,
        { deletedAt: null, purgeEligibleAt: null },
        'RESTORE_REPOST',
      );
      expect(plan.reversals).toHaveLength(0);
      expect(plan.inserts).toHaveLength(2);
      expect(await netEffect(bet.id)).toBe('19.00');
      expect(await balanceOf(house.id)).toBe('119.00');
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(2);
    });

    it('cambiar la fecha de colocación revierte y vuelve a registrar solo la colocación', async () => {
      const bet = await seedBet();
      const { plan } = await correct(bet.id, { placedAt: D1 });
      expect(plan.reversals.map((row) => row.type)).toEqual(['BET_PLACEMENT']);
      expect(plan.inserts).toEqual([
        {
          type: 'BET_PLACEMENT',
          direction: 'DEBIT',
          houseId: house.id,
          amount: '20.00',
          occurredAt: D1,
        },
      ]);
      // La base de la invalidación de checkpoints es la fecha más antigua de lo afectado (§112.5).
      expect(plan.earliestAffectedAt?.toISOString()).toBe(D1.toISOString());
      expect(await netEffect(bet.id)).toBe('19.00');
    });

    it('cambiar de casa revierte en la anterior y registra en la nueva', async () => {
      const bet = await seedBet();
      const { plan } = await correct(bet.id, { houseId: otherHouse.id });
      expect(plan.reversals).toHaveLength(2);
      expect(plan.inserts).toHaveLength(2);
      expect(new Set(plan.affectedHouseIds)).toEqual(new Set([house.id, otherHouse.id]));
      expect(await balanceOf(house.id)).toBe('100.00');
      expect(await balanceOf(otherHouse.id)).toBe('119.00');
    });

    it('las filas nuevas llevan la etapa vigente; la etapa histórica de las conservadas no cambia (D-A9)', async () => {
      const bet = await seedBet();
      const closed = await insertStage(ctx.t.db, { projectId, name: 'Nueva', status: 'CLOSED' });
      await ctx.t.db.update(bets).set({ stageId: closed.id }).where(eq(bets.id, bet.id));
      await correct(bet.id, { officialRealizedReturn: '45.00' });
      const rows = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.operationId, bet.id));
      const byAmount = (amount: string, type: string) =>
        rows.find((row) => row.amount === amount && row.type === type)!;
      expect(byAmount('20.00', 'BET_PLACEMENT').stageId).toBe(stage.id); // conservada
      expect(byAmount('39.00', 'REVERSAL').stageId).toBe(stage.id); // como la original
      expect(byAmount('45.00', 'BET_SETTLEMENT').stageId).toBe(closed.id); // nueva
    });

    it('corregir dos veces con el mismo resultado no duplica filas (idempotente)', async () => {
      const bet = await seedBet();
      await correct(bet.id, { officialRealizedReturn: '45.00' });
      const rowsAfterFirst = await ctx.t.db.select().from(financialMovements);
      const { plan } = await correct(bet.id, { officialRealizedReturn: '45.00' });
      expect(plan.changed).toBe(false);
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(rowsAfterFirst.length);
    });

    it('varias correcciones seguidas mantienen el neto igual a la ganancia derivada', async () => {
      const bet = await seedBet();
      await correct(bet.id, { officialRealizedReturn: '45.00' });
      expect(await netEffect(bet.id)).toBe('25.00');
      await correct(bet.id, { status: 'LOST', officialRealizedReturn: null });
      expect(await netEffect(bet.id)).toBe('-20.00');
      await correct(bet.id, { status: 'WON', officialRealizedReturn: '30.00' });
      expect(await netEffect(bet.id)).toBe('10.00');
      await correct(bet.id, { status: 'CASHOUT', officialRealizedReturn: '12.50' });
      expect(await netEffect(bet.id)).toBe('-7.50');
      await correct(bet.id, { status: 'VOID', officialRealizedReturn: '20.00' });
      expect(await netEffect(bet.id)).toBe('0.00');
      expect(await balanceOf(house.id)).toBe('100.00');
    });
  });

  describe('validación de la línea de tiempo (§74, D-A5)', () => {
    /**
     * Historia: +100 (mayo), colocación −20 (D2), liquidación +39 (D3) y un retiro de 110 (D4) que
     * solo cabe gracias a esa liquidación.
     */
    async function historyThatDependsOnTheWin(): Promise<BetRow> {
      const bet = await seedBet();
      await withdraw(house.id, '110.00', D4);
      return bet;
    }

    it('rechaza una corrección que dejaría un saldo negativo en el historial, sin escribir nada', async () => {
      const bet = await historyThatDependsOnTheWin();
      const before = await ctx.t.db.select().from(financialMovements);
      const [withdrawal] = before.filter((row) => row.type === 'WITHDRAWAL');

      const attempt = correct(bet.id, { status: 'LOST', officialRealizedReturn: null });
      expect(await rejectionOf(attempt)).toMatchObject({
        statusCode: 409,
        code: 'CORRECTION_CONFLICT',
        details: {
          conflicts: [
            {
              houseId: house.id,
              occurredAt: D4.toISOString(),
              balance: '-30.00',
              movementIds: [withdrawal!.id],
            },
          ],
        },
      });
      // Todo se revirtió: ni filas del ledger ni corrección registrada ni cambio en la apuesta.
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(before.length);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(0);
      expect((await ctx.t.db.select().from(bets).where(eq(bets.id, bet.id)))[0]!.status).toBe(
        'WON',
      );
    });

    it('la misma corrección es válida si el retiro posterior sí cabe', async () => {
      const bet = await seedBet();
      await withdraw(house.id, '80.00', D4); // 119 − 80 = 39; sin la liquidación: 80 − 80 = 0
      await correct(bet.id, { status: 'LOST', officialRealizedReturn: null });
      expect(await balanceOf(house.id)).toBe('0.00');
    });

    it('el plan informa los conflictos sin escribir (sirve para la vista previa)', async () => {
      const bet = await historyThatDependsOnTheWin();
      const [lost] = await ctx.t.db
        .update(bets)
        .set({ status: 'LOST', officialRealizedReturn: null })
        .where(eq(bets.id, bet.id))
        .returning();
      const rowsBefore = await ctx.t.db.select().from(financialMovements);
      const plan = await planBetLedgerChange(ctx.t.db, {
        projectId,
        betId: bet.id,
        desired: desiredBetLedgerLines(lost!, stage),
        now: NOW,
      });
      expect(plan.changed).toBe(true);
      expect(plan.conflicts).toHaveLength(1);
      expect(plan.reversals.map((row) => row.type)).toEqual(['BET_SETTLEMENT']);
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(rowsBefore.length);
    });

    it('un saldo negativo que ya existía en la historia no se atribuye a la corrección', async () => {
      const bet = await seedBet({}, otherHouse.id);
      // Historia real ya inconsistente en esa casa (retiro fechado antes de cualquier depósito).
      await withdraw(otherHouse.id, '500.00', at('2026-04-01T10:00:00.000Z'));
      const [changed] = await ctx.t.db
        .update(bets)
        .set({ officialRealizedReturn: '45.00' })
        .where(eq(bets.id, bet.id))
        .returning();
      const plan = await planBetLedgerChange(ctx.t.db, {
        projectId,
        betId: bet.id,
        desired: desiredBetLedgerLines(changed!, stage),
        now: NOW,
      });
      expect(plan.changed).toBe(true);
      expect(plan.conflicts).toEqual([]);
    });

    it('una corrección en el pasado se valida contra las operaciones posteriores', async () => {
      const bet = await seedBet({ placedAt: D3, settledAt: D4 });
      // Mover la colocación de 20.00 a antes del depósito inicial deja la casa en negativo ese día.
      await expect(
        correct(bet.id, { placedAt: at('2026-04-15T10:00:00.000Z') }),
      ).rejects.toMatchObject({ code: 'CORRECTION_CONFLICT' });
    });

    it('cambiar de casa valida ambas líneas de tiempo', async () => {
      const bet = await seedBet();
      await withdraw(otherHouse.id, '100.00', D1); // la otra casa queda en 0 antes de D2
      expect(await rejectionOf(correct(bet.id, { houseId: otherHouse.id }))).toMatchObject({
        code: 'CORRECTION_CONFLICT',
        details: { conflicts: [{ houseId: otherHouse.id }] },
      });
    });
  });

  describe('disponible tras la corrección', () => {
    it('reabrir una apuesta cuyo monto ya no está disponible se rechaza y se revierte todo', async () => {
      const bet = await seedBet();
      // El retiro de 110 en D4 solo cabe gracias a la liquidación: reabrir dejaría el saldo en negativo.
      await withdraw(house.id, '110.00', D4);
      const before = await ctx.t.db.select().from(financialMovements);
      await expect(
        correct(
          bet.id,
          {
            status: 'PENDING',
            settledAt: null,
            officialRealizedReturn: null,
            calculatedRealizedReturn: null,
          },
          'REOPEN',
        ),
      ).rejects.toMatchObject({ code: 'CORRECTION_CONFLICT' });
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(before.length);
    });

    it('assertAvailableNotNegative rechaza un disponible negativo y explica la casa', async () => {
      // 100 de saldo y una apuesta pendiente de 20 sobre otra de 90: comprometido 110 > 100.
      await insertBet(ctx.t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
        stakeAmount: '2.00',
      });
      await insertBet(ctx.t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
        stakeAmount: '9.00',
      });
      expect(
        await rejectionOf(assertAvailableNotNegative(ctx.t.db, projectId, [house.id])),
      ).toMatchObject({
        statusCode: 409,
        code: 'CORRECTION_CONFLICT',
        details: { houses: [{ houseId: house.id, available: '-10.00' }] },
      });
      await assertAvailableNotNegative(ctx.t.db, projectId, [otherHouse.id]);
    });
  });

  describe('concurrencia', () => {
    it('dos reaperturas simultáneas de la misma apuesta: una revierte y la otra no encuentra nada', async () => {
      const bet = await seedBet();
      const reopen = () =>
        correct(
          bet.id,
          {
            status: 'PENDING',
            settledAt: null,
            officialRealizedReturn: null,
            calculatedRealizedReturn: null,
          },
          'REOPEN',
          // Cada una en su propia transacción, bajo el bloqueo financiero del proyecto.
          undefined,
        );
      const results = await Promise.all([reopen(), reopen()]);
      expect(results.map((result) => result.plan.reversals.length).sort()).toEqual([0, 2]);
      const reversals = (await ctx.t.db.select().from(financialMovements)).filter(
        (row) => row.type === 'REVERSAL',
      );
      expect(reversals).toHaveLength(2); // nunca una fila anulada dos veces
      expect(await netEffect(bet.id)).toBe('0.00');
    });
  });

  it('recordBetCorrection guarda el antes y el después de los campos financieros', async () => {
    const bet = await seedBet();
    const { correction } = await correct(bet.id, { officialRealizedReturn: '45.00' });
    expect(correction).toMatchObject({
      kind: 'SETTLEMENT_CORRECTION',
      reason: 'Corrección de prueba',
      createdBy: owner.id,
      before: { status: 'WON', officialRealizedReturn: '39.00', trashed: false },
      after: { status: 'WON', officialRealizedReturn: '45.00', trashed: false },
    });
  });
});
