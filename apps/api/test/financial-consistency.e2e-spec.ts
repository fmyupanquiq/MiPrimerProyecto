import type { BetDetail } from '@letfer/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  betCorrections,
  bets,
  financialMovements,
  stages,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

type Actor = 'owner' | 'admin' | 'collab' | 'reader';

interface AnalysisBody {
  profitLoss: string;
  yield: string | null;
  roi: string | null;
  totalStaked: string;
  unconfirmedReturns: { count: number; profitLoss: string };
  byHouse: { key: string; profitLoss: string; totalStaked: string; count: number }[];
  byStage: { key: string; profitLoss: string; totalStaked: string }[];
}
interface StatusBody {
  retornosPorConfirmar: number;
  capitalActual: string;
}
interface PerformanceBody {
  points: { cumulativeProfitLoss: string; drawdown: string }[];
}
interface IntegrityBody {
  status: string;
  findings: { check: string; affected: string[] }[];
}

const selection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};
const SETTLED = '2026-06-01T14:00:00.000Z';
const REASON = 'Corrección de prueba';

/**
 * Fase 8.5.4 (§112.6, §112.7, D-A6, D-A13): el dashboard calcula el monto apostado, la ganancia, el
 * Yield y el ROI desde el LEDGER, avisa de los retornos no confirmados y normaliza las cifras; la
 * verificación de integridad detecta cualquier divergencia entre el ledger y lo que dicen las
 * apuestas, y no produce falsos hallazgos tras las operaciones legítimas.
 */
