import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bets, financialMovements, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

/*
 * Procedencia de la cuota total (ADR 0023): `visibleTotalOdds` es UN solo valor y `totalOddsSource`
 * dice si es oficial, una referencia calculada o de origen desconocido. Cambiar la procedencia es un
 * cambio documental: nunca toca importes, retornos, ganancias ni el ledger.
 */

interface BetBody {
  id: string;
  betType: string;
  status: string;
  visibleTotalOdds: string;
  totalOddsSource: string;
  effectiveAmount: string;
  officialPotentialReturn: string | null;
  profitLoss: string | null;
  version: number;
  selections: { visibleOdds: string | null }[];
  code?: string;
}

const row = (
  eventGroup: number,
  position: number,
  event: string,
  selection: string,
  extra: Record<string, unknown> = {},
) => ({ eventGroup, position, event, market: 'Mercado', selection, ...extra });

// Combinada de 4 con un leg creado (2.47 una vez): producto 2.15 × 2.47 × 1.21 × 1.31 = 8.41767355…
const BETANO = [
  row(0, 0, 'A - B', '1X', { visibleOdds: '2.15' }),
  row(1, 0, 'C - D', 'Manchester City', { visibleOdds: '2.47' }),
  row(1, 1, 'C - D', 'Más de 2.5'),
  row(2, 0, 'E - F', 'SL Benfica', { visibleOdds: '1.21' }),
  row(3, 0, 'G - H', 'Más de 4.5', { visibleOdds: '1.31' }),
];

