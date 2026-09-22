import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  financialMovements,
  houses,
  type UserRow,
} from '../src/database/schema/index.js';
import { bodyOf, createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
  name: string;
  status: string;
  balance: string;
  committed: string;
  available: string;
  code?: string;
}

describe('casas de apuestas (e2e, PostgreSQL real, §13, §15)', () => {
  let ctx: TestApp;
  let projectId: string;
  let firstHouseId: string;
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

    const setup = await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    firstHouseId = houseList[0]!.id;
    void setup;
  });

  const list = (actor: Actor) =>
    request(ctx.server).get(`/api/projects/${projectId}/houses`).set('Cookie', cookies[actor]);
  const create = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/houses`)
      .set('Cookie', cookies[actor])
      .send(body);
  const deactivate = (actor: Actor, houseId: string) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/houses/${houseId}/deactivate`)
      .set('Cookie', cookies[actor]);
  const activate = (actor: Actor, houseId: string) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/houses/${houseId}/activate`)
      .set('Cookie', cookies[actor]);

  const houseRow = async (id: string) => {
    const [row] = await ctx.t.db.select().from(houses).where(eq(houses.id, id));
    return row!;
  };

  describe('listado con saldos', () => {
    it('muestra el saldo, lo comprometido y lo disponible de la casa creada en el setup', async () => {
      const response = await list('collab').expect(200);
      const items = response.body as HouseBody[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        name: 'Betano',
        status: 'ACTIVE',
        balance: '500.00',
        committed: '0.00',
        available: '500.00',
      });
    });

    it('el lector también ve las casas y sus saldos (D8)', async () => {
      await list('reader').expect(200);
      await list('stranger').expect(404);
    });
  });

  describe('crear una casa', () => {
    it('se crea activa y sin saldo; requiere un depósito o transferencia posterior (§15)', async () => {
      const response = await create('admin', { name: 'Betsafe' }).expect(201);
      const body = response.body as HouseBody;
      expect(body).toMatchObject({
        name: 'Betsafe',
        status: 'ACTIVE',
        balance: '0.00',
        committed: '0.00',
        available: '0.00',
      });
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(1); // solo el capital inicial del setup
    });

    it('se audita', async () => {
      const created = (await create('admin', { name: 'Betsafe' }).expect(201)).body as HouseBody;
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'house.created')));
      expect(log).toMatchObject({ actorUserId: people.admin.id, entityId: created.id });
      expect(log!.newValues).toMatchObject({ name: 'Betsafe' });
    });

    it('rechaza un nombre en blanco', async () => {
      await create('admin', { name: '   ' }).expect(400);
      await create('admin', {}).expect(400);
    });

    it('propietario, Administrador de Proyecto y Global pueden; colaboradores y lectores no', async () => {
      for (const actor of ['collab', 'reader'] as const) {
        await create(actor, { name: 'X' }).expect(403);
      }
      await create('stranger', { name: 'X' }).expect(404);
      await create('owner', { name: 'Y' }).expect(201);
    });

    it('no se puede añadir una casa antes de completar la configuración inicial', async () => {
      const fresh = await insertProject(ctx.t.db, { owner: people.owner, name: 'Sin configurar' });
      await insertMember(ctx.t.db, {
        projectId: fresh.project.id,
        userId: people.admin.id,
        roleKey: 'PROJECT_ADMIN',
      });
      const response = await request(ctx.server)
        .post(`/api/projects/${fresh.project.id}/houses`)
        .set('Cookie', cookies.admin)
        .send({ name: 'Betano' })
        .expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });
  });

  describe('desactivar y reactivar', () => {
    it('no se puede desactivar con saldo distinto de cero', async () => {
      const response = await deactivate('admin', firstHouseId).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
      expect((await houseRow(firstHouseId)).status).toBe('ACTIVE');
    });

    it('una casa en cero sí se puede desactivar y reactivar', async () => {
      const empty = (await create('admin', { name: 'Vacía' }).expect(201)).body as HouseBody;
      await deactivate('admin', empty.id).expect(200);
      expect((await houseRow(empty.id)).status).toBe('INACTIVE');

      await activate('owner', empty.id).expect(200);
      expect((await houseRow(empty.id)).status).toBe('ACTIVE');
    });

    it('se audita', async () => {
      const empty = (await create('admin', { name: 'Vacía' }).expect(201)).body as HouseBody;
      await deactivate('admin', empty.id).expect(200);
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, empty.id), eq(auditLogs.action, 'house.deactivated')));
      expect(log).toMatchObject({
        actorUserId: people.admin.id,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'INACTIVE' },
      });
    });

    it('desactivar dos veces es idempotente (no falla, no vuelve a auditar)', async () => {
      const empty = (await create('admin', { name: 'Vacía' }).expect(201)).body as HouseBody;
      await deactivate('admin', empty.id).expect(200);
      await deactivate('admin', empty.id).expect(200);
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, empty.id), eq(auditLogs.action, 'house.deactivated')));
      expect(logs).toHaveLength(1);
    });

    it('una casa de otro proyecto o inexistente responde 404', async () => {
      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' });
      await request(ctx.server)
        .post(`/api/projects/${projectId}/houses/${other.project.id}/deactivate`)
        .set('Cookie', cookies.admin)
        .expect(404);
      await deactivate('admin', 'no-es-uuid').expect(404);
    });

    it('colaboradores y lectores no pueden', async () => {
      const empty = (await create('admin', { name: 'Vacía' }).expect(201)).body as HouseBody;
      await deactivate('collab', empty.id).expect(403);
      await deactivate('reader', empty.id).expect(403);
    });
  });

  it('sin sesión todo responde 401', async () => {
    await request(ctx.server).get(`/api/projects/${projectId}/houses`).expect(401);
    await request(ctx.server)
      .post(`/api/projects/${projectId}/houses`)
      .send({ name: 'X' })
      .expect(401);
  });
});
