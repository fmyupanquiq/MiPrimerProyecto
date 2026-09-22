import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, type UserRow } from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
  name: string;
  balance: string;
  available: string;
}
interface MovementBody {
  id: string;
  type: string;
  direction: string | null;
  houseId: string | null;
  houseName: string | null;
  fromHouseId: string | null;
  toHouseId: string | null;
  amount: string;
  reason: string | null;
  code?: string;
}

describe('movimientos financieros (e2e, PostgreSQL real, §16, §72)', () => {
  let ctx: TestApp;
  let projectId: string;
  let betano: string;
  let betsafe: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
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
          { name: 'Betsafe', initialAmount: '0' },
        ],
      })
      .expect(201);
    const list = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    betano = list.find((h) => h.name === 'Betano')!.id;
    betsafe = list.find((h) => h.name === 'Betsafe')!.id;
  });

  const listMovements = (actor: Actor) =>
    request(ctx.server).get(`/api/projects/${projectId}/movements`).set('Cookie', cookies[actor]);
  const deposit = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/movements/deposits`)
      .set('Cookie', cookies[actor])
      .send(body);
  const transfer = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/movements/transfers`)
      .set('Cookie', cookies[actor])
      .send(body);
  const extraordinary = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/movements/extraordinary`)
      .set('Cookie', cookies[actor])
      .send(body);
  const houseOf = async (id: string) => {
    const list = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    return list.find((h) => h.id === id)!;
  };

  describe('depósito (§16.1)', () => {
    it('aumenta el saldo de la casa y se audita', async () => {
      const response = await deposit('admin', { houseId: betsafe, amount: '200.00' }).expect(201);
      expect(response.body).toMatchObject({
        type: 'DEPOSIT',
        direction: 'CREDIT',
        houseId: betsafe,
        houseName: 'Betsafe',
        amount: '200.00',
      });
      expect((await houseOf(betsafe)).balance).toBe('200.00');

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'movement.deposit_created'));
      expect(log).toMatchObject({ actorUserId: people.admin.id, projectId });
    });

    it('el motivo es opcional', async () => {
      const response = await deposit('admin', { houseId: betsafe, amount: '10.00' }).expect(201);
      expect((response.body as MovementBody).reason).toBeNull();
    });

    it('rechaza monto no positivo y una casa de otro proyecto', async () => {
      await deposit('admin', { houseId: betsafe, amount: '0' }).expect(400);
      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' });
      await deposit('admin', { houseId: other.project.id, amount: '10' }).expect(404);
    });

    it('no se puede depositar en una casa desactivada', async () => {
      await request(ctx.server)
        .post(`/api/projects/${projectId}/houses/${betsafe}/deactivate`)
        .set('Cookie', cookies.admin)
        .expect(200);
      const response = await deposit('admin', { houseId: betsafe, amount: '10' }).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });

    it('propietario, Administrador de Proyecto y Global pueden; colaboradores y lectores no', async () => {
      for (const actor of ['collab', 'reader'] as const) {
        await deposit(actor, { houseId: betsafe, amount: '10' }).expect(403);
      }
      await deposit('stranger', { houseId: betsafe, amount: '10' }).expect(404);
      await deposit('root', { houseId: betsafe, amount: '10' }).expect(201);
    });
  });

  describe('transferencia interna (§16.3)', () => {
    it('mueve saldo entre casas de forma atómica sin alterar el capital total', async () => {
      const response = await transfer('admin', {
        fromHouseId: betano,
        toHouseId: betsafe,
        amount: '150.00',
      }).expect(201);
      expect(response.body).toMatchObject({
        type: 'TRANSFER',
        direction: null,
        fromHouseId: betano,
        toHouseId: betsafe,
        amount: '150.00',
      });
      expect((await houseOf(betano)).balance).toBe('350.00');
      expect((await houseOf(betsafe)).balance).toBe('150.00');
    });

    it('no permite dejar el origen en negativo (§17)', async () => {
      const response = await transfer('admin', {
        fromHouseId: betano,
        toHouseId: betsafe,
        amount: '999.00',
      }).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
      expect((await houseOf(betano)).balance).toBe('500.00');
    });

    it('rechaza origen y destino iguales', async () => {
      await transfer('admin', { fromHouseId: betano, toHouseId: betano, amount: '10' }).expect(400);
    });

    it('se audita con ambas casas', async () => {
      await transfer('admin', { fromHouseId: betano, toHouseId: betsafe, amount: '50.00' }).expect(
        201,
      );
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'movement.transfer_created'));
      expect(log!.newValues).toMatchObject({
        fromHouseId: betano,
        toHouseId: betsafe,
        amount: '50.00',
      });
    });

    it('dos transferencias simultáneas: la suma nunca deja el saldo negativo', async () => {
      // Saldo 500; dos transferencias de 300 compitiendo: solo una debe pasar.
      const results = await Promise.all([
        transfer('admin', { fromHouseId: betano, toHouseId: betsafe, amount: '300.00' }),
        transfer('owner', { fromHouseId: betano, toHouseId: betsafe, amount: '300.00' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const house = await houseOf(betano);
      expect(Number(house.balance)).toBeGreaterThanOrEqual(0);
      expect(house.balance).toBe('200.00');
    });

    it('colaboradores y lectores no pueden transferir', async () => {
      await transfer('collab', { fromHouseId: betano, toHouseId: betsafe, amount: '10' }).expect(
        403,
      );
      await transfer('reader', { fromHouseId: betano, toHouseId: betsafe, amount: '10' }).expect(
        403,
      );
    });
  });

  describe('extraordinario (§16.4)', () => {
    it('CREDIT suma al saldo, exige motivo y reautenticación', async () => {
      ctx.clock.advanceSeconds(6 * 60);
      const denied = await extraordinary('admin', {
        houseId: betano,
        amount: '25.00',
        direction: 'CREDIT',
        reason: 'Cashback semanal',
      }).expect(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');

      await request(ctx.server)
        .post('/api/auth/reauth')
        .set('Cookie', cookies.admin)
        .send({ password: TEST_PASSWORD })
        .expect(200);
      const response = await extraordinary('admin', {
        houseId: betano,
        amount: '25.00',
        direction: 'CREDIT',
        reason: 'Cashback semanal',
      }).expect(201);
      expect(response.body).toMatchObject({
        type: 'EXTRAORDINARY',
        direction: 'CREDIT',
        amount: '25.00',
      });
      expect((await houseOf(betano)).balance).toBe('525.00');
    });

    it('DEBIT resta y no puede dejar el saldo negativo', async () => {
      const ok = await extraordinary('admin', {
        houseId: betano,
        amount: '50.00',
        direction: 'DEBIT',
        reason: 'Comisión de la casa',
      }).expect(201);
      expect(ok.body).toMatchObject({ direction: 'DEBIT' });
      expect((await houseOf(betano)).balance).toBe('450.00');

      const denied = await extraordinary('admin', {
        houseId: betano,
        amount: '9999.00',
        direction: 'DEBIT',
        reason: 'Comisión enorme',
      }).expect(409);
      expect(bodyOf(denied).code).toBe('INVALID_STATE');
    });

    it('el motivo es obligatorio (nunca un "ajuste" genérico)', async () => {
      await extraordinary('admin', { houseId: betano, amount: '10', direction: 'CREDIT' }).expect(
        400,
      );
      await extraordinary('admin', {
        houseId: betano,
        amount: '10',
        direction: 'CREDIT',
        reason: '   ',
      }).expect(400);
    });

    it('colaboradores y lectores no pueden', async () => {
      await extraordinary('collab', {
        houseId: betano,
        amount: '10',
        direction: 'CREDIT',
        reason: 'x',
      }).expect(403);
    });
  });

  describe('historial', () => {
    it('lista los movimientos, más recientes primero, con nombres de casa', async () => {
      await deposit('admin', { houseId: betsafe, amount: '10.00' }).expect(201);
      ctx.clock.advanceSeconds(5);
      await transfer('admin', { fromHouseId: betano, toHouseId: betsafe, amount: '20.00' }).expect(
        201,
      );

      const response = await listMovements('collab').expect(200);
      const items = response.body as MovementBody[];
      // El setup ya generó un INITIAL_CAPITAL; más el depósito y la transferencia = 3.
      expect(items).toHaveLength(3);
      expect(items[0]!.type).toBe('TRANSFER');
      expect(items[0]!.fromHouseId).toBe(betano);
      expect(items.every((m) => m.houseName !== undefined)).toBe(true);
    });

    it('colaboradores y lectores consultan el historial (D8); ajenos, 404', async () => {
      await listMovements('collab').expect(200);
      await listMovements('reader').expect(200);
      await listMovements('stranger').expect(404);
    });
  });

  it('sin sesión todo responde 401', async () => {
    await request(ctx.server).get(`/api/projects/${projectId}/movements`).expect(401);
    await request(ctx.server)
      .post(`/api/projects/${projectId}/movements/deposits`)
      .send({ houseId: betano, amount: '10' })
      .expect(401);
  });
});