describe('consistencia financiera: dashboard e integridad (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  let stageId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = ((await get('owner', '/houses').expect(200)).body as { id: string }[])[0]!.id;
    stageId = ((await get('owner', '/stages').expect(200)).body as { id: string }[])[0]!.id;
  });

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const get = (actor: Actor, path: string) =>
    request(ctx.server).get(api(path)).set('Cookie', cookies[actor]);
  const post = (actor: Actor, path: string, body: object = {}) =>
    request(ctx.server).post(api(path)).set('Cookie', cookies[actor]).send(body);
  const invariant = () => assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner });
  const analysis = async (query = '') =>
    (await get('owner', `/dashboard/analysis${query}`).expect(200)).body as AnalysisBody;
  const status = async () =>
    (await get('owner', '/dashboard/status').expect(200)).body as StatusBody;
  const integrity = async () =>
    (await post('owner', '/integrity-checks').expect(201)).body as IntegrityBody;
  const checks = (body: IntegrityBody) => body.findings.map((finding) => finding.check).sort();

  const newBet = async (overrides: Record<string, unknown> = {}) =>
    (
      await post('collab', '/bets', {
        houseId,
        stake: '2.00', // S/ 20.00
        visibleTotalOdds: '1.95', // retorno calculado S/ 39.00
        placedAt: '2026-06-01T13:00:00.000Z',
        selections: [selection],
        ...overrides,
      }).expect(201)
    ).body as BetDetail;
  const settleWon = async (
    official: string | null,
    overrides: Record<string, unknown> = {},
  ): Promise<BetDetail> => {
    const bet = await newBet(overrides);
    return (
      await post('admin', `/bets/${bet.id}/settle`, {
        status: 'WON',
        ...(official ? { officialRealizedReturn: official } : {}),
        settledAt: SETTLED,
        version: bet.version,
      }).expect(200)
    ).body as BetDetail;
  };
  const detail = async (betId: string) =>
    (await get('owner', `/bets/${betId}`).expect(200)).body as BetDetail;
  const correct = (bet: BetDetail, body: object) =>
    post('admin', `/bets/${bet.id}/correct-settlement`, {
      version: bet.version,
      reason: REASON,
      ...body,
    });

  // --- El dashboard sale del ledger ------------------------------------------------------------

  describe('ganancia, monto apostado, Yield y ROI salen del ledger (§112.6)', () => {
    it('adulterar los datos derivados de una apuesta no cambia el dashboard y sí lo detecta la integridad', async () => {
      const won = await settleWon('39.00');
      const before = await analysis();
      expect(before).toMatchObject({ profitLoss: '19.00', totalStaked: '20.00' });

      // Se cambian a mano el retorno y el monto de la apuesta, sin pasar por ningún servicio.
      await ctx.t.db
        .update(bets)
        .set({ officialRealizedReturn: '80.00', officialAmount: '30.00' })
        .where(eq(bets.id, won.id));

      const after = await analysis();
      expect(after).toEqual(before); // el dashboard sigue al ledger, no a la apuesta
      const body = await integrity();
      expect(body.status).toBe('ISSUES_FOUND');
      expect(checks(body)).toContain('BET_LEDGER_NET');
      expect(body.findings.find((f) => f.check === 'BET_LEDGER_NET')!.affected).toEqual([
        `bet:${won.id}`,
      ]);
    });

    it('corregir la unidad de la etapa no mueve las cifras de las apuestas liquidadas', async () => {
      await settleWon('39.00');
      const before = await analysis();
      await ctx.t.db.update(stages).set({ unitStake: '99.00' }).where(eq(stages.id, stageId));
      expect(await analysis()).toEqual(before);
      expect((await integrity()).findings).toEqual([]); // el monto congelado sigue siendo coherente
    });

    it('el Yield y el ROI se calculan con esas cifras y cambian con cada corrección', async () => {
      const won = await settleWon('39.00'); // P/L 19.00 sobre 20.00 apostados
      const first = await analysis();
      expect(first.yield).toBe('95.00'); // 19 / 20
      expect(first.roi).toBe('3.80'); // 19 / 500

      const corrected = (await correct(won, { officialRealizedReturn: '45.00' }).expect(200))
        .body as BetDetail;
      const second = await analysis();
      expect(second).toMatchObject({ profitLoss: '25.00', totalStaked: '20.00', yield: '125.00' });
      expect(second.roi).toBe('5.00');

      await correct(corrected, { officialAmount: '25.00' }).expect(200);
      const third = await analysis();
      expect(third).toMatchObject({ profitLoss: '20.00', totalStaked: '25.00' }); // 45 − 25
      expect(third.yield).toBe('80.00');
      await invariant();
    });

    it('los desgloses por casa y por etapa suman lo mismo que el total tras correcciones y reaperturas', async () => {
      const a = await settleWon('39.00');
      const b = await settleWon(null, { placedAt: '2026-06-01T13:10:00.000Z' });
      await correct(a, { status: 'LOST' }).expect(200);
      await post('admin', `/bets/${b.id}/reopen`, { version: b.version, reason: REASON }).expect(
        200,
      );
      const c = await settleWon('41.00', { placedAt: '2026-06-01T13:20:00.000Z' });
      const total = await analysis();
      expect(total.profitLoss).toBe('1.00'); // −20 (a perdida) + 21 (c); b pendiente
      expect(total.byHouse).toEqual([
        { key: 'Betano', profitLoss: '1.00', totalStaked: '40.00', yield: '2.50', count: 2 },
      ]);
      expect(total.byStage[0]).toMatchObject({ profitLoss: '1.00', totalStaked: '40.00' });
      expect((await detail(c.id)).profitLoss).toBe('21.00');
      await invariant();
    });

    it('la curva de rendimiento incluye las reversiones: termina en la ganancia real tras corregir, reabrir y eliminar', async () => {
      const won = await settleWon('39.00');
      const last = async () =>
        (
          (await get('owner', '/dashboard/performance-chart').expect(200)).body as PerformanceBody
        ).points.at(-1)?.cumulativeProfitLoss;
      expect(await last()).toBe('19.00');
      const lost = (await correct(won, { status: 'LOST' }).expect(200)).body as BetDetail;
      expect(await last()).toBe('-20.00');
      const reopened = (
        await post('admin', `/bets/${lost.id}/reopen`, {
          version: lost.version,
          reason: REASON,
        }).expect(200)
      ).body as BetDetail;
      expect(await last()).toBe('0.00');
      await post('admin', `/bets/${reopened.id}/settle`, {
        status: 'WON',
        officialRealizedReturn: '40.00',
        settledAt: SETTLED,
        version: reopened.version,
      }).expect(200);
      expect(await last()).toBe('20.00');
      await post('admin', `/bets/${won.id}/trash`, { reason: 'Registrada por error' }).expect(200);
      expect(await last()).toBe('0.00');
      await invariant();
    });
  });

  // --- Aviso de retornos no confirmados ---------------------------------------------------------

  describe('aviso de retornos no confirmados (D-A6, §112.6)', () => {
    it('cuenta y suma las ganadas provisionales, en el estado y en el análisis', async () => {
      expect(await status()).toMatchObject({ retornosPorConfirmar: 0 });
      expect((await analysis()).unconfirmedReturns).toEqual({ count: 0, profitLoss: '0.00' });

      await settleWon(null);
      await settleWon(null, { placedAt: '2026-06-01T13:10:00.000Z' });
      await settleWon('39.00', { placedAt: '2026-06-01T13:20:00.000Z' }); // oficial: no cuenta
      await newBet({ placedAt: '2026-06-01T13:30:00.000Z' }); // pendiente: no cuenta

      expect(await status()).toMatchObject({ retornosPorConfirmar: 2 });
      const result = await analysis();
      expect(result.unconfirmedReturns).toEqual({ count: 2, profitLoss: '38.00' });
      expect(result.profitLoss).toBe('57.00'); // ya incluye los provisionales
      await invariant();
    });

    it('baja al confirmar, corregir, reabrir o eliminar', async () => {
      const a = await settleWon(null);
      const b = await settleWon(null, { placedAt: '2026-06-01T13:10:00.000Z' });
      const c = await settleWon(null, { placedAt: '2026-06-01T13:20:00.000Z' });
      const d = await settleWon(null, { placedAt: '2026-06-01T13:30:00.000Z' });
      expect((await status()).retornosPorConfirmar).toBe(4);

      await post('admin', `/bets/${a.id}/confirm-return`, {
        version: a.version,
        officialRealizedReturn: '39.00',
      }).expect(200);
      expect((await status()).retornosPorConfirmar).toBe(3);

      await correct(b, { status: 'LOST' }).expect(200);
      expect((await status()).retornosPorConfirmar).toBe(2);

      await post('admin', `/bets/${c.id}/reopen`, { version: c.version, reason: REASON }).expect(
        200,
      );
      expect((await status()).retornosPorConfirmar).toBe(1);

      await post('admin', `/bets/${d.id}/trash`, { reason: 'Error' }).expect(200);
      expect((await status()).retornosPorConfirmar).toBe(0);
      expect((await analysis()).unconfirmedReturns).toEqual({ count: 0, profitLoss: '0.00' });
      await invariant();
    });

    it('respeta los filtros del análisis y no afecta a la realidad financiera', async () => {
      await settleWon(null);
      await settleWon('39.00', { placedAt: '2026-06-01T13:10:00.000Z' });
      expect((await analysis(`?houseId=${houseId}`)).unconfirmedReturns.count).toBe(1);
      expect((await analysis('?status=LOST')).unconfirmedReturns.count).toBe(0);
      expect((await analysis('?to=2026-05-01T00:00:00.000Z')).unconfirmedReturns.count).toBe(0);
      // Los filtros modifican el análisis, nunca el saldo (§33).
      expect((await status()).capitalActual).toBe('538.00');
    });

    it('el análisis muestra el retorno provisional con su valor y la confirmación lo reemplaza', async () => {
      const won = await settleWon(null);
      expect((await analysis()).profitLoss).toBe('19.00');
      await post('admin', `/bets/${won.id}/confirm-return`, {
        version: won.version,
        officialRealizedReturn: '38.00',
        acknowledgeDifference: true,
      }).expect(200);
      const confirmed = await analysis();
      expect(confirmed).toMatchObject({ profitLoss: '18.00' });
      expect(confirmed.unconfirmedReturns.count).toBe(0);
      await invariant();
    });
  });

  // --- Cifras siempre con dos decimales ---------------------------------------------------------

  describe('cifras monetarias normalizadas (D-A13, F7)', () => {
    it('sin apuestas liquidadas, todo llega con dos decimales', async () => {
      const empty = await analysis();
      expect(empty).toMatchObject({
        profitLoss: '0.00',
        totalStaked: '0.00',
        yield: null,
        unconfirmedReturns: { count: 0, profitLoss: '0.00' },
        byHouse: [],
      });
      await newBet(); // solo una pendiente
      expect(await analysis()).toMatchObject({ profitLoss: '0.00', totalStaked: '0.00' });
    });

    it('con datos, los desgloses también llegan con dos decimales', async () => {
      await settleWon('39.5');
      const result = await analysis();
      expect(result.profitLoss).toBe('19.50');
      expect(result.byHouse[0]).toMatchObject({ profitLoss: '19.50', totalStaked: '20.00' });
    });
  });

  // --- Verificación de integridad ---------------------------------------------------------------

  describe('verificación de integridad (§112.7)', () => {
    it('no produce falsos hallazgos tras liquidar, corregir, reabrir, eliminar y restaurar', async () => {
      const a = await settleWon('39.00');
      const b = await settleWon(null, { placedAt: '2026-06-01T13:10:00.000Z' });
      expect((await integrity()).findings).toEqual([]);
      const corrected = (await correct(a, { officialRealizedReturn: '45.00' }).expect(200))
        .body as BetDetail;
      expect((await integrity()).findings).toEqual([]);
      await post('admin', `/bets/${b.id}/reopen`, { version: b.version, reason: REASON }).expect(
        200,
      );
      expect((await integrity()).findings).toEqual([]);
      await post('admin', `/bets/${corrected.id}/trash`, { reason: 'Error' }).expect(200);
      expect((await integrity()).findings).toEqual([]);
      await post('admin', `/bets/${corrected.id}/restore`, { reason: 'Era correcta' }).expect(200);
      expect((await integrity()).findings).toEqual([]);
      await invariant();
    });

    it('SETTLEMENT_SHAPE y BET_LEDGER_NET: una liquidación duplicada en el ledger', async () => {
      const won = await settleWon('39.00');
      await ctx.t.db.insert(financialMovements).values({
        projectId,
        stageId,
        type: 'BET_SETTLEMENT',
        direction: 'CREDIT',
        houseId,
        amount: '39.00',
        operationId: won.id,
        occurredAt: new Date(SETTLED),
        createdBy: people.owner.id,
      });
      const body = await integrity();
      expect(checks(body)).toEqual(['BET_LEDGER_NET', 'SETTLEMENT_SHAPE']);
      for (const finding of body.findings) expect(finding.affected).toEqual([`bet:${won.id}`]);
    });

    it('una liquidada eliminada que conserva su efecto vigente en el ledger (el defecto F1) se detecta', async () => {
      const won = await settleWon('39.00');
      // Se elimina a mano, sin revertir el ledger: lo que hacía la versión anterior.
      await ctx.t.db
        .update(bets)
        .set({ deletedAt: new Date(), purgeEligibleAt: new Date() })
        .where(eq(bets.id, won.id));
      const body = await integrity();
      expect(checks(body)).toEqual(['BET_LEDGER_NET', 'SETTLEMENT_SHAPE']);
    });

    it('una pendiente con filas vigentes en el ledger se detecta', async () => {
      const won = await settleWon('39.00');
      await ctx.t.db
        .update(bets)
        .set({
          status: 'PENDING',
          settledAt: null,
          officialRealizedReturn: null,
          calculatedRealizedReturn: null,
        })
        .where(eq(bets.id, won.id));
      expect(checks(await integrity())).toEqual(['BET_LEDGER_NET', 'SETTLEMENT_SHAPE']);
    });

    it('REVERSAL_INTEGRITY: una reversión sin corrección, o con la corrección de otra apuesta', async () => {
      const won = await settleWon('39.00');
      const other = await settleWon('39.00', { placedAt: '2026-06-01T13:10:00.000Z' });
      const placementOf = async (betId: string) =>
        (
          await ctx.t.db
            .select()
            .from(financialMovements)
            .where(eq(financialMovements.operationId, betId))
        ).find((row) => row.type === 'BET_PLACEMENT')!;
      const reversalOf = (placement: Awaited<ReturnType<typeof placementOf>>, betId: string) => ({
        projectId,
        stageId: placement.stageId,
        type: 'REVERSAL' as const,
        direction: 'CREDIT' as const,
        houseId,
        amount: placement.amount,
        operationId: betId,
        occurredAt: placement.occurredAt,
        reversesMovementId: placement.id,
        reason: 'Sembrada para la prueba',
        createdBy: people.owner.id,
      });

      // Sin corrección.
      const [orphan] = await ctx.t.db
        .insert(financialMovements)
        .values(reversalOf(await placementOf(won.id), won.id))
        .returning();
      // Con la corrección de OTRA apuesta.
      const [foreignCorrection] = await ctx.t.db
        .insert(betCorrections)
        .values({
          projectId,
          betId: won.id,
          kind: 'SETTLEMENT_CORRECTION',
          before: {},
          after: {},
          reason: REASON,
          createdBy: people.owner.id,
        })
        .returning();
      const [mismatched] = await ctx.t.db
        .insert(financialMovements)
        .values({
          ...reversalOf(await placementOf(other.id), other.id),
          correctionId: foreignCorrection!.id,
        })
        .returning();

      const body = await integrity();
      expect(checks(body)).toContain('REVERSAL_INTEGRITY');
      expect(
        body.findings.find((finding) => finding.check === 'REVERSAL_INTEGRITY')!.affected.sort(),
      ).toEqual([`movement:${orphan!.id}`, `movement:${mismatched!.id}`].sort());
    });

    it('CHECKPOINT_INVALIDATION (ledger): una fila fechada antes del checkpoint y escrita después lo delata', async () => {
      await settleWon('39.00');
      ctx.clock.set('2026-06-01T15:00:00.000Z');
      cookies.owner = sessionCookie(await login(ctx.server, people.owner.email).expect(200))!;
      const checkpoint = (
        await post('owner', `/houses/${houseId}/reconciliations`, {
          officialAvailable: '519.00',
        }).expect(201)
      ).body as { id: string };
      expect((await integrity()).findings).toEqual([]);

      // Escritura directa fuera de los servicios (que sí invalidan): un depósito fechado a las 14:30.
      await ctx.t.db.insert(financialMovements).values({
        projectId,
        stageId,
        type: 'DEPOSIT',
        direction: 'CREDIT',
        houseId,
        amount: '10.00',
        occurredAt: new Date('2026-06-01T14:30:00.000Z'),
        createdBy: people.owner.id,
      });
      const body = await integrity();
      expect(body.findings.find((f) => f.check === 'CHECKPOINT_INVALIDATION')!.affected).toEqual([
        `checkpoint:${checkpoint.id}`,
      ]);
    });

    it('una corrección legítima posterior a un checkpoint lo invalida y la verificación no reporta nada', async () => {
      const won = await settleWon('39.00');
      ctx.clock.set('2026-06-01T15:00:00.000Z');
      for (const actor of ['owner', 'admin'] as const) {
        cookies[actor] = sessionCookie(await login(ctx.server, people[actor].email).expect(200))!;
      }
      await post('owner', `/houses/${houseId}/reconciliations`, {
        officialAvailable: '519.00',
      }).expect(201);
      await correct(won, { officialRealizedReturn: '45.00' }).expect(200);
      expect((await integrity()).findings).toEqual([]);
    });

    it('la verificación es de solo lectura: no cambia ninguna cifra', async () => {
      await settleWon('39.00');
      const before = await analysis();
      const rows = await ctx.t.db.select().from(financialMovements);
      await integrity();
      expect(await analysis()).toEqual(before);
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(rows.length);
    });
  });
});
