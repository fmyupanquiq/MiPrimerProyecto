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
import { PG_CHECK_VIOLATION, pgConstraintName, pgErrorCode } from './pg-errors.js';
import {
  betSelections,
  bets,
  importBatches,
  type HouseRow,
  type StageRow,
  type UserRow,
} from './schema/index.js';

const NULL_ODDS_RULE = 'bet_selections_odds_required_outside_batch';
const rejected = (error: unknown) =>
  pgErrorCode(error) === PG_CHECK_VIOLATION && pgConstraintName(error) === NULL_ODDS_RULE;

/**
 * Fase 9.1.2c (§113.5, D-X15, ADR 0020): `bet_selections.visible_odds` admite nulo solo en las
 * apuestas de un lote de importación; la base de datos lo garantiza con disparadores porque un
 * `CHECK` no puede consultar `bets`. La cuota total de la apuesta sigue siendo obligatoria.
 */
describe('cuota nula solo en apuestas de un lote (PostgreSQL real, §113.5)', () => {
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

  const bet = (overrides: { batchId?: string; visibleOdds?: string | null } = {}) => {
    const { visibleOdds, ...rest } = overrides;
    return insertBet(t.db, {
      projectId,
      stageId: stage.id,
      houseId: house.id,
      createdBy: author.id,
      ...rest,
      selections: [{ visibleOdds: visibleOdds === undefined ? '1.95' : visibleOdds }],
    });
  };

  it('una apuesta ordinaria sin cuota en su selección se rechaza', async () => {
    await expect(bet({ visibleOdds: null })).rejects.toSatisfy(rejected);
    // Y no queda ninguna fila a medias: la apuesta se creó antes, pero su selección no.
    const orphan = await t.db.select().from(betSelections);
    expect(orphan).toEqual([]);
  });

  it('una apuesta ordinaria con cuota sigue aceptándose', async () => {
    const { bet: created, selections } = await bet();
    expect(created.batchId).toBeNull();
    expect(selections[0]!.visibleOdds).toBe('1.950000');
  });

  it('una apuesta de un lote acepta la selección con cuota', async () => {
    const batch = await uploadBatch();
    const { selections } = await bet({ batchId: batch.id });
    expect(selections[0]!.visibleOdds).toBe('1.950000');
  });

  it('una apuesta de un lote acepta la selección sin cuota', async () => {
    const batch = await uploadBatch();
    const { bet: created, selections } = await bet({ batchId: batch.id, visibleOdds: null });
    expect(selections[0]!.visibleOdds).toBeNull();
    // La cuota total de la apuesta sigue siendo la autoridad y sigue siendo obligatoria.
    expect(created.visibleTotalOdds).toBe('1.950000');
    await expect(
      t.db
        .update(bets)
        .set({ visibleTotalOdds: null as unknown as string })
        .where(eq(bets.id, created.id)),
    ).rejects.toSatisfy((error: unknown) => pgErrorCode(error) === '23502');
  });

  it('quitar la cuota a una selección de una apuesta ordinaria se rechaza', async () => {
    const { selections } = await bet();
    await expect(
      t.db
        .update(betSelections)
        .set({ visibleOdds: null })
        .where(eq(betSelections.id, selections[0]!.id)),
    ).rejects.toSatisfy(rejected);
    const [row] = await t.db.select().from(betSelections);
    expect(row!.visibleOdds).toBe('1.950000');
  });

  it('quitar la cuota a la selección de una apuesta de un lote se acepta', async () => {
    const batch = await uploadBatch();
    const { selections } = await bet({ batchId: batch.id });
    const [updated] = await t.db
      .update(betSelections)
      .set({ visibleOdds: null })
      .where(eq(betSelections.id, selections[0]!.id))
      .returning();
    expect(updated!.visibleOdds).toBeNull();
  });

  it('mover una selección sin cuota a una apuesta ordinaria se rechaza', async () => {
    const batch = await uploadBatch();
    const { selections } = await bet({ batchId: batch.id, visibleOdds: null });
    const { bet: ordinary } = await bet();
    await expect(
      t.db
        .update(betSelections)
        .set({ betId: ordinary.id })
        .where(eq(betSelections.id, selections[0]!.id)),
    ).rejects.toSatisfy(rejected);
  });

  it('una apuesta con selecciones sin cuota no puede quedar sin lote', async () => {
    const batch = await uploadBatch();
    const { bet: imported } = await bet({ batchId: batch.id, visibleOdds: null });
    await expect(
      t.db.update(bets).set({ batchId: null }).where(eq(bets.id, imported.id)),
    ).rejects.toSatisfy(rejected);

    // Con cuota en todas sus selecciones, sí puede dejar de pertenecer al lote.
    const { bet: withOdds } = await bet({ batchId: batch.id });
    const [freed] = await t.db
      .update(bets)
      .set({ batchId: null })
      .where(eq(bets.id, withOdds.id))
      .returning();
    expect(freed!.batchId).toBeNull();
  });

  it('las cuotas siguen siendo positivas cuando existen', async () => {
    const batch = await uploadBatch();
    await expect(bet({ batchId: batch.id, visibleOdds: '0.000000' })).rejects.toSatisfy(
      (error: unknown) =>
        pgErrorCode(error) === PG_CHECK_VIOLATION &&
        pgConstraintName(error) === 'bet_selections_odds_positive',
    );
  });
});
