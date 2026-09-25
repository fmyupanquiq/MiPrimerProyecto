import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraintName,
  pgErrorCode,
} from '../src/database/pg-errors.js';
import { computeHouseBalance } from '../src/finance/balances.js';
import {
  betCorrections,
  bets,
  financialMovements,
  type BetRow,
  type FinancialMovementRow,
  type HouseRow,
  type NewFinancialMovement,
  type StageRow,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, type TestApp } from './support/create-app.js';
import { insertBet, insertHouse, insertProject, insertStage } from './support/factories.js';

/**
 * Fase 8.5.1 (§112, ADR 0019): el esquema del ledger acepta reversiones y correcciones de apuestas
 * solo cuando son coherentes, y el motor de la base de datos (CHECK, índice único y disparadores)
 * lo garantiza aunque la aplicación falle.
 */
describe('esquema de reversiones y correcciones (PostgreSQL real, §112.1)', () => {
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

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Grupo' })).project.id;
    stage = await insertStage(ctx.t.db, { projectId });
    house = await insertHouse(ctx.t.db, { projectId });
    otherHouse = await insertHouse(ctx.t.db, { projectId });
  });

  const at = (iso: string) => new Date(iso);

  async function insertMovement(
    overrides: Partial<NewFinancialMovement> = {},
  ): Promise<FinancialMovementRow> {
    const [row] = await ctx.t.db
      .insert(financialMovements)
      .values({
        projectId,
        stageId: stage.id,
        type: 'DEPOSIT',
        direction: 'CREDIT',
        houseId: house.id,
        amount: '100.00',
        occurredAt: at('2026-06-01T10:00:00.000Z'),
        createdBy: owner.id,
        ...overrides,
      })
      .returning();
    return row!;
  }

  /** Reversión válida de `original`, con los campos que el disparador exige. */
  const reversalOf = (
    original: FinancialMovementRow,
    overrides: Partial<NewFinancialMovement> = {},
  ): NewFinancialMovement => ({
    projectId: original.projectId,
    stageId: original.stageId,
    type: 'REVERSAL',
    direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
    houseId: original.houseId,
    amount: original.amount,
    operationId: original.operationId,
    occurredAt: original.occurredAt,
    reversesMovementId: original.id,
    reason: 'Corrección de prueba',
    createdBy: owner.id,
    ...overrides,
  });

  async function expectViolation(
    promise: Promise<unknown>,
    code: string,
    constraint?: string,
  ): Promise<void> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error, 'se esperaba un error de la base de datos').not.toBeNull();
    expect(pgErrorCode(error)).toBe(code);
    if (constraint) expect(pgConstraintName(error)).toBe(constraint);
  }

  describe('reversión de una fila del ledger', () => {
    it('acepta una reversión coherente y el saldo de la casa vuelve al de antes', async () => {
      const original = await insertMovement({ amount: '100.00' });
      expect((await computeHouseBalance(ctx.t.db, projectId, house.id)).balance).toBe('100.00');

      const [reversal] = await ctx.t.db
        .insert(financialMovements)
        .values(reversalOf(original))
        .returning();
      expect(reversal).toMatchObject({
        type: 'REVERSAL',
        direction: 'DEBIT',
        reversesMovementId: original.id,
        operationId: original.operationId,
      });
      expect((await computeHouseBalance(ctx.t.db, projectId, house.id)).balance).toBe('0.00');
    });

    it('revierte también un débito (dirección opuesta: crédito)', async () => {
      await insertMovement({ amount: '100.00' });
      const placement = await insertMovement({
        type: 'BET_PLACEMENT',
        direction: 'DEBIT',
        amount: '20.00',
        occurredAt: at('2026-06-01T11:00:00.000Z'),
      });
      const [reversal] = await ctx.t.db
        .insert(financialMovements)
        .values(reversalOf(placement))
        .returning();
      expect(reversal!.direction).toBe('CREDIT');
      expect((await computeHouseBalance(ctx.t.db, projectId, house.id)).balance).toBe('100.00');
    });

    it('rechaza una reversión sin la fila que anula, y la fila que anula sin ser reversión', async () => {
      const original = await insertMovement();
      await expectViolation(
        ctx.t.db
          .insert(financialMovements)
          .values(reversalOf(original, { reversesMovementId: null })),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_shape',
      );
      await expectViolation(
        ctx.t.db.insert(financialMovements).values({
          projectId,
          stageId: stage.id,
          type: 'DEPOSIT',
          direction: 'CREDIT',
          houseId: house.id,
          amount: '5.00',
          reversesMovementId: original.id,
          createdBy: owner.id,
        }),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_shape',
      );
    });

    it('exige un motivo en la reversión', async () => {
      const original = await insertMovement();
      for (const reason of [null, '', '   ']) {
        await expectViolation(
          ctx.t.db.insert(financialMovements).values(reversalOf(original, { reason })),
          PG_CHECK_VIOLATION,
          'financial_movements_reason_required',
        );
      }
    });

    it('una fila no se puede anular dos veces', async () => {
      const original = await insertMovement();
      await ctx.t.db.insert(financialMovements).values(reversalOf(original));
      await expectViolation(
        ctx.t.db.insert(financialMovements).values(reversalOf(original)),
        PG_UNIQUE_VIOLATION,
        'financial_movements_one_reversal_per_row',
      );
    });

    it('el disparador exige coincidencia exacta con la fila original', async () => {
      const original = await insertMovement({ amount: '100.00' });
      const mismatches: Partial<NewFinancialMovement>[] = [
        { amount: '99.99' },
        { houseId: otherHouse.id },
        { direction: original.direction }, // misma dirección
        { occurredAt: at('2026-06-02T10:00:00.000Z') },
        { operationId: '019a0000-0000-7000-8000-000000000001' },
      ];
      for (const mismatch of mismatches) {
        await expectViolation(
          ctx.t.db.insert(financialMovements).values(reversalOf(original, mismatch)),
          PG_CHECK_VIOLATION,
          'financial_movements_reversal_match',
        );
      }
      const otherStage = await insertStage(ctx.t.db, {
        projectId,
        name: 'Otra etapa',
        status: 'CLOSED',
      });
      await expectViolation(
        ctx.t.db
          .insert(financialMovements)
          .values(reversalOf(original, { stageId: otherStage.id })),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_match',
      );
      // Nada se escribió: solo queda la fila original.
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(1);
    });

    it('rechaza una reversión de otro proyecto', async () => {
      const original = await insertMovement();
      const other = (await insertProject(ctx.t.db, { owner, name: 'Otro' })).project.id;
      const otherProjectStage = await insertStage(ctx.t.db, { projectId: other });
      const otherProjectHouse = await insertHouse(ctx.t.db, { projectId: other });
      await expectViolation(
        ctx.t.db.insert(financialMovements).values(
          reversalOf(original, {
            projectId: other,
            stageId: otherProjectStage.id,
            houseId: otherProjectHouse.id,
          }),
        ),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_match',
      );
    });

    it('no se revierte una reversión ni una transferencia', async () => {
      const original = await insertMovement();
      const [reversal] = await ctx.t.db
        .insert(financialMovements)
        .values(reversalOf(original))
        .returning();
      await expectViolation(
        ctx.t.db.insert(financialMovements).values(reversalOf(reversal!)),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_match',
      );

      const transfer = await insertMovement({
        type: 'TRANSFER',
        direction: null,
        houseId: null,
        fromHouseId: house.id,
        toHouseId: otherHouse.id,
        amount: '10.00',
      });
      await expectViolation(
        ctx.t.db
          .insert(financialMovements)
          .values(reversalOf(transfer, { direction: 'CREDIT', houseId: house.id })),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_match',
      );
    });

    it('la reversión apunta a una fila que existe', async () => {
      const original = await insertMovement();
      await expectViolation(
        ctx.t.db
          .insert(financialMovements)
          .values(
            reversalOf(original, { reversesMovementId: '019a0000-0000-7000-8000-000000000002' }),
          ),
        PG_CHECK_VIOLATION,
        'financial_movements_reversal_match',
      );
    });

    it('una reversión es inmutable, como cualquier fila del ledger', async () => {
      const original = await insertMovement();
      const [reversal] = await ctx.t.db
        .insert(financialMovements)
        .values(reversalOf(original))
        .returning();
      await expectViolation(
        ctx.t.db
          .update(financialMovements)
          .set({ amount: '1.00' })
          .where(eq(financialMovements.id, reversal!.id)),
        PG_RESTRICT_VIOLATION,
      );
      await expectViolation(
        ctx.t.db.delete(financialMovements).where(eq(financialMovements.id, reversal!.id)),
        PG_RESTRICT_VIOLATION,
      );
    });
  });

  describe('bet_corrections', () => {
    let bet: BetRow;
    beforeEach(async () => {
      bet = (
        await insertBet(ctx.t.db, {
          projectId,
          stageId: stage.id,
          houseId: house.id,
          createdBy: owner.id,
        })
      ).bet;
    });

    const correction = (overrides: Partial<typeof betCorrections.$inferInsert> = {}) => ({
      projectId,
      betId: bet.id,
      kind: 'SETTLEMENT_CORRECTION' as const,
      before: { status: 'WON' },
      after: { status: 'LOST' },
      reason: 'Se liquidó por error',
      createdBy: owner.id,
      ...overrides,
    });

    it('registra una corrección y las filas del ledger pueden apuntar a ella', async () => {
      const [row] = await ctx.t.db.insert(betCorrections).values(correction()).returning();
      const original = await insertMovement();
      const [reversal] = await ctx.t.db
        .insert(financialMovements)
        .values(reversalOf(original, { correctionId: row!.id }))
        .returning();
      expect(reversal!.correctionId).toBe(row!.id);
    });

    it('exige motivo, salvo al confirmar el retorno oficial', async () => {
      for (const reason of [null, '', '   ']) {
        for (const kind of [
          'SETTLEMENT_CORRECTION',
          'REOPEN',
          'TRASH_REVERSAL',
          'RESTORE_REPOST',
        ] as const) {
          await expectViolation(
            ctx.t.db.insert(betCorrections).values(correction({ kind, reason })),
            PG_CHECK_VIOLATION,
            'bet_corrections_reason_required',
          );
        }
      }
      await ctx.t.db
        .insert(betCorrections)
        .values(correction({ kind: 'RETURN_CONFIRMATION', reason: null }));
    });

    it('es un histórico de solo inserción: no se edita, no se borra, no se vacía', async () => {
      const [row] = await ctx.t.db.insert(betCorrections).values(correction()).returning();
      await expectViolation(
        ctx.t.db
          .update(betCorrections)
          .set({ reason: 'Reescrito' })
          .where(eq(betCorrections.id, row!.id)),
        PG_RESTRICT_VIOLATION,
      );
      await expectViolation(
        ctx.t.db.delete(betCorrections).where(eq(betCorrections.id, row!.id)),
        PG_RESTRICT_VIOLATION,
      );
      // Vaciarla también lo impiden el disparador y las claves foráneas que apuntan a ella.
      await expect(ctx.t.pool.query('TRUNCATE bet_corrections')).rejects.toBeDefined();
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(1);
    });

    it('una fila del ledger no puede apuntar a una corrección inexistente', async () => {
      const original = await insertMovement();
      await expectViolation(
        ctx.t.db
          .insert(financialMovements)
          .values(reversalOf(original, { correctionId: '019a0000-0000-7000-8000-000000000003' })),
        '23503',
      );
    });
  });

  describe('forma de una apuesta liquidada (bets_settlement_shape)', () => {
    const settled = (overrides: Partial<typeof bets.$inferInsert>) =>
      insertBet(ctx.t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
        settledAt: at('2026-06-02T10:00:00.000Z'),
        ...overrides,
      });

    it('una ganada puede tener solo retorno calculado, solo oficial o ambos', async () => {
      await settled({ status: 'WON', calculatedRealizedReturn: '39.00' });
      await settled({ status: 'WON', officialRealizedReturn: '39.00' });
      await settled({
        status: 'WON',
        officialRealizedReturn: '38.99',
        calculatedRealizedReturn: '39.00',
      });
    });

    it('una ganada sin ningún retorno se rechaza', async () => {
      await expectViolation(
        settled({ status: 'WON' }),
        PG_CHECK_VIOLATION,
        'bets_settlement_shape',
      );
    });

    it('anulada y cash out exigen retorno oficial y no admiten calculado', async () => {
      for (const status of ['VOID', 'CASHOUT'] as const) {
        await settled({ status, officialRealizedReturn: '20.00' });
        await expectViolation(
          settled({ status, calculatedRealizedReturn: '20.00' }),
          PG_CHECK_VIOLATION,
          'bets_settlement_shape',
        );
        await expectViolation(
          settled({
            status,
            officialRealizedReturn: '20.00',
            calculatedRealizedReturn: '20.00',
          }),
          PG_CHECK_VIOLATION,
          'bets_settlement_shape',
        );
      }
    });

    it('una perdida y una pendiente no tienen retorno de ningún tipo', async () => {
      await settled({ status: 'LOST' });
      await expectViolation(
        settled({ status: 'LOST', calculatedRealizedReturn: '1.00' }),
        PG_CHECK_VIOLATION,
        'bets_settlement_shape',
      );
      await expectViolation(
        insertBet(ctx.t.db, {
          projectId,
          stageId: stage.id,
          houseId: house.id,
          createdBy: owner.id,
          calculatedRealizedReturn: '1.00',
        }),
        PG_CHECK_VIOLATION,
        'bets_settlement_shape',
      );
    });

    it('los retornos no pueden ser negativos', async () => {
      await expectViolation(
        settled({ status: 'WON', calculatedRealizedReturn: '-1.00' }),
        PG_CHECK_VIOLATION,
        'bets_returns_nonneg',
      );
      await expectViolation(
        settled({ status: 'WON', officialRealizedReturn: '-1.00' }),
        PG_CHECK_VIOLATION,
        'bets_returns_nonneg',
      );
    });
  });

  describe('monto confirmado (amount_confirmed)', () => {
    const pending = (overrides: Partial<typeof bets.$inferInsert>) =>
      insertBet(ctx.t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
        ...overrides,
      });

    it('por defecto es falso y con monto oficial puede ser verdadero', async () => {
      expect((await pending({})).bet.amountConfirmed).toBe(false);
      expect((await pending({ officialAmount: '25.00' })).bet.amountConfirmed).toBe(false);
      expect(
        (await pending({ officialAmount: '25.00', amountConfirmed: true })).bet.amountConfirmed,
      ).toBe(true);
    });

    it('no puede estar confirmado sin monto oficial', async () => {
      await expectViolation(
        pending({ amountConfirmed: true }),
        PG_CHECK_VIOLATION,
        'bets_amount_confirmed_requires_official',
      );
    });
  });
});
