import { createHash } from 'node:crypto';
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
import {
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  pgConstraintName,
  pgErrorCode,
} from './pg-errors.js';
import {
  bets,
  financialMovements,
  importBatches,
  stages,
  type HouseRow,
  type NewFinancialMovement,
  type StageRow,
  type UserRow,
} from './schema/index.js';

const constraint = (name: string) => (error: unknown) =>
  pgErrorCode(error) === PG_CHECK_VIOLATION && pgConstraintName(error) === name;

/**
 * Fase 9.1.2b (§113, ADR 0020): `batch_id`, `occurred_at_known` y `stages.starts_at` conviven con
 * las entidades financieras existentes sin cambiar su comportamiento ordinario.
 */
describe('enlaces de los lotes con bets, movimientos y etapas (PostgreSQL real, §113)', () => {
  let t: TestDatabase;
  let author: UserRow;
  let projectId: string;
  let stage: StageRow;
  let house: HouseRow;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.pool);
    author = await insertUser(t.db);
    projectId = (await insertProject(t.db, { owner: author })).project.id;
    stage = await insertStage(t.db, { projectId });
    house = await insertHouse(t.db, { projectId });
  });

  async function uploadBatch() {
    const bytes = Buffer.from('archivo');
    const [batch] = await t.db
      .insert(importBatches)
      .values({
        projectId,
        originalName: 'Betsafe.xlsx',
        sourceFile: bytes,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceSizeBytes: bytes.length,
        createdBy: author.id,
      })
      .returning();
    return batch!;
  }

  const movement = async (overrides: Partial<NewFinancialMovement> = {}) => {
    const [row] = await t.db
      .insert(financialMovements)
      .values({
        projectId,
        stageId: stage.id,
        houseId: house.id,
        type: 'DEPOSIT',
        direction: 'CREDIT',
        amount: '100.00',
        createdBy: author.id,
        ...overrides,
      })
      .returning();
    return row!;
  };

  describe('sin lote (comportamiento ordinario)', () => {
    it('apuestas, movimientos y etapas nacen sin lote, con fecha conocida y sin inicio', async () => {
      const { bet } = await insertBet(t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: author.id,
      });
      const ledger = await movement();
      expect(bet.batchId).toBeNull();
      expect(ledger).toMatchObject({ batchId: null, occurredAtKnown: true });
      expect(stage).toMatchObject({ batchId: null, startsAt: null });
    });

    it('starts_at puede fijarse o quedar nulo sin afectar a las restricciones de la etapa', async () => {
      const startsAt = new Date('2024-10-22T12:00:00.000Z');
      const [updated] = await t.db
        .update(stages)
        .set({ startsAt })
        .where(eq(stages.id, stage.id))
        .returning();
      expect(updated).toMatchObject({ startsAt, status: 'ACTIVE', unitStake: '10.00' });
      // Sigue habiendo como máximo una etapa activa por proyecto.
      await expect(insertStage(t.db, { projectId, name: 'Otra activa' })).rejects.toSatisfy(
        (error: unknown) => pgErrorCode(error) === '23505',
      );
    });
  });

  describe('con lote', () => {
    it('bets, movimientos y etapas pueden referir un lote existente', async () => {
      const batch = await uploadBatch();
      const historic = await insertStage(t.db, {
        projectId,
        name: 'Ronda 1',
        status: 'CLOSED',
        batchId: batch.id,
        startsAt: new Date('2024-10-22T00:00:00.000Z'),
      });
      const { bet } = await insertBet(t.db, {
        projectId,
        stageId: historic.id,
        houseId: house.id,
        createdBy: author.id,
        batchId: batch.id,
      });
      const ledger = await movement({ stageId: historic.id, batchId: batch.id });
      expect([historic.batchId, bet.batchId, ledger.batchId]).toEqual([
        batch.id,
        batch.id,
        batch.id,
      ]);
    });

    it('un lote inexistente se rechaza (clave foránea)', async () => {
      const missing = '01a0ddc6-a0f8-7149-8ef2-2f5f1aea5fb4';
      await expect(movement({ batchId: missing })).rejects.toSatisfy(
        (error: unknown) => pgErrorCode(error) === '23503',
      );
      await expect(
        insertBet(t.db, {
          projectId,
          stageId: stage.id,
          houseId: house.id,
          createdBy: author.id,
          batchId: missing,
        }),
      ).rejects.toSatisfy((error: unknown) => pgErrorCode(error) === '23503');
      await expect(
        insertStage(t.db, { projectId, name: 'Ronda 0', status: 'CLOSED', batchId: missing }),
      ).rejects.toSatisfy((error: unknown) => pgErrorCode(error) === '23503');
    });

    it('un lote referenciado no se puede borrar', async () => {
      const batch = await uploadBatch();
      await insertBet(t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: author.id,
        batchId: batch.id,
      });
      await expect(
        t.db.delete(importBatches).where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy((error: unknown) => pgErrorCode(error) === PG_RESTRICT_VIOLATION);
    });
  });

  describe('occurred_at_known', () => {
    it('solo un movimiento de un lote puede tener fecha desconocida', async () => {
      await expect(movement({ occurredAtKnown: false })).rejects.toSatisfy(
        constraint('financial_movements_unknown_date_only_imported'),
      );
      const batch = await uploadBatch();
      const capital = await movement({
        type: 'INITIAL_CAPITAL',
        amount: '1000.00',
        occurredAtKnown: false,
        batchId: batch.id,
        occurredAt: new Date('2024-10-22T00:00:00.000Z'),
      });
      expect(capital).toMatchObject({ occurredAtKnown: false, batchId: batch.id });
    });

    it('un movimiento con fecha desconocida sigue siendo inmutable y cuenta en el saldo', async () => {
      const batch = await uploadBatch();
      const capital = await movement({
        type: 'INITIAL_CAPITAL',
        amount: '1000.00',
        occurredAtKnown: false,
        batchId: batch.id,
      });
      await expect(
        t.db
          .update(financialMovements)
          .set({ occurredAtKnown: true })
          .where(eq(financialMovements.id, capital.id)),
      ).rejects.toSatisfy((error: unknown) => pgErrorCode(error) === PG_RESTRICT_VIOLATION);
      const rows = await t.db.select().from(financialMovements);
      expect(rows.map((r) => r.amount)).toEqual(['1000.00']);
    });
  });

  it('las apuestas ordinarias siguen consultándose sin lote', async () => {
    await insertBet(t.db, {
      projectId,
      stageId: stage.id,
      houseId: house.id,
      createdBy: author.id,
    });
    const rows = await t.db.select().from(bets).where(eq(bets.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batchId).toBeNull();
  });
});
