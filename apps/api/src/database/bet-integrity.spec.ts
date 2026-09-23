import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  insertBet,
  insertHouse,
  insertProject,
  insertStage,
  insertUser,
} from '../../test/support/factories.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import { PG_CHECK_VIOLATION, PG_RESTRICT_VIOLATION, pgErrorCode } from './pg-errors.js';
import { betSelections, bets, financialMovements } from './schema/index.js';

const code = (expected: string) => (error: unknown) => pgErrorCode(error) === expected;

describe('integridad de apuestas en PostgreSQL (§18-§27, §90, §107, D-B1-D-B7)', () => {
  let t: TestDatabase;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(() => truncateAll(t.pool));

  async function scenario() {
    const { project, owner } = await insertProject(t.db);
    const stage = await insertStage(t.db, { projectId: project.id });
    const house = await insertHouse(t.db, { projectId: project.id });
    return { project, owner, stage, house };
  }

  describe('bets', () => {
    it('se crea pendiente con los valores por defecto', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      expect(bet).toMatchObject({
        status: 'PENDING',
        betType: 'SIMPLE',
        placedTimeKnown: true,
        settledTimeKnown: true,
        officialAmount: null,
        settledAt: null,
        officialRealizedReturn: null,
        deletedAt: null,
        version: 1,
      });
    });

    it('rechaza stake no positivo', async () => {
      const { project, owner, stage, house } = await scenario();
      await expect(
        insertBet(t.db, {
          projectId: project.id,
          stageId: stage.id,
          houseId: house.id,
          createdBy: owner.id,
          stakeAmount: '0',
        }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('rechaza monto oficial y retorno potencial no positivos/negativos', async () => {
      const { project, owner, stage, house } = await scenario();
      const base = {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      };
      await expect(insertBet(t.db, { ...base, officialAmount: '0' })).rejects.toSatisfy(
        code(PG_CHECK_VIOLATION),
      );
      await expect(
        insertBet(t.db, { ...base, officialPotentialReturn: '-1.00' }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('rechaza cuota visible no positiva', async () => {
      const { project, owner, stage, house } = await scenario();
      await expect(
        insertBet(t.db, {
          projectId: project.id,
          stageId: stage.id,
          houseId: house.id,
          createdBy: owner.id,
          visibleTotalOdds: '0',
        }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('la forma de liquidación exige coherencia entre estado, fecha y retorno (D-B2)', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      // PENDING con settledAt: inválido.
      await expect(
        t.db.update(bets).set({ settledAt: new Date() }).where(eq(bets.id, bet.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      // LOST con retorno: inválido (D-B2, la pérdida se determina por su ausencia).
      await expect(
        t.db
          .update(bets)
          .set({ status: 'LOST', settledAt: new Date(), officialRealizedReturn: '5.00' })
          .where(eq(bets.id, bet.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      // LOST sin settledAt: inválido.
      await expect(
        t.db.update(bets).set({ status: 'LOST' }).where(eq(bets.id, bet.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      // LOST válido.
      await t.db
        .update(bets)
        .set({ status: 'LOST', settledAt: new Date() })
        .where(eq(bets.id, bet.id));
      // WON sin retorno: inválido.
      const { bet: pending2 } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      await expect(
        t.db
          .update(bets)
          .set({ status: 'WON', settledAt: new Date() })
          .where(eq(bets.id, pending2.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      // WON válido.
      await t.db
        .update(bets)
        .set({ status: 'WON', settledAt: new Date(), officialRealizedReturn: '20.00' })
        .where(eq(bets.id, pending2.id));
    });

    it('la papelera exige fecha de borrado y de purga a la vez', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      await expect(
        t.db.update(bets).set({ deletedAt: new Date() }).where(eq(bets.id, bet.id)),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      const now = new Date();
      const purge = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      await t.db
        .update(bets)
        .set({ deletedAt: now, purgeEligibleAt: purge })
        .where(eq(bets.id, bet.id));
      const [after] = await t.db.select().from(bets).where(eq(bets.id, bet.id));
      expect(after!.deletedAt).not.toBeNull();
    });

    it('no se elimina físicamente (§26: solo papelera)', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      await expect(t.db.delete(bets).where(eq(bets.id, bet.id))).rejects.toSatisfy(
        code(PG_RESTRICT_VIOLATION),
      );
    });

    it('updated_at avanza al modificar', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await t.db.update(bets).set({ reason: 'nota' }).where(eq(bets.id, bet.id));
      const [after] = await t.db.select().from(bets).where(eq(bets.id, bet.id));
      expect(after!.updatedAt.getTime()).toBeGreaterThan(bet.updatedAt.getTime());
    });
  });

  describe('bet_selections', () => {
    it('rechaza evento/selección en blanco y cuota no positiva', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      await expect(
        t.db.insert(betSelections).values({
          betId: bet.id,
          eventGroup: 0,
          position: 0,
          event: '   ',
          selection: 'Local',
          visibleOdds: '1.50',
        }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        t.db.insert(betSelections).values({
          betId: bet.id,
          eventGroup: 0,
          position: 0,
          event: 'Partido',
          selection: '',
          visibleOdds: '1.50',
        }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        t.db.insert(betSelections).values({
          betId: bet.id,
          eventGroup: 0,
          position: 0,
          event: 'Partido',
          selection: 'Local',
          visibleOdds: '0',
        }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
    });

    it('se puede reemplazar por completo (borrar e insertar de nuevo) sin tocar la apuesta', async () => {
      const { project, owner, stage, house } = await scenario();
      const { bet } = await insertBet(t.db, {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        createdBy: owner.id,
      });
      await t.db.delete(betSelections).where(eq(betSelections.betId, bet.id));
      const remaining = await t.db
        .select()
        .from(betSelections)
        .where(eq(betSelections.betId, bet.id));
      expect(remaining).toHaveLength(0);
      await t.db.insert(betSelections).values({
        betId: bet.id,
        eventGroup: 0,
        position: 0,
        event: 'Nuevo partido',
        selection: 'Empate',
        visibleOdds: '3.20',
      });
      const [selection] = await t.db
        .select()
        .from(betSelections)
        .where(eq(betSelections.betId, bet.id));
      expect(selection).toMatchObject({ event: 'Nuevo partido', selection: 'Empate' });
    });
  });

  describe('ledger: BET_PLACEMENT / BET_SETTLEMENT (§72, §107.3)', () => {
    it('exige la dirección correcta para cada tipo', async () => {
      const { project, stage, house } = await scenario();
      const author = await insertUser(t.db);
      const base = {
        projectId: project.id,
        stageId: stage.id,
        houseId: house.id,
        amount: '10.00',
        createdBy: author.id,
      };
      await expect(
        t.db
          .insert(financialMovements)
          .values({ ...base, type: 'BET_PLACEMENT', direction: 'CREDIT' }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await expect(
        t.db
          .insert(financialMovements)
          .values({ ...base, type: 'BET_SETTLEMENT', direction: 'DEBIT' }),
      ).rejects.toSatisfy(code(PG_CHECK_VIOLATION));
      await t.db
        .insert(financialMovements)
        .values({ ...base, type: 'BET_PLACEMENT', direction: 'DEBIT' });
      await t.db
        .insert(financialMovements)
        .values({ ...base, type: 'BET_SETTLEMENT', direction: 'CREDIT' });
    });
  });
});
