import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  financialMovements,
  users,
  type UserRow,
} from '../src/database/schema/index.js';
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
  committed: string;
  available: string;
}
interface WithdrawalBody {
  id: string;
  status: string;
  amount: string;
  reason: string;
  houseId: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  movementId: string | null;
  version: number;
  code?: string;
}

describe('solicitudes de retiro (e2e, PostgreSQL real, §16.2, §79, D5)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
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
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '1000.00' }] })
      .expect(201);
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    houseId = houseList[0]!.id;
  });

  const list = (actor: Actor) =>
    request(ctx.server).get(`/api/projects/${projectId}/withdrawals`).set('Cookie', cookies[actor]);
  const withdraw = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/withdrawals`)
      .set('Cookie', cookies[actor])
      .send(body);
  const approve = (actor: Actor, id: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/withdrawals/${id}/approve`)
      .set('Cookie', cookies[actor])
      .send(body);
  const reject = (actor: Actor, id: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/withdrawals/${id}/reject`)
      .set('Cookie', cookies[actor])
      .send(body);
  const cancel = (actor: Actor, id: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/withdrawals/${id}/cancel`)
      .set('Cookie', cookies[actor])
      .send(body);
  const houseOf = async () => {
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    return houseList.find((h) => h.id === houseId)!;
  };
  const reauthAs = (actor: Actor) =>
    request(ctx.server)
      .post('/api/auth/reauth')
      .set('Cookie', cookies[actor])
      .send({ password: TEST_PASSWORD })
      .expect(200);

  describe('solicitar (§16.2)', () => {
    it('reserva el monto de inmediato: la casa lo muestra como comprometido', async () => {
      const response = await withdraw('admin', {
        houseId,
        amount: '300.00',
        reason: 'Pago de premios',
      }).expect(201);
      expect(response.body).toMatchObject({ status: 'PENDING', amount: '300.00', houseId });
      expect((response.body as WithdrawalBody).requestedBy.id).toBe(people.admin.id);

      const house = await houseOf();
      expect(house).toMatchObject({ balance: '1000.00', committed: '300.00', available: '700.00' });
    });

    it('se audita', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '100.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'withdrawal.requested'));
      expect(log).toMatchObject({ actorUserId: people.admin.id, entityId: created.id, projectId });
    });

    it('exige motivo y monto positivo', async () => {
      await withdraw('admin', { houseId, amount: '100.00', reason: '' }).expect(400);
      await withdraw('admin', { houseId, amount: '0', reason: 'x' }).expect(400);
    });

    it('no permite reservar más del disponible (§17)', async () => {
      const response = await withdraw('admin', {
        houseId,
        amount: '5000.00',
        reason: 'Demasiado',
      }).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });

    it('varias solicitudes se acumulan como comprometido sin superar el disponible', async () => {
      await withdraw('admin', { houseId, amount: '400.00', reason: 'Uno' }).expect(201);
      await withdraw('owner', { houseId, amount: '600.00', reason: 'Dos' }).expect(201);
      expect((await houseOf()).available).toBe('0.00');
      const excess = await withdraw('admin', { houseId, amount: '1.00', reason: 'Tres' }).expect(
        409,
      );
      expect(bodyOf(excess).code).toBe('INVALID_STATE');
    });

    it('colaboradores y lectores no pueden solicitar; ajenos, 404', async () => {
      for (const actor of ['collab', 'reader'] as const) {
        await withdraw(actor, { houseId, amount: '10', reason: 'x' }).expect(403);
      }
      await withdraw('stranger', { houseId, amount: '10', reason: 'x' }).expect(404);
    });
  });

  describe('aprobar (§79)', () => {
    it('otra persona administradora aprueba: genera el movimiento y reduce el saldo', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '300.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;

      await reauthAs('owner');
      const response = await approve('owner', created.id, { version: created.version }).expect(200);
      const body = response.body as WithdrawalBody;
      expect(body.status).toBe('APPROVED');
      expect(body.decidedBy!.id).toBe(people.owner.id);
      expect(body.movementId).not.toBeNull();

      const house = await houseOf();
      expect(house).toMatchObject({ balance: '700.00', committed: '0.00', available: '700.00' });

      const movement = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.id, body.movementId!));
      expect(movement[0]).toMatchObject({
        type: 'WITHDRAWAL',
        direction: 'DEBIT',
        amount: '300.00',
      });
    });

    it('el propio solicitante no puede aprobarse si hay otro administrador habilitado', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '100.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reauthAs('admin');
      const response = await approve('admin', created.id, { version: created.version }).expect(403);
      expect(bodyOf(response).code).toBe('FORBIDDEN');
      expect((await houseOf()).committed).toBe('100.00'); // sigue pendiente
    });

    it('el único administrador del proyecto sí puede autoaprobarse (con contraseña reciente)', async () => {
      // Solo queda `owner` como Administrador de Proyecto: se quita a `admin`.
      await request(ctx.server)
        .delete(`/api/projects/${projectId}/members/${people.admin.id}`)
        .set('Cookie', cookies.owner)
        .send({})
        .expect(204);

      const created = (
        await withdraw('owner', { houseId, amount: '150.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;

      ctx.clock.advanceSeconds(6 * 60);
      const denied = await approve('owner', created.id, { version: created.version }).expect(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');

      await reauthAs('owner');
      const approved = await approve('owner', created.id, { version: created.version }).expect(200);
      expect((approved.body as WithdrawalBody).status).toBe('APPROVED');

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'withdrawal.approved'));
      expect(log!.metadata).toMatchObject({ selfApproved: true });
    });

    it('un administrador con la cuenta deshabilitada o eliminada no cuenta como otro aprobador (§111.3)', async () => {
      const created = (
        await withdraw('owner', { houseId, amount: '120.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reauthAs('owner');
      // Mientras `admin` esté activo, el propietario no puede aprobar su propia solicitud.
      await approve('owner', created.id, { version: created.version }).expect(403);

      await ctx.t.db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, people.admin.id));
      const approved = await approve('owner', created.id, { version: created.version }).expect(200);
      expect((approved.body as WithdrawalBody).status).toBe('APPROVED');
    });

    it('el Administrador Global siempre puede aprobar', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '100.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reauthAs('root');
      await approve('root', created.id, { version: created.version }).expect(200);
    });

    it('revalida el saldo dentro de la transacción: si ya no alcanza, rechaza', async () => {
      // El disponible ya impide, por la API normal, dejar el saldo bruto por debajo de lo
      // comprometido; para probar la revalidación al aprobar simulamos por SQL directo que el
      // saldo bruto bajó entre la solicitud y la aprobación (p. ej. una corrección manual).
      const created = (
        await withdraw('admin', { houseId, amount: '900.00', reason: 'Casi todo' }).expect(201)
      ).body as WithdrawalBody;
      const [stage] = (
        await ctx.t.pool.query<{ id: string }>(
          "SELECT id FROM stages WHERE project_id = $1 AND status = 'ACTIVE'",
          [projectId],
        )
      ).rows;
      await ctx.t.pool.query(
        `INSERT INTO financial_movements
           (id, operation_id, project_id, stage_id, type, direction, house_id, amount, reason, created_by)
         VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, 'EXTRAORDINARY', 'DEBIT', $3, '999.00', 'Corrección manual', $4)`,
        [projectId, stage!.id, houseId, people.admin.id],
      );

      await reauthAs('owner');
      const response = await approve('owner', created.id, { version: created.version }).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
      expect(
        await ctx.t.db
          .select()
          .from(financialMovements)
          .where(eq(financialMovements.type, 'WITHDRAWAL')),
      ).toHaveLength(0);
    });

    it('versión obsoleta: 409 CONCURRENCY_CONFLICT', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '50.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reauthAs('owner');
      const response = await approve('owner', created.id, { version: 999 }).expect(409);
      expect(bodyOf(response).code).toBe('CONCURRENCY_CONFLICT');
    });

    it('no se puede aprobar dos veces', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '50.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reauthAs('owner');
      const first = await approve('owner', created.id, { version: created.version }).expect(200);
      const again = await approve('owner', created.id, {
        version: (first.body as WithdrawalBody).version,
      }).expect(409);
      expect(bodyOf(again).code).toBe('INVALID_STATE');
    });

    it('dos aprobaciones simultáneas de la misma solicitud: solo una gana', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '50.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reauthAs('owner');
      await reauthAs('root');
      const results = await Promise.all([
        approve('owner', created.id, { version: created.version }),
        approve('root', created.id, { version: created.version }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await ctx.t.db
          .select()
          .from(financialMovements)
          .where(eq(financialMovements.type, 'WITHDRAWAL')),
      ).toHaveLength(1);
    });
  });

  describe('rechazar', () => {
    it('libera la reserva sin dejar movimiento en el ledger, sin reautenticación', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '200.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      const response = await reject('owner', created.id, {
        version: created.version,
        reason: 'No corresponde',
      }).expect(200);
      expect((response.body as WithdrawalBody).status).toBe('REJECTED');
      expect((await houseOf()).committed).toBe('0.00');
      expect(
        await ctx.t.db
          .select()
          .from(financialMovements)
          .where(eq(financialMovements.type, 'WITHDRAWAL')),
      ).toHaveLength(0);
    });

    it('se audita', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '10.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reject('owner', created.id, { version: created.version }).expect(200);
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'withdrawal.rejected'));
      expect(log).toMatchObject({ actorUserId: people.owner.id, entityId: created.id });
    });

    it('no se puede rechazar una solicitud que ya no está pendiente', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '10.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await reject('owner', created.id, { version: created.version }).expect(200);
      const response = await reject('owner', created.id, { version: 2 }).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
    });
  });

  describe('cancelar', () => {
    it('quien la solicitó puede cancelarla sin necesitar permiso de aprobar', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '80.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      const response = await cancel('admin', created.id, { version: created.version }).expect(200);
      expect((response.body as WithdrawalBody).status).toBe('CANCELLED');
      expect((await houseOf()).committed).toBe('0.00');
    });

    it('con permiso de solicitar pero no de aprobar, no se puede cancelar la solicitud ajena', async () => {
      // Rol personalizado: puede solicitar retiros, pero no aprobarlos.
      const { rows } = await ctx.t.pool.query<{ id: string }>(
        `INSERT INTO roles (id, name, description, scope, project_id, is_system)
         VALUES (gen_random_uuid(), 'Solicitante', '', 'PROJECT', $1, false) RETURNING id`,
        [projectId],
      );
      for (const code of ['project.view', 'members.view', 'withdrawals.request']) {
        await ctx.t.pool.query(
          'INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)',
          [rows[0]!.id, code],
        );
      }
      const requester = await ctx.createUser({ email: 'solicitante@example.com' });
      const bystander = await ctx.createUser({ email: 'testigo@example.com' });
      await insertMember(ctx.t.db, { projectId, userId: requester.id });
      await ctx.t.pool.query(
        'UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3',
        [rows[0]!.id, projectId, requester.id],
      );
      await insertMember(ctx.t.db, { projectId, userId: bystander.id });
      await ctx.t.pool.query(
        'UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3',
        [rows[0]!.id, projectId, bystander.id],
      );
      const requesterCookie = sessionCookie(await login(ctx.server, requester.email).expect(200))!;
      const bystanderCookie = sessionCookie(await login(ctx.server, bystander.email).expect(200))!;

      const created = (
        await request(ctx.server)
          .post(`/api/projects/${projectId}/withdrawals`)
          .set('Cookie', requesterCookie)
          .send({ houseId, amount: '10.00', reason: 'Pago' })
          .expect(201)
      ).body as WithdrawalBody;

      const response = await request(ctx.server)
        .post(`/api/projects/${projectId}/withdrawals/${created.id}/cancel`)
        .set('Cookie', bystanderCookie)
        .send({ version: created.version })
        .expect(403);
      expect(bodyOf(response).code).toBe('FORBIDDEN');

      // Pero quien la solicitó sí puede.
      await request(ctx.server)
        .post(`/api/projects/${projectId}/withdrawals/${created.id}/cancel`)
        .set('Cookie', requesterCookie)
        .send({ version: created.version })
        .expect(200);
    });

    it('otro Administrador de Proyecto sí puede cancelar (tiene permiso de aprobar)', async () => {
      const created = (
        await withdraw('admin', { houseId, amount: '10.00', reason: 'Pago' }).expect(201)
      ).body as WithdrawalBody;
      await cancel('owner', created.id, { version: created.version }).expect(200);
    });
  });

  describe('listado', () => {
    it('colaboradores y lectores consultan el historial de retiros (D8)', async () => {
      await withdraw('admin', { houseId, amount: '10.00', reason: 'Pago' }).expect(201);
      const response = await list('collab').expect(200);
      expect(response.body as WithdrawalBody[]).toHaveLength(1);
      await list('reader').expect(200);
      await list('stranger').expect(404);
    });
  });

  it('sin sesión todo responde 401', async () => {
    await request(ctx.server).get(`/api/projects/${projectId}/withdrawals`).expect(401);
    await request(ctx.server)
      .post(`/api/projects/${projectId}/withdrawals`)
      .send({ houseId, amount: '10', reason: 'x' })
      .expect(401);
  });
});