describe('procedencia de la cuota total (e2e, PostgreSQL real, ADR 0023)', () => {
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
    houseId = (
      (await request(ctx.server).get(`/api/projects/${projectId}/houses`).set('Cookie', cookie))
        .body as { id: string }[]
    )[0]!.id;
  });

  const post = (body: object) =>
    request(ctx.server).post(`/api/projects/${projectId}/bets`).set('Cookie', cookie).send(body);
  const patch = (id: string, body: object) =>
    request(ctx.server)
      .patch(`/api/projects/${projectId}/bets/${id}`)
      .set('Cookie', cookie)
      .send(body);
  const detail = async (id: string) =>
    (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/bets/${id}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body as BetBody;
  const ledger = async () =>
    (await ctx.t.db.select().from(financialMovements)).map((m) => [m.type, m.amount, m.houseId]);

  const body = (overrides: Record<string, unknown> = {}) => ({
    houseId,
    stake: '5',
    officialAmount: '10.00',
    visibleTotalOdds: '8.42',
    placedAt: '2026-10-10T20:05:00.000Z',
    selections: BETANO,
    ...overrides,
  });

  it('ticket con cuota total oficial distinta del producto: se guarda tal cual y como OFFICIAL', async () => {
    const created = (
      await post(body({ visibleTotalOdds: '8.40', totalOddsSource: 'OFFICIAL' })).expect(201)
    ).body as BetBody;
    expect(created).toMatchObject({ totalOddsSource: 'OFFICIAL', visibleTotalOdds: '8.400000' });
    // Ningún valor calculado la sobrescribe: ni se redondea al producto ni se sustituye.
    expect((await detail(created.id)).visibleTotalOdds).toBe('8.400000');
  });

  it('sin cuota oficial pero con las cuotas de todos los legs: la referencia queda como CALCULATED', async () => {
    const created = (
      await post(body({ visibleTotalOdds: '8.42', totalOddsSource: 'CALCULATED' })).expect(201)
    ).body as BetBody;
    expect(created).toMatchObject({ totalOddsSource: 'CALCULATED', visibleTotalOdds: '8.420000' });
    // 4 legs, 5 filas, cuota del leg creado una vez y sin cuotas internas inventadas.
    expect(created.selections.map((s) => s.visibleOdds)).toEqual([
      '2.150000',
      '2.470000',
      null,
      '1.210000',
      '1.310000',
    ]);
  });

  it('con cuotas parciales (a un leg le falta la suya) se rechaza: nunca se calcula un producto incompleto', async () => {
    const partial = [
      row(0, 0, 'A - B', '1X', { visibleOdds: '2.15' }),
      row(1, 0, 'C - D', 'Manchester City'),
    ];
    const response = await post(
      body({ selections: partial, totalOddsSource: 'CALCULATED' }),
    ).expect(400);
    expect((response.body as BetBody).code).toBe('VALIDATION_FAILED');
    expect(await ctx.t.db.select().from(bets)).toEqual([]);
    expect((await ledger()).filter(([type]) => type === 'BET_PLACEMENT')).toEqual([]);
  });

  it('si no se indica la procedencia queda UNKNOWN (nunca se asume oficial)', async () => {
    const created = (await post(body()).expect(201)).body as BetBody;
    expect(created.totalOddsSource).toBe('UNKNOWN');
  });

  it('una procedencia inválida se rechaza con 400', async () => {
    await post(body({ totalOddsSource: 'AUTOMATICA' })).expect(400);
  });

  it('el ledger es el mismo sea cual sea la procedencia: un solo movimiento por S/ 10.00', async () => {
    for (const source of ['OFFICIAL', 'CALCULATED', 'UNKNOWN']) {
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
      houseId = (
        (await request(ctx.server).get(`/api/projects/${projectId}/houses`).set('Cookie', cookie))
          .body as { id: string }[]
      )[0]!.id;
      // Registrada ya Perdida: es cuando la apuesta pasa al ledger (una pendiente solo reserva).
      const created = (
        await post(
          body({
            totalOddsSource: source,
            settlement: { status: 'LOST', settledAt: '2026-10-10T22:00:00.000Z' },
          }),
        ).expect(201)
      ).body as BetBody;
      const placements = (await ledger()).filter(([type]) => type === 'BET_PLACEMENT');
      expect(placements.map(([, amount]) => amount)).toEqual(['10.00']);
      expect(created.effectiveAmount).toBe('10.00');
      await assertFinancialInvariant(ctx, { projectId, cookie });
    }
  });

  describe('editar y liquidar', () => {
    it('cambiar solo la procedencia es documental: el ledger, el monto y la ganancia no cambian', async () => {
      const created = (await post(body({ totalOddsSource: 'CALCULATED' })).expect(201))
        .body as BetBody;
      const before = await ledger();
      const edited = (
        await patch(created.id, { version: created.version, totalOddsSource: 'OFFICIAL' }).expect(
          200,
        )
      ).body as BetBody;
      expect(edited).toMatchObject({
        totalOddsSource: 'OFFICIAL',
        visibleTotalOdds: '8.420000',
        effectiveAmount: '10.00',
      });
      expect(await ledger()).toEqual(before);
      await assertFinancialInvariant(ctx, { projectId, cookie });
    });

    it('cambiar el valor sin decir su procedencia la deja UNKNOWN; el mismo valor la conserva', async () => {
      const created = (await post(body({ totalOddsSource: 'OFFICIAL' })).expect(201))
        .body as BetBody;
      const same = (
        await patch(created.id, { version: created.version, visibleTotalOdds: '8.42' }).expect(200)
      ).body as BetBody;
      expect(same.totalOddsSource).toBe('OFFICIAL');
      const changed = (
        await patch(created.id, { version: same.version, visibleTotalOdds: '8.50' }).expect(200)
      ).body as BetBody;
      expect(changed).toMatchObject({ totalOddsSource: 'UNKNOWN', visibleTotalOdds: '8.500000' });
    });

    it('liquidar (perdida) no altera la procedencia ni el valor de la cuota', async () => {
      const created = (await post(body({ totalOddsSource: 'CALCULATED' })).expect(201))
        .body as BetBody;
      await request(ctx.server)
        .post(`/api/projects/${projectId}/bets/${created.id}/settle`)
        .set('Cookie', cookie)
        .send({ status: 'LOST', settledAt: '2026-10-10T22:00:00.000Z', version: created.version })
        .expect(200);
      const settled = await detail(created.id);
      expect(settled).toMatchObject({
        status: 'LOST',
        totalOddsSource: 'CALCULATED',
        visibleTotalOdds: '8.420000',
        profitLoss: '-10.00',
      });
      await assertFinancialInvariant(ctx, { projectId, cookie });
    });

    it('en una liquidada la procedencia no se edita por la vía ordinaria (se corrige con la liquidación)', async () => {
      const created = (await post(body({ totalOddsSource: 'CALCULATED' })).expect(201))
        .body as BetBody;
      const settled = (
        await request(ctx.server)
          .post(`/api/projects/${projectId}/bets/${created.id}/settle`)
          .set('Cookie', cookie)
          .send({ status: 'LOST', settledAt: '2026-10-10T22:00:00.000Z', version: created.version })
          .expect(200)
      ).body as BetBody;
      await patch(created.id, { version: settled.version, totalOddsSource: 'OFFICIAL' }).expect(
        409,
      );
      expect((await detail(created.id)).totalOddsSource).toBe('CALCULATED');
    });
  });
});
