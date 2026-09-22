import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  financialMovements,
  houses,
  projects,
  stages,
  type UserRow,
} from '../src/database/schema/index.js';
import { bodyOf, createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface ProjectBody {
  id: string;
  setupComplete: boolean;
  activeStage: { id: string; name: string; unitStake: string } | null;
  status: string;
  version: number;
  code?: string;
}

describe('configuración inicial del proyecto (e2e, PostgreSQL real, D1)', () => {
  let ctx: TestApp;
  let projectId: string;
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
  });

  const setup = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies[actor])
      .send(body);
  const getProject = (actor: Actor) =>
    request(ctx.server).get(`/api/projects/${projectId}`).set('Cookie', cookies[actor]);

  const validPayload = {
    unitStake: '10.00',
    houses: [
      { name: 'Betano', initialAmount: '600.00' },
      { name: 'Betsafe', initialAmount: '400.00' },
      { name: 'Reserva', initialAmount: '0' },
    ],
  };

  it('el propietario completa la configuración: Etapa 1, casas y banca distribuida', async () => {
    const response = await setup('owner', validPayload).expect(201);
    const body = response.body as ProjectBody;
    expect(body.setupComplete).toBe(true);
    expect(body.activeStage).toMatchObject({ name: 'Etapa 1', unitStake: '10.00' });

    const createdStages = await ctx.t.db
      .select()
      .from(stages)
      .where(eq(stages.projectId, projectId));
    expect(createdStages).toHaveLength(1);
    expect(createdStages[0]).toMatchObject({
      status: 'ACTIVE',
      name: 'Etapa 1',
      unitStake: '10.00',
    });

    const createdHouses = await ctx.t.db
      .select()
      .from(houses)
      .where(eq(houses.projectId, projectId))
      .orderBy(houses.name);
    expect(createdHouses.map((h) => h.name)).toEqual(['Betano', 'Betsafe', 'Reserva']);
    expect(createdHouses.every((h) => h.status === 'ACTIVE')).toBe(true);

    // Solo las casas con monto inicial positivo reciben un movimiento (§15: una puede arrancar en cero).
    const movements = await ctx.t.db
      .select()
      .from(financialMovements)
      .where(eq(financialMovements.projectId, projectId));
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === 'INITIAL_CAPITAL' && m.direction === 'CREDIT')).toBe(
      true,
    );
    expect(movements.map((m) => m.amount).sort()).toEqual(['400.00', '600.00']);
    expect(movements.every((m) => m.stageId === createdStages[0]!.id)).toBe(true);

    const [row] = await ctx.t.db.select().from(projects).where(eq(projects.id, projectId));
    expect(row!.setupCompletedAt).not.toBeNull();
  });

  it('audita la configuración con la unidad, el capital total y las casas (sin datos sensibles)', async () => {
    await setup('owner', validPayload).expect(201);
    const [log] = await ctx.t.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'project.setup_completed')),
      );
    expect(log).toMatchObject({
      actorUserId: people.owner.id,
      entityType: 'project',
      entityId: projectId,
    });
    expect(log!.newValues).toMatchObject({ unitStake: '10.00', totalCapital: '1000.00' });
    const houseNames = (log!.newValues!['houses'] as { name: string }[]).map((h) => h.name);
    expect(houseNames.sort()).toEqual(['Betano', 'Betsafe', 'Reserva']);
  });

  it('antes de completarse, GET /projects/:id no muestra etapa activa', async () => {
    const before = await getProject('owner').expect(200);
    expect((before.body as ProjectBody).setupComplete).toBe(false);
    expect((before.body as ProjectBody).activeStage).toBeNull();
  });

  it('no se puede completar dos veces (409 INVALID_STATE) y no duplica nada', async () => {
    await setup('owner', validPayload).expect(201);
    const again = await setup('owner', validPayload).expect(409);
    expect(bodyOf(again).code).toBe('INVALID_STATE');

    expect(
      await ctx.t.db.select().from(stages).where(eq(stages.projectId, projectId)),
    ).toHaveLength(1);
    expect(
      await ctx.t.db.select().from(houses).where(eq(houses.projectId, projectId)),
    ).toHaveLength(3);
  });

  it('solo se completa en un proyecto activo (409 en uno cerrado) y no dice nada a medias', async () => {
    await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
    const response = await setup('owner', validPayload).expect(409);
    expect(bodyOf(response).code).toBe('INVALID_STATE');
    expect(await ctx.t.db.select().from(stages)).toHaveLength(0);
  });

  it('propietario, Administrador de Proyecto y Global pueden; colaboradores y lectores no', async () => {
    for (const actor of ['collab', 'reader'] as const) {
      await setup(actor, validPayload).expect(403);
    }
    await setup('stranger', validPayload).expect(404);
    await setup('admin', validPayload).expect(201);
  });

  it('el Administrador Global completa la configuración de un proyecto del que no es miembro', async () => {
    const response = await setup('root', validPayload).expect(201);
    expect((response.body as ProjectBody).setupComplete).toBe(true);
  });

  describe('validación', () => {
    it('exige al menos una casa', async () => {
      const response = await setup('owner', { unitStake: '10.00', houses: [] }).expect(400);
      expect(bodyOf(response).code).toBe('VALIDATION_FAILED');
    });

    it('rechaza nombres de casa repetidos', async () => {
      await setup('owner', {
        unitStake: '10.00',
        houses: [
          { name: 'Betano', initialAmount: '10' },
          { name: 'betano', initialAmount: '0' },
        ],
      }).expect(400);
    });

    it('la unidad debe ser positiva', async () => {
      await setup('owner', { ...validPayload, unitStake: '0' }).expect(400);
    });

    it('un monto inicial negativo se rechaza', async () => {
      await setup('owner', {
        unitStake: '10.00',
        houses: [{ name: 'Betano', initialAmount: '-1' }],
      }).expect(400);
      expect(await ctx.t.db.select().from(houses).where(eq(houses.projectId, projectId))).toEqual(
        [],
      );
    });
  });

  it('dos configuraciones simultáneas: una gana y la otra recibe 409', async () => {
    const results = await Promise.all([setup('owner', validPayload), setup('admin', validPayload)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await ctx.t.db.select().from(stages).where(eq(stages.projectId, projectId)),
    ).toHaveLength(1);
  });

  it('sin sesión responde 401', async () => {
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .send(validPayload)
      .expect(401);
  });
});
