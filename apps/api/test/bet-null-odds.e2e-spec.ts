import type { BetDetail } from '@letfer/shared';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { betSelections, bets, importBatches, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

interface AnalysisBody {
  profitLoss: string;
  totalStaked: string;
  capitalInvested: string;
}

const selection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};

/**
 * Fase 9.1.2c (§113.5, D-X15): la cuota nula de una selección importada no cambia nada del cálculo
 * financiero ni del dashboard (el retorno y el ledger salen de la cuota total de la apuesta), y la
 * aplicación sigue exigiendo cuota en toda apuesta que se registra o edita normalmente.
 */
describe('cuota nula en apuestas importadas (e2e, PostgreSQL real, §113.5)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let cookie: string;
  let projectId: string;
  let houseId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Grupo' })).project.id;
    cookie = sessionCookie(await login(ctx.server, owner.email).expect(200))!;
    await request(ctx.server)
      .post(api('/setup'))
      .set('Cookie', cookie)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = (await get<{ id: string }[]>('/houses'))[0]!.id;
  });

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const get = <T>(path: string) =>
    request(ctx.server)
      .get(api(path))
      .set('Cookie', cookie)
      .expect(200)
      .then((response) => response.body as T);
  const post = (path: string, body: object) =>
    request(ctx.server).post(api(path)).set('Cookie', cookie).send(body);
  const invariant = () => assertFinancialInvariant(ctx, { projectId, cookie });

  const createBet = (overrides: Record<string, unknown> = {}) =>
    post('/bets', {
      houseId,
      stake: '2.00',
      visibleTotalOdds: '1.95',
      placedAt: '2026-06-01T13:00:00.000Z',
      selections: [selection],
      ...overrides,
    });

  async function settledBet(): Promise<BetDetail> {
    const bet = (await createBet().expect(201)).body as BetDetail;
    return (
      await post(`/bets/${bet.id}/settle`, {
        status: 'WON',
        settledAt: '2026-06-01T14:00:00.000Z',
        version: bet.version,
      }).expect(200)
    ).body as BetDetail;
  }

  async function markAsImported(betId: string): Promise<void> {
    const bytes = Buffer.from('archivo');
    const [batch] = await ctx.t.db
      .insert(importBatches)
      .values({
        projectId,
        origin: 'Betsafe',
        originalName: 'Betano.xlsx',
        sourceFile: bytes,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceSizeBytes: bytes.length,
        createdBy: owner.id,
      })
      .returning();
    await ctx.t.db.update(bets).set({ batchId: batch!.id }).where(eq(bets.id, betId));
    await ctx.t.db
      .update(betSelections)
      .set({ visibleOdds: null })
      .where(eq(betSelections.betId, betId));
  }

  describe('la aplicación sigue exigiendo cuota', () => {
    it('registrar una apuesta sin cuota (total o de una selección) se rechaza', async () => {
      const withoutOdds = { ...selection, visibleOdds: undefined };
      await createBet({ selections: [withoutOdds] }).expect(400);
      await createBet({ selections: [{ ...selection, visibleOdds: null }] }).expect(400);
      await createBet({ visibleTotalOdds: undefined }).expect(400);
      await createBet({ visibleTotalOdds: null }).expect(400);
      expect(await ctx.t.db.select().from(bets)).toEqual([]);
    });

    it('editar una apuesta ordinaria para quitarle la cuota se rechaza', async () => {
      const bet = (await createBet().expect(201)).body as BetDetail;
      const withoutOdds = { ...selection, visibleOdds: undefined };
      for (const selections of [[withoutOdds], [{ ...selection, visibleOdds: null }]]) {
        await request(ctx.server)
          .patch(api(`/bets/${bet.id}`))
          .set('Cookie', cookie)
          .send({ version: bet.version, selections })
          .expect(400);
      }
      const after = await get<BetDetail>(`/bets/${bet.id}`);
      expect(after.selections[0]!.visibleOdds).toBe('1.950000');
      expect(after.version).toBe(bet.version);
      await invariant();
    });
  });

  describe('una apuesta importada sin cuota en su selección', () => {
    it('se lee con visibleOdds nulo y conserva su cuota total', async () => {
      const settled = await settledBet();
      await markAsImported(settled.id);
      const detail = await get<BetDetail>(`/bets/${settled.id}`);
      expect(detail.selections.map((s) => s.visibleOdds)).toEqual([null]);
      expect(detail.visibleTotalOdds).toBe('1.950000');
      expect(detail.status).toBe('WON');
    });

    it('no cambia el dashboard, el ledger ni la integridad financiera', async () => {
      const settled = await settledBet();
      const analysisBefore = await get<AnalysisBody>('/dashboard/analysis');
      const performanceBefore = await get<unknown>('/dashboard/performance-chart');
      const statusBefore = await get<unknown>('/dashboard/status');
      expect(analysisBefore).toMatchObject({ profitLoss: '19.00', totalStaked: '20.00' });
      const { ledgerTotal } = await invariant();

      await markAsImported(settled.id);

      expect(await get<AnalysisBody>('/dashboard/analysis')).toEqual(analysisBefore);
      expect(await get<unknown>('/dashboard/performance-chart')).toEqual(performanceBefore);
      expect(await get<unknown>('/dashboard/status')).toEqual(statusBefore);
      expect((await invariant()).ledgerTotal).toBe(ledgerTotal);
    });

    it('el listado de apuestas sigue funcionando', async () => {
      const settled = await settledBet();
      await markAsImported(settled.id);
      const list = await get<{ id: string }[]>('/bets');
      expect(list.map((item) => item.id)).toEqual([settled.id]);
    });
  });

  /**
   * Fase 10.6 (decisión del usuario, 2026-10-06): una casa puede mostrar una Creada con varias
   * selecciones y solo la cuota total; la cuota individual no se inventa ni se distribuye.
   */
  describe('una apuesta Creada manual sin cuotas individuales (Fase 10.6)', () => {
    const createdNoOdds = [
      {
        eventGroup: 0,
        position: 0,
        event: 'Real Madrid vs. Barcelona',
        selection: 'Más de 2.5 goles',
      },
      { eventGroup: 0, position: 1, event: 'Real Madrid vs. Barcelona', selection: 'Ambos marcan' },
    ];

    it('se registra con solo la cuota total; las cuotas individuales quedan null, sin inventarse', async () => {
      const created = (
        await createBet({ visibleTotalOdds: '3.42', selections: createdNoOdds }).expect(201)
      ).body as BetDetail;
      expect(created.betType).toBe('CREATED');
      expect(created.visibleTotalOdds).toBe('3.420000');
      expect(created.selections.map((s) => s.visibleOdds)).toEqual([null, null]);
      await invariant();
    });

    it('una Simple o una Múltiple (eventos distintos) siguen exigiendo la cuota de cada selección', async () => {
      await createBet({ selections: [{ ...selection, visibleOdds: undefined }] }).expect(400);
      const multiple = [
        {
          eventGroup: 0,
          position: 0,
          event: 'Real Madrid vs. Barcelona',
          selection: 'Real Madrid gana',
        },
        {
          eventGroup: 1,
          position: 0,
          event: 'Arsenal vs Chelsea',
          selection: 'Arsenal gana',
          visibleOdds: '1.80',
        },
      ];
      await createBet({ visibleTotalOdds: '3.42', selections: multiple }).expect(400);
      expect(await ctx.t.db.select().from(bets)).toEqual([]);
    });

    it('el importe, el retorno calculado y el ledger salen de la cuota total, nunca de las ausentes', async () => {
      const created = (
        await createBet({ stake: '6', visibleTotalOdds: '3.42', selections: createdNoOdds }).expect(
          201,
        )
      ).body as BetDetail;
      await post(`/bets/${created.id}/settle`, {
        status: 'WON',
        settledAt: '2026-06-01T14:00:00.000Z',
        version: created.version,
      }).expect(200);
      const detail = await get<BetDetail>(`/bets/${created.id}`);
      expect(detail.effectiveAmount).toBe('60.00'); // 6 × unidad 10
      expect(detail.calculatedRealizedReturn).toBe('205.20'); // 60 × 3.42
      await invariant();
    });

    it('editar una Creada manteniendo su estructura puede seguir sin cuotas individuales', async () => {
      const created = (
        await createBet({ visibleTotalOdds: '3.42', selections: createdNoOdds }).expect(201)
      ).body as BetDetail;
      await request(ctx.server)
        .patch(api(`/bets/${created.id}`))
        .set('Cookie', cookie)
        .send({ version: created.version, selections: createdNoOdds, visibleTotalOdds: '3.50' })
        .expect(200);
      const after = await get<BetDetail>(`/bets/${created.id}`);
      expect(after.selections.map((s) => s.visibleOdds)).toEqual([null, null]);
      expect(after.visibleTotalOdds).toBe('3.500000');
      await invariant();
    });
  });
});
