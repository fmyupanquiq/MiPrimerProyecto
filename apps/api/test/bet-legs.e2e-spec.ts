import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { betSelections, financialMovements, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

interface SelectionBody {
  eventGroup: number;
  position: number;
  event: string;
  market: string | null;
  selection: string;
  visibleOdds: string | null;
  legScore: string | null;
  legResult: string | null;
  conditionStatus: string | null;
}
interface BetBody {
  id: string;
  betType: string;
  stake: string;
  effectiveAmount: string;
  amountSource: string;
  visibleTotalOdds: string;
  officialRealizedReturn: string | null;
  profitLoss: string | null;
  status: string;
  version: number;
  externalReference: string | null;
  selections: SelectionBody[];
  code?: string;
  message?: string;
}

/**
 * Caso real (§114): Combinada de 4 de Betano perdida, cuyo 2.º leg es un Bet Builder con dos
 * condiciones internas y UNA sola cuota (2.47). 4 legs, 5 condiciones/selecciones en total.
 */
const row = (
  eventGroup: number,
  position: number,
  event: string,
  market: string,
  selection: string,
  extra: Record<string, unknown> = {},
) => ({ eventGroup, position, event, market, selection, ...extra });

const BETANO_SELECTIONS = [
  row(0, 0, 'Universitario de Deportes - FBC Melgar', 'Doble oportunidad', '1X', {
    visibleOdds: '2.15',
    legScore: '2-2',
  }),
  row(1, 0, 'Liverpool FC - Manchester City', 'Resultado del partido', 'Manchester City', {
    visibleOdds: '2.47',
    legScore: '0-3',
    legResult: 'LOST',
  }),
  row(1, 1, 'Liverpool FC - Manchester City', 'Manchester City Más/Menos Córners', 'Más de 2.5', {
    conditionStatus: 'WON',
  }),
  row(2, 0, 'SL Benfica - Vitória Guimarães', 'Resultado del partido', 'SL Benfica', {
    visibleOdds: '1.21',
    legScore: '2-0',
  }),
  row(3, 0, 'Inter Miami CF - D.C. United', 'Goles totales Más/Menos', 'Más de 4.5', {
    visibleOdds: '1.31',
    legScore: '4-0',
  }),
];

describe('Múltiple que contiene un leg creado (e2e, PostgreSQL real, §114)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  let owner: UserRow;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-10-10T12:00:00.000Z');
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Grupo' })).project.id;
    cookie = sessionCookie(await login(ctx.server, owner.email).expect(200))!;
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookie)
      .send({ unitStake: '2.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    const houses = (
      await request(ctx.server).get(`/api/projects/${projectId}/houses`).set('Cookie', cookie)
    ).body as { id: string }[];
    houseId = houses[0]!.id;
  });

  const post = (body: object) =>
    request(ctx.server).post(`/api/projects/${projectId}/bets`).set('Cookie', cookie).send(body);
  const patch = (id: string, body: object) =>
    request(ctx.server)
      .patch(`/api/projects/${projectId}/bets/${id}`)
      .set('Cookie', cookie)
      .send(body);
  const detail = (id: string) =>
    request(ctx.server).get(`/api/projects/${projectId}/bets/${id}`).set('Cookie', cookie);

  const betano = (overrides: Record<string, unknown> = {}) => ({
    houseId,
    stake: '5',
    // El producto de las cuotas visibles (≈ 8.42) es solo una referencia: lo registrado es lo que
    // la persona confirma. Aquí el ticket no muestra cuota total; se usa la de referencia.
    visibleTotalOdds: '8.42',
    officialAmount: '10.00',
    placedAt: '2026-10-10T20:05:00.000Z',
    externalReference: 'BT-0001',
    selections: BETANO_SELECTIONS,
    ...overrides,
  });

  it('registra los 4 legs y las 5 condiciones, con la cuota 2.47 UNA sola vez', async () => {
    const created = (await post(betano()).expect(201)).body as BetBody;
    expect(created).toMatchObject({
      betType: 'MULTIPLE',
      stake: '5.0000',
      effectiveAmount: '10.00',
      amountSource: 'CONFIRMED',
      externalReference: 'BT-0001',
    });
    expect(created.selections).toHaveLength(5);
    expect(new Set(created.selections.map((s) => s.eventGroup)).size).toBe(4);
    expect(created.selections.map((s) => s.visibleOdds)).toEqual([
      '2.150000',
      '2.470000',
      null,
      '1.210000',
      '1.310000',
    ]);

    // La base de datos guarda exactamente eso: ninguna cuota duplicada ni inventada (p. ej. 1.52).
    const stored = await ctx.t.db.select().from(betSelections);
    expect(stored.filter((s) => s.visibleOdds === '2.470000')).toHaveLength(1);
    expect(stored.some((s) => s.visibleOdds === '1.520000')).toBe(false);

    // Y el detalle ("Ver apuesta") devuelve la misma estructura, con el marcador y estados visibles.
    const fetched = (await detail(created.id).expect(200)).body as BetBody;
    const builder = fetched.selections.filter((s) => s.eventGroup === 1);
    expect(builder.map((s) => [s.position, s.selection, s.visibleOdds])).toEqual([
      [0, 'Manchester City', '2.470000'],
      [1, 'Más de 2.5', null],
    ]);
    expect(builder[0]).toMatchObject({ legScore: '0-3', legResult: 'LOST' });
    expect(builder[1]).toMatchObject({ conditionStatus: 'WON', legScore: null });
  });

  it('liquidarla es UNA sola operación financiera: los estados internos no mueven el ledger', async () => {
    const created = (await post(betano()).expect(201)).body as BetBody;
    await request(ctx.server)
      .post(`/api/projects/${projectId}/bets/${created.id}/settle`)
      .set('Cookie', cookie)
      .send({ status: 'LOST', settledAt: '2026-10-10T22:00:00.000Z', version: created.version })
      .expect(200);

    const movements = await ctx.t.db.select().from(financialMovements);
    const forBet = movements.filter(
      (m) => m.type === 'BET_PLACEMENT' || m.type === 'BET_SETTLEMENT',
    );
    expect(forBet.map((m) => [m.type, m.amount])).toEqual([['BET_PLACEMENT', '10.00']]);

    const list = (
      await request(ctx.server).get(`/api/projects/${projectId}/houses`).set('Cookie', cookie)
    ).body as { balance: string }[];
    expect(list[0]!.balance).toBe('490.00'); // 500 − 10 (perdida)
    const settled = (await detail(created.id).expect(200)).body as BetBody;
    expect(settled).toMatchObject({ status: 'LOST', profitLoss: '-10.00' });
    await assertFinancialInvariant(ctx, { projectId, cookie });
  });

  it('el importe oficial manda: S/ 10.00 con unidad S/ 2.00 es stake 5, no un importe de S/ 20.00', async () => {
    const created = (await post(betano()).expect(201)).body as BetBody;
    expect(created.effectiveAmount).toBe('10.00');
    expect(created.stake).toBe('5.0000');
  });

  it('registrada ya Perdida: se recupera de PostgreSQL con la estructura exacta y un solo movimiento', async () => {
    const created = (
      await post(
        betano({ settlement: { status: 'LOST', settledAt: '2026-10-10T22:00:00.000Z' } }),
      ).expect(201)
    ).body as BetBody;
    expect(created).toMatchObject({
      status: 'LOST',
      stake: '5.0000',
      effectiveAmount: '10.00',
      profitLoss: '-10.00',
    });

    // Se lee de nuevo desde la base de datos (no del cuerpo de la creación).
    const fetched = (await detail(created.id).expect(200)).body as BetBody;
    expect(
      fetched.selections.map((s) => [
        s.eventGroup,
        s.position,
        s.event,
        s.market,
        s.selection,
        s.visibleOdds,
        s.legScore,
        s.legResult,
        s.conditionStatus,
      ]),
    ).toEqual([
      [
        0,
        0,
        'Universitario de Deportes - FBC Melgar',
        'Doble oportunidad',
        '1X',
        '2.150000',
        '2-2',
        null,
        null,
      ],
      [
        1,
        0,
        'Liverpool FC - Manchester City',
        'Resultado del partido',
        'Manchester City',
        '2.470000',
        '0-3',
        'LOST',
        null,
      ],
      [
        1,
        1,
        'Liverpool FC - Manchester City',
        'Manchester City Más/Menos Córners',
        'Más de 2.5',
        null,
        null,
        null,
        'WON',
      ],
      [
        2,
        0,
        'SL Benfica - Vitória Guimarães',
        'Resultado del partido',
        'SL Benfica',
        '1.210000',
        '2-0',
        null,
        null,
      ],
      [
        3,
        0,
        'Inter Miami CF - D.C. United',
        'Goles totales Más/Menos',
        'Más de 4.5',
        '1.310000',
        '4-0',
        null,
        null,
      ],
    ]);
    expect(JSON.stringify(fetched)).not.toContain('1.52');

    // Una sola apuesta ⇒ un solo movimiento de colocación por S/ 10.00; perder no genera otro.
    const bets = (await ctx.t.db.select().from(financialMovements)).filter((m) =>
      ['BET_PLACEMENT', 'BET_SETTLEMENT', 'REVERSAL'].includes(m.type),
    );
    expect(bets.map((m) => [m.type, m.amount])).toEqual([['BET_PLACEMENT', '10.00']]);
    await assertFinancialInvariant(ctx, { projectId, cookie });
  });

  it.each([
    [
      'un leg de una Múltiple sin cuota en su fila principal',
      [
        row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '2.00' }),
        row(1, 0, 'C - D', 'M', 'Y'),
        row(1, 1, 'C - D', 'M2', 'Z'),
      ],
    ],
    [
      'una condición interna sin fila principal en su leg',
      [row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '2.00' }), row(1, 1, 'C - D', 'M', 'Y')],
    ],
    [
      'posiciones repetidas dentro de un leg',
      [
        row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '2.00' }),
        row(1, 0, 'C - D', 'M', 'Y', { visibleOdds: '2.00' }),
        row(1, 0, 'C - D', 'M2', 'Z'),
      ],
    ],
    [
      'condiciones de un leg de partidos distintos',
      [
        row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '2.00' }),
        row(1, 0, 'C - D', 'M', 'Y', { visibleOdds: '2.00' }),
        row(1, 1, 'E - F', 'M2', 'Z'),
      ],
    ],
    [
      'marcador del leg en una condición interna',
      [
        row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '2.00' }),
        row(1, 0, 'C - D', 'M', 'Y', { visibleOdds: '2.00' }),
        row(1, 1, 'C - D', 'M2', 'Z', { legScore: '1-0' }),
      ],
    ],
    [
      'una Múltiple normal con una selección sin cuota',
      [row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '2.00' }), row(1, 0, 'C - D', 'M', 'Y')],
    ],
  ])('rechaza con 400 (sin escribir nada): %s', async (_name, selections) => {
    const response = await post(betano({ selections })).expect(400);
    expect((response.body as BetBody).code).toBe('VALIDATION_FAILED');
    expect(await ctx.t.db.select().from(betSelections)).toEqual([]);
    expect(
      await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.type, 'BET_PLACEMENT')),
    ).toEqual([]);
  });

  it('editar una pendiente reemplaza la estructura entera y puede volver a leg normal', async () => {
    const created = (await post(betano()).expect(201)).body as BetBody;
    const edited = (
      await patch(created.id, {
        version: created.version,
        selections: [
          row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '1.50' }),
          row(1, 0, 'C - D', 'M', 'Y', { visibleOdds: '2.00' }),
        ],
      }).expect(200)
    ).body as BetBody;
    expect(edited.selections).toHaveLength(2);
    expect(edited.betType).toBe('MULTIPLE');
    expect(edited.selections.map((s) => s.visibleOdds)).toEqual(['1.500000', '2.000000']);
    await assertFinancialInvariant(ctx, { projectId, cookie });
  });

  it('la Simple, la Creada independiente y la Múltiple normal siguen funcionando igual', async () => {
    const simple = (
      await post({
        houseId,
        stake: '1',
        visibleTotalOdds: '1.95',
        placedAt: '2026-10-10T20:00:00.000Z',
        selections: [row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '1.95' })],
      }).expect(201)
    ).body as BetBody;
    expect(simple.betType).toBe('SIMPLE');

    const created = (
      await post({
        houseId,
        stake: '1',
        visibleTotalOdds: '3.42',
        placedAt: '2026-10-10T20:00:00.000Z',
        selections: [row(0, 0, 'A - B', 'M', 'X'), row(0, 1, 'A - B', 'M2', 'Y')],
      }).expect(201)
    ).body as BetBody;
    expect(created.betType).toBe('CREATED');
    expect(created.selections.every((s) => s.visibleOdds === null)).toBe(true);

    const multiple = (
      await post({
        houseId,
        stake: '1',
        visibleTotalOdds: '3.00',
        placedAt: '2026-10-10T20:00:00.000Z',
        selections: [
          row(0, 0, 'A - B', 'M', 'X', { visibleOdds: '1.50' }),
          row(1, 0, 'C - D', 'M', 'Y', { visibleOdds: '2.00' }),
        ],
      }).expect(201)
    ).body as BetBody;
    expect(multiple.betType).toBe('MULTIPLE');
    await assertFinancialInvariant(ctx, { projectId, cookie });
  });
});
