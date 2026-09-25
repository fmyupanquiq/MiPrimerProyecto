import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bets, financialMovements, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

/**
/**
 * Fase 8.5.0 (ADR 0019): pruebas de CARACTERIZACIÓN de lo que la Fase 8.5 deja como está.
 *
 * F1 (papelera de una liquidada), F2 (fecha de colocación) y F6 (colocación posterior a la
 * liquidación) se resolvieron en la subfase 8.5.3 y se prueban en `bets-corrections.e2e-spec.ts`;
 * F3 y F4 en la 8.5.2 (`bets-provisional-return.e2e-spec.ts`). Quedan F5 (mover de etapa una
 * liquidada no reescribe la etapa de sus filas del ledger: es inmutable y ningún cálculo la usa,
 * D-A9) y la regla de que una liquidada no admite cambios financieros por edición directa.
 */

interface HouseBody {
  id: string;
  balance: string;
  committed: string;
  available: string;
}
interface BetBody {
  id: string;
  stageId: string;
  amountSource: string;
  effectiveAmount: string;
  officialAmount: string | null;
  officialRealizedReturn: string | null;
  status: string;
  version: number;
  placedAt: string;
}
interface AnalysisBody {
  profitLoss: string;
  counts: Record<string, number>;
}

const selection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};

describe('línea base de la Fase 8.5.0: apuestas liquidadas frente al ledger (caracterización)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  let firstStageId: string;
  const people = {} as Record<'owner' | 'admin', UserRow>;
  const cookies = {} as Record<'owner' | 'admin', string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as 'owner' | 'admin'] = sessionCookie(
        await login(ctx.server, user.email).expect(200),
      )!;
    }
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = (await houses())[0]!.id;
    firstStageId = (
      (await get('/stages').expect(200)).body as {
        id: string;
      }[]
    )[0]!.id;
  });

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const get = (path: string) => request(ctx.server).get(api(path)).set('Cookie', cookies.owner);
  const post = (path: string, body: object = {}) =>
    request(ctx.server).post(api(path)).set('Cookie', cookies.owner).send(body);
  const houses = async () => (await get('/houses').expect(200)).body as HouseBody[];
  const movementsOf = (betId: string) =>
    ctx.t.db.select().from(financialMovements).where(eq(financialMovements.operationId, betId));

  /** Apuesta de S/ 20.00 (stake 2 × unidad 10) ganada con retorno oficial de S/ 39.00. */
  async function settledWinner(
    overrides: { placedAt?: string; settledAt?: string } = {},
  ): Promise<BetBody> {
    const created = (
      await post('/bets', {
        houseId,
        stake: '2.00',
        visibleTotalOdds: '1.95',
        placedAt: overrides.placedAt ?? '2026-06-01T13:00:00.000Z',
        selections: [selection],
      }).expect(201)
    ).body as BetBody;
    return (
      await post(`/bets/${created.id}/settle`, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: overrides.settledAt ?? '2026-06-01T14:00:00.000Z',
        settledTimeKnown: true,
        version: created.version,
      }).expect(200)
    ).body as BetBody;
  }

  describe('F5: mover de etapa una apuesta liquidada no actualiza la etapa de sus movimientos', () => {
    it('la etapa de la apuesta cambia; la de sus filas del ledger no', async () => {
      const bet = await settledWinner();
      const second = (await post('/stages', { unitStake: '20.00' }).expect(201)).body as {
        id: string;
      };

      await post(`/bets/${bet.id}/move-stage`, {
        stageId: second.id,
        version: bet.version,
      }).expect(200);

      const [row] = await ctx.t.db.select().from(bets).where(eq(bets.id, bet.id));
      expect(row!.stageId).toBe(second.id);
      // Confirmado: las filas conservan la etapa original (el ledger es inmutable, D2).
      const moved = await movementsOf(bet.id);
      expect(moved.map((m) => m.stageId)).toEqual([firstStageId, firstStageId]);

      // Alcance real (verificado): ningún cálculo depende de `financial_movements.stage_id`; solo
      // se muestra en el listado de movimientos. Los saldos no cambian y el dashboard (que sale de
      // `bets`) ya atribuye la apuesta a la etapa nueva.
      expect((await houses())[0]).toMatchObject({ balance: '519.00' });
      const byStage = (
        (await get(`/dashboard/analysis?stageId=${second.id}`).expect(200)).body as AnalysisBody
      ).profitLoss;
      expect(byStage).toBe('19.00');
    });
  });

  describe('una liquidada no admite cambios financieros por edición directa (§107.9, §112.3)', () => {
    it('una apuesta liquidada solo admite corregir motivo y fechas (409 con cualquier campo financiero)', async () => {
      const bet = await settledWinner();
      const response = await request(ctx.server)
        .patch(api(`/bets/${bet.id}`))
        .set('Cookie', cookies.owner)
        .send({ officialAmount: '25.00', version: bet.version });
      expect(response.status).toBe(409);
      // Volver a liquidar tampoco: se corrige con "Corregir liquidación" o se reabre.
      await post(`/bets/${bet.id}/settle`, {
        status: 'LOST',
        settledAt: '2026-06-01T11:00:00.000Z',
        version: bet.version,
      }).expect(409);
      const [row] = await ctx.t.db
        .select()
        .from(bets)
        .where(and(eq(bets.id, bet.id), eq(bets.status, 'WON')));
      expect(row).toBeDefined();
    });
  });
});
