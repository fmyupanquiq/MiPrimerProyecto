import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stages, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
  name: string;
}
interface StageBody {
  id: string;
  name: string;
}
interface BetBody {
  id: string;
  version: number;
}

describe('dashboard y métricas (e2e, PostgreSQL real, §33, §34, §108)', () => {
  let ctx: TestApp;
  let projectId: string;
  let stageId: string;
  let houseId: string;
  let houseId2: string;
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
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
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
      .send({
        unitStake: '10.00',
        houses: [
          { name: 'Betano', initialAmount: '500.00' },
          { name: 'Bwin', initialAmount: '200.00' },
        ],
      })
      .expect(201);
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    houseId = houseList.find((h) => h.name === 'Betano')!.id;
    houseId2 = houseList.find((h) => h.name === 'Bwin')!.id;
    const stageList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as StageBody[];
    stageId = stageList[0]!.id;
  });

  const status = (actor: Actor) =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/dashboard/status`)
      .set('Cookie', cookies[actor]);
  const analysis = (actor: Actor, query = '') =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/dashboard/analysis${query}`)
      .set('Cookie', cookies[actor]);
  const bankrollChart = (actor: Actor) =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/dashboard/bankroll-chart`)
      .set('Cookie', cookies[actor]);
  const performanceChart = (actor: Actor) =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/dashboard/performance-chart`)
      .set('Cookie', cookies[actor]);
  const createBet = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets`)
      .set('Cookie', cookies[actor])
      .send(body);
  const settleBet = (actor: Actor, betId: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets/${betId}/settle`)
      .set('Cookie', cookies[actor])
      .send(body);
  const deposit = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/movements/deposits`)
      .set('Cookie', cookies[actor])
      .send(body);

  const simpleBet = (overrides: Record<string, unknown> = {}) => ({
    houseId,
    stake: '2.00',
    visibleTotalOdds: '1.95',
    placedAt: '2026-06-01T20:00:00.000Z',
    selections: [
      {
        eventGroup: 0,
        position: 0,
        sport: 'Fútbol',
        market: '1X2',
        event: 'Real Madrid vs. Barcelona',
        selection: 'Real Madrid gana',
        visibleOdds: '1.95',
      },
    ],
    ...overrides,
  });

  describe('GET /dashboard/status (§33: foto actual, sin filtros)', () => {
    it('refleja el capital, el disponible/comprometido y los conteos por estado', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;

      const body = (await status('owner').expect(200)).body as {
        capitalActual: string;
        disponible: string;
        comprometido: string;
        porCasa: { houseId: string; balance: string; committed: string; available: string }[];
        conteoApuestas: { total: number; pending: number; won: number };
      };
      expect(body.capitalActual).toBe('700.00'); // 500 + 200 de capital inicial
      expect(body.comprometido).toBe('20.00'); // stake 2.00 × unidad 10.00, pendiente
      expect(body.disponible).toBe('680.00');
      expect(body.porCasa).toHaveLength(2); // ambas casas, aunque una no tenga movimientos propios
      const betano = body.porCasa.find((h) => h.houseId === houseId)!;
      expect(betano).toMatchObject({ balance: '500.00', committed: '20.00', available: '480.00' });
      expect(body.conteoApuestas).toMatchObject({ total: 1, pending: 1, won: 0 });

      await settleBet('admin', created.id, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        settledTimeKnown: true,
        version: created.version,
      }).expect(200);
      const after = (await status('owner').expect(200)).body as {
        capitalActual: string;
        conteoApuestas: { total: number; pending: number; won: number };
      };
      expect(after.capitalActual).toBe('719.00'); // 700 - 20 (placement) + 39 (settlement)
      expect(after.conteoApuestas).toMatchObject({ total: 1, pending: 0, won: 1 });
    });

    it('un desconocido al proyecto recibe 404; un miembro sin permiso extra igual ve el estado', async () => {
      await status('stranger').expect(404);
      await status('reader').expect(200); // el Lector tiene bets.view + houses.view + movements.view
    });
  });

  describe('GET /dashboard/analysis (§33, §108.1: P/L, Yield, ROI, desgloses)', () => {
    it('calcula P/L, Yield y ROI sobre apuestas liquidadas, y desglosa Mixto en deporte/mercado', async () => {
      // Apuesta 1: Fútbol/1X2, ganada (P/L = 39 - 20 = 19.00).
      const bet1 = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', bet1.id, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        settledTimeKnown: true,
        version: bet1.version,
      }).expect(200);

      // Apuesta 2: múltiple con Fútbol y Tenis (Mixto), perdida (P/L = -20.00).
      const bet2 = (
        await createBet(
          'collab',
          simpleBet({
            selections: [
              {
                eventGroup: 0,
                position: 0,
                sport: 'Fútbol',
                market: '1X2',
                event: 'Real Madrid vs. Barcelona',
                selection: 'Real Madrid gana',
                visibleOdds: '1.50',
              },
              {
                eventGroup: 1,
                position: 0,
                sport: 'Tenis',
                market: 'Ganador',
                event: 'Alcaraz vs. Sinner',
                selection: 'Alcaraz gana',
                visibleOdds: '1.30',
              },
            ],
          }),
        ).expect(201)
      ).body as BetBody;
      await settleBet('admin', bet2.id, {
        status: 'LOST',
        settledAt: '2026-06-03T22:00:00.000Z',
        settledTimeKnown: true,
        version: bet2.version,
      }).expect(200);

      const body = (await analysis('owner').expect(200)).body as {
        profitLoss: string;
        yield: string | null;
        roi: string | null;
        totalStaked: string;
        capitalInvested: string;
        counts: { total: number; won: number; lost: number };
        bySport: { key: string; profitLoss: string }[];
        byMarket: { key: string; profitLoss: string }[];
      };
      expect(body.profitLoss).toBe('-1.00'); // 19.00 - 20.00
      expect(body.totalStaked).toBe('40.00'); // 20.00 + 20.00
      expect(body.yield).toBe('-2.50'); // -1.00 / 40.00 × 100
      expect(body.capitalInvested).toBe('700.00'); // banca inicial, sin depósitos
      expect(body.roi).toBe('-0.14'); // -1.00 / 700.00 × 100
      expect(body.counts).toMatchObject({ total: 2, won: 1, lost: 1 });

      const futbol = body.bySport.find((s) => s.key === 'Fútbol');
      const mixto = body.bySport.find((s) => s.key === 'Mixto');
      expect(futbol).toMatchObject({ profitLoss: '19.00' }); // solo la apuesta 1 (deporte único)
      expect(mixto).toMatchObject({ profitLoss: '-20.00' }); // la apuesta 2, sin contarse en Tenis también
      const tenis = body.bySport.find((s) => s.key === 'Tenis');
      expect(tenis).toBeUndefined(); // nunca se cuenta el P/L de la apuesta 2 dos veces

      const mercadoMixto = body.byMarket.find((m) => m.key === 'Mixto');
      expect(mercadoMixto).toMatchObject({ profitLoss: '-20.00' });
    });

    it('el capital invertido suma los depósitos netos del periodo filtrado (§108.1)', async () => {
      await deposit('owner', { houseId, amount: '100.00' }).expect(201);
      const body = (await analysis('owner').expect(200)).body as { capitalInvested: string };
      expect(body.capitalInvested).toBe('800.00'); // 700 banca inicial + 100 depósito
    });

    it('Cash Out cuenta aparte de Ganada/Perdida (D-M5, §108.6)', async () => {
      const bet = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', bet.id, {
        status: 'CASHOUT',
        officialRealizedReturn: '15.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        settledTimeKnown: true,
        version: bet.version,
      }).expect(200);
      const body = (await analysis('owner').expect(200)).body as {
        counts: { total: number; cashout: number; won: number };
      };
      expect(body.counts).toMatchObject({ total: 1, cashout: 1, won: 0 });
    });

    it('filtra por casa, deporte y estado', async () => {
      const bet1 = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', bet1.id, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        settledTimeKnown: true,
        version: bet1.version,
      }).expect(200);
      const bet2 = (await createBet('collab', simpleBet({ houseId: houseId2 })).expect(201))
        .body as BetBody;
      await settleBet('admin', bet2.id, {
        status: 'LOST',
        settledAt: '2026-06-03T22:00:00.000Z',
        settledTimeKnown: true,
        version: bet2.version,
      }).expect(200);

      const onlyHouse1 = (await analysis('owner', `?houseId=${houseId}`).expect(200)).body as {
        counts: { total: number };
      };
      expect(onlyHouse1.counts.total).toBe(1);

      const sameStage = (await analysis('owner', `?stageId=${stageId}`).expect(200)).body as {
        counts: { total: number };
      };
      expect(sameStage.counts.total).toBe(2); // ambas apuestas están en la única etapa del proyecto

      const onlyWon = (await analysis('owner', '?status=WON').expect(200)).body as {
        counts: { total: number; won: number };
      };
      expect(onlyWon.counts).toMatchObject({ total: 1, won: 1 });

      const onlySport = (await analysis('owner', '?sport=Futbol').expect(200)).body as {
        counts: { total: number };
      };
      expect(onlySport.counts.total).toBe(0); // "Futbol" (sin tilde) no coincide con "Fútbol"
    });
  });

  describe('GET /dashboard/bankroll-chart (§34, §108.3: evolución de banca real)', () => {
    it('acumula todos los movimientos y marca el inicio de una nueva etapa', async () => {
      await deposit('owner', { houseId, amount: '50.00' }).expect(201);
      ctx.clock.advanceSeconds(5); // dentro del margen de inactividad de la sesión (1 hora)
      await request(ctx.server)
        .post(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .send({ name: 'Etapa 2', unitStake: '20.00' })
        .expect(201);
      // `stages.created_at` lo pone `defaultNow()` de PostgreSQL (hora real del servidor), no el
      // reloj falso de las pruebas: se fija aquí al instante simulado para poder comprobar el
      // marcador con datos deterministas, sin tocar el servicio (que en producción sí coincide,
      // porque ahí todo usa la hora real).
      const stageList = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/stages`)
          .set('Cookie', cookies.owner)
          .expect(200)
      ).body as { id: string; name: string }[];
      const stage2Id = stageList.find((s) => s.name === 'Etapa 2')!.id;
      await ctx.t.db
        .update(stages)
        .set({ createdAt: ctx.clock.now() })
        .where(eq(stages.id, stage2Id));

      ctx.clock.advanceSeconds(5);
      await deposit('owner', { houseId, amount: '25.00' }).expect(201);

      const body = (await bankrollChart('owner').expect(200)).body as {
        points: { occurredAt: string; balance: string; stageStarted: { name: string } | null }[];
      };
      // 2 capitales iniciales + 2 depósitos: ningún otro movimiento en este escenario.
      expect(body.points).toHaveLength(4);
      expect(body.points.at(-1)!.balance).toBe('775.00'); // 500 + 200 + 50 + 25
      // El marcador de "Etapa 2" cae en el primer punto a partir de su creación: el segundo depósito.
      const marker = body.points.find((p) => p.stageStarted?.name === 'Etapa 2');
      expect(marker?.balance).toBe('775.00');
    });
  });

  describe('GET /dashboard/performance-chart (D-M3, D-M6, §108.3-4: curva y drawdown)', () => {
    it('excluye depósitos y calcula el drawdown solo sobre las liquidaciones', async () => {
      await deposit('owner', { houseId, amount: '1000.00' }).expect(201); // no debe afectar la curva

      const won = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', won.id, {
        status: 'WON',
        officialRealizedReturn: '39.00', // placement -20.00, settlement +39.00
        settledAt: '2026-06-02T22:00:00.000Z',
        settledTimeKnown: true,
        version: won.version,
      }).expect(200);

      const lost = (await createBet('collab', simpleBet({ stake: '5.00' })).expect(201))
        .body as BetBody;
      await settleBet('admin', lost.id, {
        status: 'LOST', // solo placement: -50.00 (5.00 × 10.00); D-B2: sin fila de liquidación
        settledAt: '2026-06-03T22:00:00.000Z',
        settledTimeKnown: true,
        version: lost.version,
      }).expect(200);

      const body = (await performanceChart('owner').expect(200)).body as {
        points: { cumulativeProfitLoss: string; drawdown: string }[];
        maxDrawdown: string;
      };
      // Orden real: placement de "won" (-20), placement de "lost" (-50), settlement de "won" (+39).
      const cumulative = body.points.map((p) => p.cumulativeProfitLoss);
      expect(cumulative).toEqual(['-20.00', '-70.00', '-31.00']);
      expect(body.maxDrawdown).toBe('50.00'); // pico -20.00 menos el mínimo -70.00
    });
  });

  describe('permisos (D-M8, §108.8: sin dashboard.view, reutiliza bets/houses/movements.view)', () => {
    it('todo rol de proyecto (Administrador, Colaborador, Lector) accede a los 4 endpoints', async () => {
      for (const actor of ['admin', 'collab', 'reader'] as const) {
        await status(actor).expect(200);
        await analysis(actor).expect(200);
        await bankrollChart(actor).expect(200);
        await performanceChart(actor).expect(200);
      }
    });

    it('quien no es miembro del proyecto recibe 404 en los 4 endpoints', async () => {
      await status('stranger').expect(404);
      await analysis('stranger').expect(404);
      await bankrollChart('stranger').expect(404);
      await performanceChart('stranger').expect(404);
    });
  });
});
