import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  financialMovements,
  reconciliationCheckpoints,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertBet, insertMember, insertProject, insertStage } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
}
interface StageBody {
  id: string;
}
interface RunBody {
  id: string;
  projectId: string | null;
  status: 'OK' | 'ISSUES_FOUND';
  findings: { check: string; affected: string[] }[];
}

describe('verificación de integridad del ledger (e2e, PostgreSQL real, §38, §109.2)', () => {
  let ctx: TestApp;
  let projectId: string;
  let stageId: string;
  let houseId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
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
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    houseId = houseList[0]!.id;
    const stageList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as StageBody[];
    stageId = stageList[0]!.id;
  });

  const runProject = (actor: Actor) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/integrity-checks`)
      .set('Cookie', cookies[actor])
      .send({});
  const listProject = (actor: Actor) =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/integrity-checks`)
      .set('Cookie', cookies[actor]);
  const runGlobal = (actor: Actor) =>
    request(ctx.server).post('/api/admin/integrity-checks').set('Cookie', cookies[actor]).send({});
  const listGlobal = (actor: Actor) =>
    request(ctx.server).get('/api/admin/integrity-checks').set('Cookie', cookies[actor]);

  describe('proyecto sano', () => {
    it('reporta OK sin hallazgos, y queda en el historial', async () => {
      const body = (await runProject('owner').expect(201)).body as RunBody;
      expect(body).toMatchObject({ projectId, status: 'OK', findings: [] });

      const history = (await listProject('owner').expect(200)).body as RunBody[];
      expect(history).toHaveLength(1);
      expect(history[0]!.id).toBe(body.id);
    });

    it('nunca modifica datos ni crea movimientos (solo lectura)', async () => {
      const before = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookies.owner)
          .expect(200)
      ).body as { balance: string }[];
      await runProject('owner').expect(201);
      const after = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookies.owner)
          .expect(200)
      ).body as { balance: string }[];
      expect(after).toEqual(before);
    });
  });

  describe('permisos (D-I3)', () => {
    it('Colaborador y Lector no pueden ejecutar el chequeo de proyecto; Administrador sí', async () => {
      await runProject('collab').expect(403);
      await runProject('reader').expect(403);
      await runProject('admin').expect(201);
    });

    it('todo rol de proyecto puede ver el historial (integrity.view)', async () => {
      await runProject('owner').expect(201);
      for (const actor of ['admin', 'collab', 'reader'] as const) {
        await listProject(actor).expect(200);
      }
    });

    it('un desconocido al proyecto recibe 404', async () => {
      await runProject('stranger').expect(404);
    });

    it('el chequeo global es exclusivo del Administrador Global', async () => {
      await runGlobal('owner').expect(403);
      await runGlobal('admin').expect(403);
      const body = (await runGlobal('root').expect(201)).body as RunBody;
      expect(body.projectId).toBeNull();
      await listGlobal('root').expect(200);
    });
  });

  describe('hallazgos detectados (D-I1)', () => {
    it('a) NEGATIVE_AVAILABLE: una casa cuyo disponible recalculado queda negativo', async () => {
      // Retiro insertado directamente en el ledger (fuera del flujo normal, que nunca lo permitiría).
      await ctx.t.db.insert(financialMovements).values({
        projectId,
        stageId,
        type: 'WITHDRAWAL',
        direction: 'DEBIT',
        houseId,
        amount: '600.00', // supera el capital inicial de 500.00
        reason: 'Sembrado directamente para la prueba de integridad',
        occurredAt: ctx.clock.now(),
        createdBy: people.owner.id,
      });
      const body = (await runProject('owner').expect(201)).body as RunBody;
      expect(body.status).toBe('ISSUES_FOUND');
      expect(body.findings.map((f) => f.check)).toContain('NEGATIVE_AVAILABLE');
    });

    it('b) SETTLEMENT_SHAPE: una apuesta WON sin su fila BET_SETTLEMENT', async () => {
      await insertBet(ctx.t.db, {
        projectId,
        stageId,
        houseId,
        createdBy: people.collab.id,
        status: 'WON',
        settledAt: ctx.clock.now(),
        settledTimeKnown: true,
        officialRealizedReturn: '50.00',
      });
      const body = (await runProject('owner').expect(201)).body as RunBody;
      expect(body.status).toBe('ISSUES_FOUND');
      expect(body.findings.map((f) => f.check)).toContain('SETTLEMENT_SHAPE');
    });

    it('c) PENDING_BET_REFERENCES: una apuesta pendiente en una etapa ya en papelera', async () => {
      const trashedStage = await insertStage(ctx.t.db, {
        projectId,
        status: 'TRASHED',
        deletedAt: ctx.clock.now(),
        purgeEligibleAt: new Date(ctx.clock.now().getTime() + 90 * 24 * 60 * 60 * 1000),
      });
      await insertBet(ctx.t.db, {
        projectId,
        stageId: trashedStage.id,
        houseId,
        createdBy: people.collab.id,
        status: 'PENDING',
      });
      const body = (await runProject('owner').expect(201)).body as RunBody;
      expect(body.status).toBe('ISSUES_FOUND');
      expect(body.findings.map((f) => f.check)).toContain('PENDING_BET_REFERENCES');
    });

    it('e) CHECKPOINT_INVALIDATION: un checkpoint MATCHED que debería haberse invalidado', async () => {
      const checkpoint = (
        await request(ctx.server)
          .post(`/api/projects/${projectId}/houses/${houseId}/reconciliations`)
          .set('Cookie', cookies.owner)
          .send({ officialAvailable: '500.00' })
          .expect(201)
      ).body as { id: string; status: string };
      expect(checkpoint.status).toBe('MATCHED');

      // Inserción directa (fuera de BetsService, que sí invalidaría el checkpoint correctamente,
      // §109.1.3): simula que la invalidación automática falló, para probar que este chequeo lo
      // detecta de forma independiente.
      await insertBet(ctx.t.db, {
        projectId,
        stageId,
        houseId,
        createdBy: people.collab.id,
        status: 'PENDING',
        placedAt: new Date('2026-05-01T00:00:00.000Z'),
      });

      const body = (await runProject('owner').expect(201)).body as RunBody;
      expect(body.status).toBe('ISSUES_FOUND');
      const finding = body.findings.find((f) => f.check === 'CHECKPOINT_INVALIDATION');
      expect(finding?.affected).toContain(`checkpoint:${checkpoint.id}`);

      // El checkpoint real, en la tabla, sigue MATCHED (el chequeo es de solo lectura: reporta,
      // no corrige).
      const [row] = await ctx.t.db
        .select()
        .from(reconciliationCheckpoints)
        .where(eq(reconciliationCheckpoints.id, checkpoint.id));
      expect(row!.status).toBe('MATCHED');
    });
  });
});
