import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, stages, type UserRow } from '../src/database/schema/index.js';
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

interface StageBody {
  id: string;
  name: string;
  unitStake: string;
  status: string;
  version: number;
  code?: string;
  currentUnitStake?: string;
  newUnitStake?: string;
  affectedBets?: number;
}

describe('etapas del proyecto (e2e, PostgreSQL real, §11, §12, §86)', () => {
  let ctx: TestApp;
  let projectId: string;
  let firstStageId: string;
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
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '0' }] })
      .expect(201);
    firstStageId = (setup.body as { activeStage: { id: string } }).activeStage.id;
  });

  const list = (actor: Actor, query = '') =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/stages${query}`)
      .set('Cookie', cookies[actor]);
  const create = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/stages`)
      .set('Cookie', cookies[actor])
      .send(body);
  const correctUnit = (actor: Actor, stageId: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/stages/${stageId}/unit`)
      .set('Cookie', cookies[actor])
      .send(body);
  const trash = (actor: Actor, stageId: string) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/stages/${stageId}/trash`)
      .set('Cookie', cookies[actor]);
  const restore = (actor: Actor, stageId: string) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/stages/${stageId}/restore`)
      .set('Cookie', cookies[actor]);

  const stageRow = async (id: string) => {
    const [row] = await ctx.t.db.select().from(stages).where(eq(stages.id, id));
    return row!;
  };

  describe('listado', () => {
    it('por defecto muestra la activa (el setup crea Etapa 1)', async () => {
      const response = await list('collab').expect(200);
      const items = response.body as StageBody[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ name: 'Etapa 1', status: 'ACTIVE', unitStake: '10.00' });
    });

    it('el lector también ve las etapas (D8, §50)', async () => {
      await list('reader').expect(200);
      await list('stranger').expect(404);
    });

    it('?status=TRASHED exige poder restaurar; el resto de estados no', async () => {
      await list('collab', '?status=TRASHED').expect(403);
      await list('admin', '?status=TRASHED').expect(200);
      await list('collab', '?status=ACTIVE').expect(200);
    });
  });

  describe('crear/activar una nueva etapa (§86)', () => {
    it('cierra la actual y activa la nueva con nombre autogenerado', async () => {
      const response = await create('admin', { unitStake: '20.00' }).expect(201);
      const created = response.body as StageBody;
      expect(created).toMatchObject({ name: 'Etapa 2', status: 'ACTIVE', unitStake: '20.00' });

      expect((await stageRow(firstStageId)).status).toBe('CLOSED');
      const list1 = (await list('admin').expect(200)).body as StageBody[];
      expect(list1.map((s) => [s.name, s.status]).sort()).toEqual(
        [
          ['Etapa 1', 'CLOSED'],
          ['Etapa 2', 'ACTIVE'],
        ].sort(),
      );
    });

    it('admite un nombre personalizado', async () => {
      const response = await create('admin', { unitStake: '20.00', name: 'Verano 2026' }).expect(
        201,
      );
      expect((response.body as StageBody).name).toBe('Verano 2026');
    });

    it('audita el cierre de la anterior y la creación de la nueva', async () => {
      const created = (await create('admin', { unitStake: '20.00' }).expect(201)).body as StageBody;
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'stage.created')));
      expect(log).toMatchObject({ actorUserId: people.admin.id, entityId: created.id });
      expect(log!.oldValues).toMatchObject({ previousStageId: firstStageId });
      expect(log!.newValues).toMatchObject({ name: created.name, unitStake: '20.00' });
    });

    it('exige unidad positiva', async () => {
      await create('admin', { unitStake: '0' }).expect(400);
      await create('admin', {}).expect(400);
    });

    it('propietario, Administrador de Proyecto y Global pueden; colaboradores y lectores no', async () => {
      for (const actor of ['collab', 'reader'] as const) {
        await create(actor, { unitStake: '5.00' }).expect(403);
      }
      await create('stranger', { unitStake: '5.00' }).expect(404);
      await create('owner', { unitStake: '5.00' }).expect(201);
    });

    it('no se puede crear una etapa si el proyecto no completó la configuración inicial', async () => {
      const fresh = await insertProject(ctx.t.db, { owner: people.owner, name: 'Sin configurar' });
      await insertMember(ctx.t.db, {
        projectId: fresh.project.id,
        userId: people.admin.id,
        roleKey: 'PROJECT_ADMIN',
      });
      const response = await request(ctx.server)
        .post(`/api/projects/${fresh.project.id}/stages`)
        .set('Cookie', cookies.admin)
        .send({ unitStake: '5.00' })
        .expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });
  });

  describe('corrección de unidad (§12.1)', () => {
    it('sin confirmar devuelve una vista previa sin cambiar nada', async () => {
      const response = await correctUnit('admin', firstStageId, { unitStake: '15.00' }).expect(200);
      const preview = response.body as StageBody;
      expect(preview).toMatchObject({
        currentUnitStake: '10.00',
        newUnitStake: '15.00',
        affectedBets: 0,
      });
      expect((await stageRow(firstStageId)).unitStake).toBe('10.00');
    });

    it('confirmar aplica el cambio, exige contraseña reciente y lo audita', async () => {
      ctx.clock.advanceSeconds(6 * 60);
      const denied = await correctUnit('admin', firstStageId, {
        unitStake: '15.00',
        confirm: true,
      }).expect(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');

      await request(ctx.server)
        .post('/api/auth/reauth')
        .set('Cookie', cookies.admin)
        .send({ password: TEST_PASSWORD })
        .expect(200);
      const applied = await correctUnit('admin', firstStageId, {
        unitStake: '15.00',
        confirm: true,
      }).expect(200);
      expect((applied.body as StageBody).unitStake).toBe('15.00');
      expect((await stageRow(firstStageId)).unitStake).toBe('15.00');

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'stage.unit_corrected')),
        );
      expect(log).toMatchObject({
        actorUserId: people.admin.id,
        entityId: firstStageId,
        oldValues: { unitStake: '10.00' },
        newValues: { unitStake: '15.00' },
      });
    });

    it('también corrige la unidad de una etapa cerrada (no solo la activa)', async () => {
      await create('admin', { unitStake: '20.00' }).expect(201);
      expect((await stageRow(firstStageId)).status).toBe('CLOSED');
      const applied = await correctUnit('admin', firstStageId, {
        unitStake: '12.00',
        confirm: true,
      }).expect(200);
      expect((applied.body as StageBody).unitStake).toBe('12.00');
    });

    it('una etapa de otro proyecto o inexistente responde 404', async () => {
      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' });
      await request(ctx.server)
        .post(`/api/projects/${projectId}/stages/${other.project.id}/unit`)
        .set('Cookie', cookies.admin)
        .send({ unitStake: '5.00' })
        .expect(404);
      await correctUnit('admin', '0198a1d2-0000-7000-8000-000000000000', {
        unitStake: '5.00',
      }).expect(404);
      await correctUnit('admin', 'no-es-uuid', { unitStake: '5.00' }).expect(404);
    });

    it('colaboradores y lectores no pueden', async () => {
      await correctUnit('collab', firstStageId, { unitStake: '5.00' }).expect(403);
      await correctUnit('reader', firstStageId, { unitStake: '5.00' }).expect(403);
    });
  });

  describe('corrección de unidad y comprometido de apuestas pendientes (§73, revisión de arquitectura)', () => {
    async function houseId(): Promise<string> {
      const list = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookies.owner)
          .expect(200)
      ).body as { id: string }[];
      return list[0]!.id;
    }

    it('rechaza de forma proactiva si el nuevo comprometido dejaría disponible negativo', async () => {
      const house = await houseId();
      await request(ctx.server)
        .post(`/api/projects/${projectId}/movements/deposits`)
        .set('Cookie', cookies.admin)
        .send({ houseId: house, amount: '100.00' })
        .expect(201);
      // Pendiente sin monto oficial: 5 × 10.00 = 50.00 comprometido; disponible 50.00.
      await request(ctx.server)
        .post(`/api/projects/${projectId}/bets`)
        .set('Cookie', cookies.collab)
        .send({
          houseId: house,
          stake: '5',
          visibleTotalOdds: '1.90',
          placedAt: '2026-06-01T20:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Partido',
              selection: 'Local',
              visibleOdds: '1.90',
            },
          ],
        })
        .expect(201);

      // Subir la unidad a 30.00 exigiría 5 × 30.00 = 150.00, muy por encima del saldo (100.00).
      const denied = await correctUnit('admin', firstStageId, {
        unitStake: '30.00',
        confirm: true,
      });
      expect(denied.status).toBe(409);
      expect(bodyOf(denied).code).toBe('INVALID_STATE');
      // No se aplicó el cambio.
      expect((await stageRow(firstStageId)).unitStake).toBe('10.00');
    });

    it('permite la corrección cuando el nuevo comprometido sigue cabiendo en el disponible', async () => {
      const house = await houseId();
      await request(ctx.server)
        .post(`/api/projects/${projectId}/movements/deposits`)
        .set('Cookie', cookies.admin)
        .send({ houseId: house, amount: '100.00' })
        .expect(201);
      await request(ctx.server)
        .post(`/api/projects/${projectId}/bets`)
        .set('Cookie', cookies.collab)
        .send({
          houseId: house,
          stake: '5',
          visibleTotalOdds: '1.90',
          placedAt: '2026-06-01T20:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Partido',
              selection: 'Local',
              visibleOdds: '1.90',
            },
          ],
        })
        .expect(201);

      // 5 × 15.00 = 75.00, cabe en el saldo de 100.00.
      const applied = await correctUnit('admin', firstStageId, {
        unitStake: '15.00',
        confirm: true,
      }).expect(200);
      expect((applied.body as StageBody).unitStake).toBe('15.00');

      const houseAfter = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookies.owner)
          .expect(200)
      ).body as { id: string; committed: string; available: string }[];
      const updatedHouse = houseAfter.find((h) => h.id === house)!;
      expect(updatedHouse.committed).toBe('75.00');
      expect(updatedHouse.available).toBe('25.00');
    });

    it('una apuesta con monto oficial confirmado no cuenta para el rechazo (§73: nunca se sobrescribe)', async () => {
      const house = await houseId();
      await request(ctx.server)
        .post(`/api/projects/${projectId}/movements/deposits`)
        .set('Cookie', cookies.admin)
        .send({ houseId: house, amount: '100.00' })
        .expect(201);
      // Monto oficial fijo de 90.00: no depende de la unidad, así que una unidad más alta no
      // debe hacer que esta apuesta, por sí sola, bloquee la corrección.
      await request(ctx.server)
        .post(`/api/projects/${projectId}/bets`)
        .set('Cookie', cookies.collab)
        .send({
          houseId: house,
          stake: '5',
          officialAmount: '90.00',
          visibleTotalOdds: '1.90',
          placedAt: '2026-06-01T20:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Partido',
              selection: 'Local',
              visibleOdds: '1.90',
            },
          ],
        })
        .expect(201);

      const applied = await correctUnit('admin', firstStageId, {
        unitStake: '50.00',
        confirm: true,
      }).expect(200);
      expect((applied.body as StageBody).unitStake).toBe('50.00');
    });
  });

  describe('papelera de etapas', () => {
    it('no se puede enviar a la papelera la etapa activa', async () => {
      const response = await trash('admin', firstStageId).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });

    it('una etapa cerrada sí se puede enviar y restaurar (vuelve a CLOSED)', async () => {
      await create('admin', { unitStake: '20.00' }).expect(201); // cierra firstStageId
      await trash('admin', firstStageId).expect(200);
      const trashed = await stageRow(firstStageId);
      expect(trashed).toMatchObject({ status: 'TRASHED', deletedBy: people.admin.id });
      expect(trashed.purgeEligibleAt).not.toBeNull();

      const listed = (await list('admin', '?status=TRASHED').expect(200)).body as StageBody[];
      expect(listed.map((s) => s.id)).toContain(firstStageId);
      // No aparece en el listado normal.
      const normal = (await list('admin').expect(200)).body as StageBody[];
      expect(normal.map((s) => s.id)).not.toContain(firstStageId);

      await restore('admin', firstStageId).expect(200);
      expect((await stageRow(firstStageId)).status).toBe('CLOSED');
    });

    it('se audita enviar a la papelera y restaurar', async () => {
      await create('admin', { unitStake: '20.00' }).expect(201);
      await trash('owner', firstStageId).expect(200);
      await restore('root', firstStageId).expect(200);
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.entityId, firstStageId)));
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining(['stage.trashed', 'stage.restored']),
      );
    });

    it('restaurar una etapa que no está en la papelera falla (409)', async () => {
      await create('admin', { unitStake: '20.00' }).expect(201);
      const response = await restore('admin', firstStageId).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });

    it('colaboradores y lectores no gestionan la papelera; ajenos reciben 404', async () => {
      await create('admin', { unitStake: '20.00' }).expect(201);
      await trash('collab', firstStageId).expect(403);
      await trash('reader', firstStageId).expect(403);
      await trash('stranger', firstStageId).expect(404);
    });
  });

  it('sin sesión todo responde 401', async () => {
    await request(ctx.server).get(`/api/projects/${projectId}/stages`).expect(401);
    await request(ctx.server)
      .post(`/api/projects/${projectId}/stages`)
      .send({ unitStake: '5.00' })
      .expect(401);
  });
});
