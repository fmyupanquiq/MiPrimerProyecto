import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bets, financialMovements, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

/**
 * Fase 8.5.0 (ADR 0019, borrador): pruebas de CARACTERIZACIÓN del comportamiento actual de `main`.
 *
 * No fijan lo deseado: documentan, con PostgreSQL real, tres inconsistencias entre la apuesta, el
 * ledger y el dashboard que la Fase 8.5 debe resolver (F1, F2, F5) más dos limitaciones del modelo
 * (F3, F4). Cada bloque indica qué subfase lo corrige; al corregirlo, la aserción que describe el
 * defecto se invierte (o se elimina) en ese mismo commit. Mientras tanto están en verde para no
 * bloquear `npm run check`.
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
  const analysis = async () => (await get('/dashboard/analysis').expect(200)).body as AnalysisBody;
  const movementsOf = (betId: string) =>
    ctx.t.db.select().from(financialMovements).where(eq(financialMovements.operationId, betId));
  const allMovements = () => ctx.t.db.select().from(financialMovements);

  /** Apuesta de S/ 20.00 (stake 2 × unidad 10) ganada con retorno oficial de S/ 39.00. */
  async function settledWinner(
    overrides: { placedAt?: string; settledAt?: string } = {},
  ): Promise<BetBody> {
    const created = (
      await post('/bets', {
        houseId,
        stake: '2.00',
        visibleTotalOdds: '1.95',
        placedAt: overrides.placedAt ?? '2026-06-01T08:00:00.000Z',
        selections: [selection],
      }).expect(201)
    ).body as BetBody;
    return (
      await post(`/bets/${created.id}/settle`, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: overrides.settledAt ?? '2026-06-01T10:00:00.000Z',
        settledTimeKnown: true,
        version: created.version,
      }).expect(200)
    ).body as BetBody;
  }

  describe('F1: la papelera de una apuesta liquidada no toca el ledger, pero sí el dashboard', () => {
    it('el saldo sigue contando la apuesta y el P/L la excluye; restaurar tampoco genera nada', async () => {
      const bet = await settledWinner();
      expect((await houses())[0]).toMatchObject({ balance: '519.00' }); // 500 - 20 + 39
      expect((await analysis()).profitLoss).toBe('19.00');
      expect(await allMovements()).toHaveLength(3); // capital, colocación y liquidación

      await post(`/bets/${bet.id}/trash`, { reason: 'Registrada por error' }).expect(200);

      // DEFECTO: el dashboard ya no ve la apuesta, pero el ledger conserva su efecto.
      // (F7, menor: sin apuestas el P/L llega como "0" y no como "0.00", a diferencia del resto.)
      expect((await analysis()).profitLoss).toBe('0');
      expect((await houses())[0]).toMatchObject({ balance: '519.00' });
      expect(await allMovements()).toHaveLength(3); // ninguna reversión

      await post(`/bets/${bet.id}/restore`).expect(200);
      expect((await analysis()).profitLoss).toBe('19.00');
      expect(await allMovements()).toHaveLength(3); // tampoco se re-registró nada
    });

    it('la verificación de integridad no detecta esa divergencia (comprobación b, D-I1)', async () => {
      const bet = await settledWinner();
      await post(`/bets/${bet.id}/trash`).expect(200);
      const run = (await post('/integrity-checks').expect(201)).body as {
        status: string;
        findings: unknown[];
      };
      // DEFECTO: hoy el chequeo no compara el efecto neto del ledger con el P/L de las apuestas.
      expect(run).toMatchObject({ status: 'OK', findings: [] });
    });
  });

  describe('F2: editar la fecha de colocación de una apuesta liquidada no mueve su BET_PLACEMENT', () => {
    it('la apuesta y su movimiento quedan con fechas distintas', async () => {
      const bet = await settledWinner();
      const before = (await movementsOf(bet.id)).find((m) => m.type === 'BET_PLACEMENT')!;
      expect(before.occurredAt.toISOString()).toBe('2026-06-01T08:00:00.000Z');

      const edited = (
        await request(ctx.server)
          .patch(api(`/bets/${bet.id}`))
          .set('Cookie', cookies.owner)
          .send({ placedAt: '2026-05-20T10:00:00.000Z', version: bet.version })
          .expect(200)
      ).body as BetBody;
      expect(edited.placedAt).toBe('2026-05-20T10:00:00.000Z');

      // DEFECTO: el ledger conserva la fecha anterior y no se registró ninguna corrección.
      const after = (await movementsOf(bet.id)).find((m) => m.type === 'BET_PLACEMENT')!;
      expect(after.occurredAt.toISOString()).toBe('2026-06-01T08:00:00.000Z');
      expect(await movementsOf(bet.id)).toHaveLength(2);
    });

    it('se acepta una fecha de colocación posterior a la liquidación (secuencia imposible)', async () => {
      const bet = await settledWinner();
      const response = await request(ctx.server)
        .patch(api(`/bets/${bet.id}`))
        .set('Cookie', cookies.owner)
        .send({ placedAt: '2026-06-05T10:00:00.000Z', version: bet.version });
      // DEFECTO (hallazgo nuevo F6): nada valida que colocación ≤ liquidación al editar.
      expect(response.status).toBe(200);
      const [row] = await ctx.t.db.select().from(bets).where(eq(bets.id, bet.id));
      expect(row!.placedAt.getTime()).toBeGreaterThan(row!.settledAt!.getTime());
    });
  });

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

  describe('F3 y F4: limitaciones del modelo respecto de §76 y §77', () => {
    it('F3: liquidar congela el monto calculado en official_amount y amountSource pasa a CONFIRMED', async () => {
      const bet = await settledWinner();
      expect(bet).toMatchObject({ officialAmount: '20.00', amountSource: 'CONFIRMED' });
      // Nunca hubo un monto oficial: se calculó (2.00 × 10.00) y se guardó como si lo fuera.
    });

    it('F4: no se puede liquidar una ganada sin retorno oficial (no existe el retorno provisional)', async () => {
      const created = (
        await post('/bets', {
          houseId,
          stake: '2.00',
          visibleTotalOdds: '1.95',
          placedAt: '2026-06-01T08:00:00.000Z',
          selections: [selection],
        }).expect(201)
      ).body as BetBody;
      const response = await post(`/bets/${created.id}/settle`, {
        status: 'WON',
        settledAt: '2026-06-01T10:00:00.000Z',
        version: created.version,
      });
      expect(response.status).toBe(400);
    });

    it('una apuesta liquidada solo admite corregir motivo y fechas (409 con cualquier campo financiero)', async () => {
      const bet = await settledWinner();
      const response = await request(ctx.server)
        .patch(api(`/bets/${bet.id}`))
        .set('Cookie', cookies.owner)
        .send({ officialAmount: '25.00', version: bet.version });
      expect(response.status).toBe(409);
      // Y no existe ninguna ruta para corregir el retorno, el estado ni reabrir a PENDING.
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
