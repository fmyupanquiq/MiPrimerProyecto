import type { AccountDeletionRequestSummary } from '@letfer/shared';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accountDeletionRequests,
  auditLogs,
  sessions,
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

type Actor = 'root' | 'root2' | 'owner' | 'member' | 'plain';

describe('eliminación de cuenta (e2e, PostgreSQL real, §8, §111.3, D8-5, D8-6)', () => {
  let ctx: TestApp;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  async function seed(options: { withSecondAdmin?: boolean } = {}) {
    await ctx.reset();
    for (const key of Object.keys(people)) delete people[key as Actor];
    people.root = await ctx.createUser({
      email: 'root@example.com',
      firstName: 'Rosa',
      globalRole: 'GLOBAL_ADMIN',
    });
    if (options.withSecondAdmin) {
      people.root2 = await ctx.createUser({
        email: 'root2@example.com',
        firstName: 'Ramón',
        globalRole: 'GLOBAL_ADMIN',
      });
    }
    people.owner = await ctx.createUser({ email: 'owner@example.com', firstName: 'Olga' });
    people.member = await ctx.createUser({ email: 'member@example.com', firstName: 'Mario' });
    people.plain = await ctx.createUser({ email: 'plain@example.com', firstName: 'Paula' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  }

  beforeEach(() => seed());

  const get = (actor: Actor, path: string) =>
    request(ctx.server).get(`/api${path}`).set('Cookie', cookies[actor]);
  const post = (actor: Actor, path: string, body: object = {}) =>
    request(ctx.server).post(`/api${path}`).set('Cookie', cookies[actor]).send(body);
  const del = (actor: Actor, path: string) =>
    request(ctx.server).delete(`/api${path}`).set('Cookie', cookies[actor]);

  const requestDeletion = (actor: Actor, reason?: string) =>
    post(actor, '/users/me/deletion-request', reason ? { reason } : {});
  const summary = (response: request.Response) => response.body as AccountDeletionRequestSummary;
  const approve = (actor: Actor, id: string, version = 1, reason?: string) =>
    post(actor, `/admin/account-deletions/${id}/approve`, { version, ...(reason && { reason }) });
  const reject = (actor: Actor, id: string, version = 1, reason?: string) =>
    post(actor, `/admin/account-deletions/${id}/reject`, { version, ...(reason && { reason }) });
  const userRow = async (user: UserRow) =>
    (await ctx.t.db.select().from(users).where(eq(users.id, user.id)))[0]!;
  const auditsOf = (action: string) =>
    ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, action));

  describe('solicitar, consultar y cancelar (la persona usuaria)', () => {
    it('solicita la eliminación: queda pendiente y auditada', async () => {
      const response = await requestDeletion('plain', 'Ya no lo uso').expect(201);
      expect(summary(response)).toMatchObject({
        userId: people.plain.id,
        userName: 'Paula Pérez',
        status: 'PENDING',
        reason: 'Ya no lo uso',
        decidedBy: null,
        version: 1,
      });
      const [log] = await auditsOf('account_deletion.requested');
      expect(log).toMatchObject({
        actorUserId: people.plain.id,
        entityType: 'account_deletion_request',
      });
      // Solicitar no cambia la cuenta ni cierra sesiones.
      expect((await userRow(people.plain)).status).toBe('ACTIVE');
      await get('plain', '/auth/me').expect(200);
    });

    it('la solicitud sin motivo también es válida', async () => {
      const response = await requestDeletion('plain').expect(201);
      expect(summary(response).reason).toBeNull();
    });

    it('solo una solicitud pendiente por persona (409), también ante dos peticiones a la vez', async () => {
      await requestDeletion('plain').expect(201);
      const again = await requestDeletion('plain').expect(409);
      expect(bodyOf(again).code).toBe('CONFLICT');

      const results = await Promise.all([requestDeletion('member'), requestDeletion('member')]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const pending = await ctx.t.db
        .select()
        .from(accountDeletionRequests)
        .where(
          and(
            eq(accountDeletionRequests.userId, people.member.id),
            eq(accountDeletionRequests.status, 'PENDING'),
          ),
        );
      expect(pending).toHaveLength(1);
    });

    it('consulta la propia solicitud (o null si nunca pidió una)', async () => {
      expect((await get('plain', '/users/me/deletion-request').expect(200)).body).toEqual({
        request: null,
      });
      await requestDeletion('plain', 'Motivo').expect(201);
      const current = (await get('plain', '/users/me/deletion-request').expect(200)).body as {
        request: AccountDeletionRequestSummary;
      };
      expect(current.request).toMatchObject({ status: 'PENDING', reason: 'Motivo' });
    });

    it('cancela la propia solicitud y luego puede pedir otra', async () => {
      await requestDeletion('plain').expect(201);
      const cancelled = summary(await del('plain', '/users/me/deletion-request').expect(200));
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        decidedBy: { id: people.plain.id },
      });
      expect(await auditsOf('account_deletion.cancelled')).toHaveLength(1);
      await del('plain', '/users/me/deletion-request').expect(404); // ya no hay pendiente
      await requestDeletion('plain').expect(201);
    });

    it('nadie ve ni cancela la solicitud de otra persona', async () => {
      await requestDeletion('plain').expect(201);
      expect((await get('member', '/users/me/deletion-request').expect(200)).body).toEqual({
        request: null,
      });
      await del('member', '/users/me/deletion-request').expect(404);
      expect(
        (
          await ctx.t.db
            .select()
            .from(accountDeletionRequests)
            .where(eq(accountDeletionRequests.userId, people.plain.id))
        )[0]!.status,
      ).toBe('PENDING');
    });

    it('exige sesión', async () => {
      await request(ctx.server).post('/api/users/me/deletion-request').send({}).expect(401);
      await request(ctx.server).get('/api/users/me/deletion-request').expect(401);
    });
  });

  describe('lista para el Administrador Global', () => {
    it('muestra las pendientes primero y filtra por estado', async () => {
      const first = summary(await requestDeletion('plain').expect(201));
      await reject('root', first.id).expect(200);
      ctx.clock.advanceSeconds(60);
      const second = summary(await requestDeletion('member').expect(201));
      ctx.clock.advanceSeconds(60);
      const third = summary(await requestDeletion('owner').expect(201));

      const all = (await get('root', '/admin/account-deletions').expect(200))
        .body as AccountDeletionRequestSummary[];
      expect(all.map((item) => item.id)).toEqual([third.id, second.id, first.id]);
      expect(all[2]).toMatchObject({ status: 'REJECTED', decidedBy: { id: people.root.id } });

      const pending = (await get('root', '/admin/account-deletions?status=PENDING').expect(200))
        .body as AccountDeletionRequestSummary[];
      expect(pending.map((item) => item.status)).toEqual(['PENDING', 'PENDING']);
      await get('root', '/admin/account-deletions?status=NOPE').expect(400);
    });

    it('solo el Administrador Global puede ver y decidir', async () => {
      const created = summary(await requestDeletion('plain').expect(201));
      for (const actor of ['owner', 'member', 'plain'] as const) {
        await get(actor, '/admin/account-deletions').expect(403);
        await approve(actor, created.id).expect(403);
        await reject(actor, created.id).expect(403);
      }
      await request(ctx.server).get('/api/admin/account-deletions').expect(401);
      expect((await userRow(people.plain)).status).toBe('ACTIVE');
    });
  });

  describe('aprobar', () => {
    it('deja la cuenta eliminada lógicamente, cierra sus sesiones y lo audita', async () => {
      const created = summary(await requestDeletion('plain', 'Adiós').expect(201));
      const response = await approve('root', created.id, created.version, 'Confirmado').expect(200);
      expect(summary(response)).toMatchObject({
        status: 'APPROVED',
        decidedBy: { id: people.root.id },
        decisionReason: 'Confirmado',
      });

      const row = await userRow(people.plain);
      expect(row).toMatchObject({ status: 'DELETED', deletedBy: people.root.id });
      expect(row.deletedAt).not.toBeNull();
      // La identidad histórica se conserva: la fila sigue existiendo con su correo (§8).
      expect(row.email).toBe('plain@example.com');

      await get('plain', '/auth/me').expect(401);
      const attempt = await login(ctx.server, people.plain.email);
      expect(attempt.status).toBe(401);
      expect(bodyOf(attempt).code).toBe('INVALID_CREDENTIALS');
      const live = await ctx.t.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, people.plain.id));
      expect(live.every((session) => session.revokedAt !== null)).toBe(true);

      const [approved] = await auditsOf('account_deletion.approved');
      expect(approved).toMatchObject({
        actorUserId: people.root.id,
        entityId: created.id,
        oldValues: { status: 'PENDING' },
        newValues: { status: 'APPROVED' },
      });
      const statusLogs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'user.status.changed'), eq(auditLogs.entityId, people.plain.id)),
        );
      expect(statusLogs[0]!.newValues).toMatchObject({ status: 'DELETED' });
    });

    it('exige reautenticación reciente', async () => {
      const created = summary(await requestDeletion('plain').expect(201));
      ctx.clock.advanceSeconds(6 * 60);
      const denied = await approve('root', created.id).expect(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');
      expect((await userRow(people.plain)).status).toBe('ACTIVE');

      await post('root', '/auth/reauth', { password: TEST_PASSWORD }).expect(200);
      await approve('root', created.id).expect(200);
    });

    it('no se puede decidir dos veces ni con una versión desactualizada', async () => {
      const created = summary(await requestDeletion('plain').expect(201));
      const stale = await approve('root', created.id, 99).expect(409);
      expect(bodyOf(stale).code).toBe('CONCURRENCY_CONFLICT');
      expect((await userRow(people.plain)).status).toBe('ACTIVE');

      await approve('root', created.id).expect(200);
      const again = await approve('root', created.id, 2).expect(409);
      expect(bodyOf(again).code).toBe('INVALID_STATE');
      await reject('root', created.id, 2).expect(409);
    });

    it('aprobar y cancelar a la vez: solo una operación gana y el estado es coherente', async () => {
      const created = summary(await requestDeletion('plain').expect(201));
      const [approval, cancellation] = await Promise.all([
        approve('root', created.id),
        del('plain', '/users/me/deletion-request'),
      ]);
      const [row] = await ctx.t.db
        .select()
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.id, created.id));
      const account = (await userRow(people.plain)).status;
      if (row!.status === 'APPROVED') {
        expect(account).toBe('DELETED');
        expect(approval.status).toBe(200);
      } else {
        expect(row!.status).toBe('CANCELLED');
        expect(account).toBe('ACTIVE');
        expect(cancellation.status).toBe(200);
      }
    });

    it('una solicitud inexistente o con id mal formado responde 404', async () => {
      await approve('root', '0195f7c0-0000-7000-8000-00000000ffff').expect(404);
      await approve('root', 'no-es-uuid').expect(404);
      await reject('root', 'no-es-uuid').expect(404);
    });
  });

  describe('propietario de proyectos (D8-6)', () => {
    it('no se aprueba mientras sea propietario: 409, la solicitud sigue pendiente y se audita', async () => {
      const { project } = await insertProject(ctx.t.db, {
        owner: people.owner,
        name: 'Grupo Norte',
      });
      const created = summary(await requestDeletion('owner').expect(201));

      const response = await approve('root', created.id).expect(409);
      expect(bodyOf(response).code).toBe('OWNS_PROJECTS');
      expect(response.body).toMatchObject({
        details: { projects: [{ id: project.id, name: 'Grupo Norte' }] },
      });
      expect((await userRow(people.owner)).status).toBe('ACTIVE');
      await get('owner', '/auth/me').expect(200);
      expect((await get('owner', '/users/me/deletion-request').expect(200)).body).toMatchObject({
        request: { status: 'PENDING' },
      });

      const [blocked] = await auditsOf('admin.user_deactivation.blocked');
      expect(blocked).toMatchObject({
        actorUserId: people.root.id,
        entityId: people.owner.id,
        metadata: { attempted: 'delete', reason: 'OWNS_PROJECTS' },
      });
    });

    it('tras transferir la propiedad, la misma solicitud ya se puede aprobar', async () => {
      const { project } = await insertProject(ctx.t.db, { owner: people.owner });
      await insertMember(ctx.t.db, {
        projectId: project.id,
        userId: people.member.id,
        roleKey: 'PROJECT_ADMIN',
      });
      const created = summary(await requestDeletion('owner').expect(201));
      await approve('root', created.id).expect(409);

      await post('root', `/projects/${project.id}/transfer-ownership`, {
        newOwnerId: people.member.id,
      }).expect(200);
      await approve('root', created.id).expect(200);
      expect((await userRow(people.owner)).status).toBe('DELETED');
    });

    it('rechazar sí es posible aunque sea propietario', async () => {
      await insertProject(ctx.t.db, { owner: people.owner });
      const created = summary(await requestDeletion('owner').expect(201));
      await reject('root', created.id).expect(200);
    });
  });

  describe('último Administrador Global (D8-10)', () => {
    it('el único administrador no puede aprobar su propia eliminación', async () => {
      const created = summary(await requestDeletion('root').expect(201));
      const response = await approve('root', created.id).expect(409);
      expect(bodyOf(response).code).toBe('LAST_GLOBAL_ADMIN');
      expect((await userRow(people.root)).status).toBe('ACTIVE');
      await get('root', '/auth/me').expect(200);

      const [blocked] = await auditsOf('admin.user_deactivation.blocked');
      expect(blocked).toMatchObject({
        actorUserId: people.root.id,
        entityId: people.root.id,
        metadata: { attempted: 'delete', reason: 'LAST_GLOBAL_ADMIN' },
      });
      expect(await auditsOf('account_deletion.approved')).toHaveLength(0);
    });

    it('con otro administrador activo se puede eliminar a uno, pero no al que queda', async () => {
      await seed({ withSecondAdmin: true });
      const first = summary(await requestDeletion('root').expect(201));
      await approve('root2', first.id).expect(200);
      expect((await userRow(people.root)).status).toBe('DELETED');

      const second = summary(await requestDeletion('root2').expect(201));
      const response = await approve('root2', second.id).expect(409);
      expect(bodyOf(response).code).toBe('LAST_GLOBAL_ADMIN');
      expect((await userRow(people.root2)).status).toBe('ACTIVE');
    });
  });

  describe('rechazar', () => {
    it('rechaza sin reautenticación, conserva la cuenta y permite una nueva solicitud', async () => {
      const created = summary(await requestDeletion('plain').expect(201));
      ctx.clock.advanceSeconds(6 * 60); // la contraseña ya no es reciente: rechazar no la exige
      const response = await reject('root', created.id, 1, 'Necesitamos hablar').expect(200);
      expect(summary(response)).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'Necesitamos hablar',
        decidedBy: { id: people.root.id },
      });
      expect((await userRow(people.plain)).status).toBe('ACTIVE');
      expect(await auditsOf('account_deletion.rejected')).toHaveLength(1);
      await requestDeletion('plain').expect(201);
    });
  });
});
