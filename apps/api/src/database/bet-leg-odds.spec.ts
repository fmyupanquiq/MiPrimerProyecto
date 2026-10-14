import { and, eq } from 'drizzle-orm';
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
import { betSelections, bets, type HouseRow, type StageRow, type UserRow } from './schema/index.js';

const BEFORE_ROW_RULE = 'bet_selections_odds_required_outside_batch';
const DEFERRED_RULE = 'bet_selections_leg_odds_required';
const rejectedBy = (rule: string) => (error: unknown) =>
  pgErrorCode(error) === PG_CHECK_VIOLATION && pgConstraintName(error) === rule;

/**
 * §114: una Múltiple puede contener un leg creado. La cuota del LEG vive en la fila
 * `position = 0`; las condiciones internas (`position > 0`) pueden ir sin cuota. Las reglas de
 * Simple, Creada independiente y lotes de importación no cambian.
 */
describe('cuota por leg en una Múltiple (PostgreSQL real, §114)', () => {
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

  type Row = { eventGroup: number; position: number; visibleOdds: string | null };
  const make = (betType: 'SIMPLE' | 'CREATED' | 'MULTIPLE', rows: Row[]) =>
    insertBet(t.db, {
      projectId,
      stageId: stage.id,
      houseId: house.id,
      createdBy: author.id,
      betType,
      selections: rows.map((row) => ({
        ...row,
        event: `Partido ${row.eventGroup}`,
        selection: `Selección ${row.eventGroup}.${row.position}`,
      })),
    });

  const LEGS_WITH_BUILDER: Row[] = [
    { eventGroup: 0, position: 0, visibleOdds: '2.15' },
    { eventGroup: 1, position: 0, visibleOdds: '2.47' },
    { eventGroup: 1, position: 1, visibleOdds: null },
    { eventGroup: 2, position: 0, visibleOdds: '1.21' },
  ];

  it('acepta una Múltiple con un leg creado: la cuota del leg una vez, la condición interna sin cuota', async () => {
    const { selections } = await make('MULTIPLE', LEGS_WITH_BUILDER);
    expect(selections.map((s) => s.visibleOdds)).toEqual([
      '2.150000',
      '2.470000',
      null,
      '1.210000',
    ]);
  });

  it('el orden de inserción no importa: la fila interna antes que la principal, en la misma sentencia', async () => {
    const { selections } = await make('MULTIPLE', [
      { eventGroup: 0, position: 0, visibleOdds: '1.50' },
      { eventGroup: 1, position: 1, visibleOdds: null },
      { eventGroup: 1, position: 0, visibleOdds: '2.47' },
    ]);
    expect(selections).toHaveLength(3);
  });

  it('rechaza la fila principal de un leg sin cuota (al instante)', async () => {
    await expect(
      make('MULTIPLE', [
        { eventGroup: 0, position: 0, visibleOdds: '2.15' },
        { eventGroup: 1, position: 0, visibleOdds: null },
        { eventGroup: 1, position: 1, visibleOdds: null },
      ]),
    ).rejects.toSatisfy(rejectedBy(BEFORE_ROW_RULE));
  });

  it('rechaza una condición interna sin cuota cuando su leg no tiene fila principal (al confirmar)', async () => {
    await expect(
      make('MULTIPLE', [
        { eventGroup: 0, position: 0, visibleOdds: '2.15' },
        { eventGroup: 1, position: 1, visibleOdds: null },
      ]),
    ).rejects.toSatisfy(rejectedBy(DEFERRED_RULE));
  });

  it('una Múltiple normal sigue exigiendo cuota en cada leg', async () => {
    await expect(
      make('MULTIPLE', [
        { eventGroup: 0, position: 0, visibleOdds: '2.15' },
        { eventGroup: 1, position: 0, visibleOdds: null },
      ]),
    ).rejects.toSatisfy(rejectedBy(BEFORE_ROW_RULE));
  });

  it('una Simple sigue exigiendo cuota, incluso en una fila interna', async () => {
    await expect(
      make('SIMPLE', [{ eventGroup: 0, position: 0, visibleOdds: null }]),
    ).rejects.toSatisfy(rejectedBy(BEFORE_ROW_RULE));
    await expect(
      make('SIMPLE', [
        { eventGroup: 0, position: 0, visibleOdds: '1.50' },
        { eventGroup: 0, position: 1, visibleOdds: null },
      ]),
    ).rejects.toSatisfy(rejectedBy(BEFORE_ROW_RULE));
  });

  it('una Creada independiente sigue aceptando selecciones sin cuota', async () => {
    const { selections } = await make('CREATED', [
      { eventGroup: 0, position: 0, visibleOdds: null },
      { eventGroup: 0, position: 1, visibleOdds: null },
    ]);
    expect(selections.every((s) => s.visibleOdds === null)).toBe(true);
  });

  it('reemplazar las selecciones en una transacción (borrar y reinsertar) es válido', async () => {
    const { bet } = await make('MULTIPLE', LEGS_WITH_BUILDER);
    await t.db.transaction(async (tx) => {
      await tx.delete(betSelections).where(eq(betSelections.betId, bet.id));
      await tx.insert(betSelections).values([
        {
          betId: bet.id,
          eventGroup: 0,
          position: 0,
          event: 'E',
          selection: 'A',
          visibleOdds: '1.30',
        },
        {
          betId: bet.id,
          eventGroup: 1,
          position: 0,
          event: 'F',
          selection: 'B',
          visibleOdds: '2.00',
        },
        {
          betId: bet.id,
          eventGroup: 1,
          position: 1,
          event: 'F',
          selection: 'C',
          visibleOdds: null,
        },
      ]);
    });
    const rows = await t.db.select().from(betSelections).where(eq(betSelections.betId, bet.id));
    expect(rows).toHaveLength(3);
  });

  it('borrar la fila principal de un leg que conserva una condición sin cuota se rechaza', async () => {
    const { bet, selections } = await make('MULTIPLE', LEGS_WITH_BUILDER);
    const main = selections.find((s) => s.eventGroup === 1 && s.position === 0)!;
    await expect(t.db.delete(betSelections).where(eq(betSelections.id, main.id))).rejects.toSatisfy(
      rejectedBy(DEFERRED_RULE),
    );
    const rows = await t.db.select().from(betSelections).where(eq(betSelections.betId, bet.id));
    expect(rows).toHaveLength(4);
  });

  it('cambiar a Múltiple una Creada con selecciones sin cuota se rechaza al confirmar', async () => {
    const { bet } = await make('CREATED', [
      { eventGroup: 0, position: 0, visibleOdds: null },
      { eventGroup: 0, position: 1, visibleOdds: null },
    ]);
    await expect(
      t.db.update(bets).set({ betType: 'MULTIPLE' }).where(eq(bets.id, bet.id)),
    ).rejects.toSatisfy(rejectedBy(DEFERRED_RULE));
  });

  it('marcador y resultado del leg solo en la fila principal; el estado de la condición, en cualquiera', async () => {
    const { bet } = await make('MULTIPLE', LEGS_WITH_BUILDER);
    const mains = await t.db
      .update(betSelections)
      .set({ legScore: '0-3', legResult: 'LOST' })
      .where(and(eq(betSelections.betId, bet.id), eq(betSelections.position, 0)))
      .returning();
    expect(mains).toHaveLength(3);
    const inner = (
      await t.db.select().from(betSelections).where(eq(betSelections.betId, bet.id))
    ).find((s) => s.position === 1)!;
    await expect(
      t.db.update(betSelections).set({ legScore: '1-1' }).where(eq(betSelections.id, inner.id)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        pgErrorCode(error) === PG_CHECK_VIOLATION &&
        pgConstraintName(error) === 'bet_selections_leg_data_on_first_row',
    );
    const [ok] = await t.db
      .update(betSelections)
      .set({ conditionStatus: 'WON' })
      .where(eq(betSelections.id, inner.id))
      .returning();
    expect(ok!.conditionStatus).toBe('WON');
  });
});
