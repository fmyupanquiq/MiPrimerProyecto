import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  projects,
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

type Actor = 'root' | 'owner' | 'admin' | 'member' | 'plain';

describe('administración de proyectos y sesiones (e2e, PostgreSQL real, §111.5)', () => {
  let ctx: TestApp;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com', firstName: 'Olga' });
    people.admin = await ctx.createUser({ email: 'admin@example.com', firstName: 'Adela' });
    people.member = await ctx.createUser({ email: 'member@example.com', firstName: 'Mario' });
    people.plain = await ctx.createUser({ email: 'plain@example.com' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const get = (actor: Actor, path: string) =>
    request(ctx.server).get(`/api${path}`).set('Cookie', cookies[actor]);
  const post = (actor: Actor, path: string, body: object = {}) =>
    request(ctx.server).post(`/api${path}`).set('Cookie', cookies[actor]).send(body);

  describe('cerrar las sesiones de un usuario (Administrador Global)', () => {
    it('cierra todas sus sesiones, no cambia el estado de la cuenta y lo audita', async () => {
      // La persona tiene dos sesiones abiertas (dos dispositivos).
      await login(ctx.server, people.plain.email).expect(200);
      const response = await post('root', `/admin/users/${people.plain.id}/revoke-sessions`).expect(
        200,
      );
      expect(response.body).toEqual({ revoked: 2 });

      await get('plain', '/auth/me').expect(401);
      const live = await ctx.t.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, people.plain.id)));
      expect(live.every((session) => session.revokedAt !== null)).toBe(true);
      expect(live.every((session) => session.revokedReason === 'revoked_by_admin')).toBe(true);
      // La cuenta sigue activa: puede volver a iniciar sesión.
      expect(
        (await ctx.t.db.select().from(users).where(eq(users.id, people.plain.id)))[0]!.status,
      ).toBe('ACTIVE');
      await login(ctx.server, people.plain.email).expect(200);

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'admin.user_sessions.revoked'));
      expect(log).toMatchObject({
        actorUserId: people.root.id,
        entityId: people.plain.id,
        metadata: { revokedSessions: 2 },
      });
    });

    it('es idempotente: sin sesiones abiertas devuelve 0', async () => {
      await post('root', `/admin/users/${people.plain.id}/revoke-sessions`).expect(200);
      const again = await post('root', `/admin/users/${people.plain.id}/revoke-sessions`).expect(
        200,
      );
      expect(again.body).toEqual({ revoked: 0 });
    });

    it('exige reautenticación reciente', async () => {
      ctx.clock.advanceSeconds(6 * 60);
      const denied = await post('root', `/admin/users/${people.plain.id}/revoke-sessions`).expect(
        403,
      );
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');
      await get('plain', '/auth/me').expect(200);

      await post('root', '/auth/reauth', { password: TEST_PASSWORD }).expect(200);
      await post('root', `/admin/users/${people.plain.id}/revoke-sessions`).expect(200);
    });

    it('solo el Administrador Global; un usuario inexistente responde 404', async () => {
      for (const actor of ['owner', 'admin', 'member', 'plain'] as const) {
        await post(actor, `/admin/users/${people.member.id}/revoke-sessions`).expect(403);
      }
      await get('member', '/auth/me').expect(200);
      await post('root', '/admin/users/no-es-uuid/revoke-sessions').expect(404);
      await post(
        'root',
        '/admin/users/0195f7c0-0000-7000-8000-00000000ffff/revoke-sessions',
      ).expect(404);
    });
  });

  describe('propiedad de un proyecto en la papelera', () => {
    let projectId: string;

    beforeEach(async () => {
      const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' });
      projectId = project.id;
      await insertMember(ctx.t.db, {
        projectId,
        userId: people.admin.id,
        roleKey: 'PROJECT_ADMIN',
      });
      await insertMember(ctx.t.db, {
        projectId,
        userId: people.member.id,
        roleKey: 'COLLABORATOR',
      });
      await ctx.t.db
        .update(projects)
        .set({
          status: 'TRASHED',
          previousStatus: 'ACTIVE',
          deletedAt: new Date('2026-05-01T00:00:00.000Z'),
          purgeEligibleAt: new Date('2026-07-30T00:00:00.000Z'),
        })
        .where(eq(projects.id, projectId));
    });

    it('el Administrador Global ve los miembros y transfiere la propiedad aunque esté en la papelera', async () => {
      const members = (
        await get('root', `/projects/${projectId}/members?status=ACTIVE`).expect(200)
      ).body as { userId: string }[];
      expect(members.map((member) => member.userId)).toContain(people.admin.id);

      const transferred = await post('root', `/projects/${projectId}/transfer-ownership`, {
        newOwnerId: people.admin.id,
      }).expect(200);
      expect(transferred.body).toMatchObject({ ownerId: people.admin.id, status: 'TRASHED' });
    });

    it('así se desbloquea la cuenta de la antigua propietaria (D8-6)', async () => {
      const blocked = await post('root', `/admin/users/${people.owner.id}/disable`, { version: 1 });
      expect(blocked.status).toBe(409);
      expect(bodyOf(blocked).code).toBe('OWNS_PROJECTS');

      await post('root', `/projects/${projectId}/transfer-ownership`, {
        newOwnerId: people.admin.id,
      }).expect(200);
      const owner = (await ctx.t.db.select().from(users).where(eq(users.id, people.owner.id)))[0]!;
      await post('root', `/admin/users/${people.owner.id}/disable`, {
        version: owner.version,
      }).expect(200);
    });

    it('quien no puede restaurar el proyecto sigue sin ver nada: 404', async () => {
      await get('admin', `/projects/${projectId}/members?status=ACTIVE`).expect(404);
      await get('member', `/projects/${projectId}/members?status=ACTIVE`).expect(404);
      await get('plain', `/projects/${projectId}/members?status=ACTIVE`).expect(404);
      await post('admin', `/projects/${projectId}/transfer-ownership`, {
        newOwnerId: people.admin.id,
      }).expect(404);
    });

    it('sigue exigiendo ser miembro activo y reautenticación reciente', async () => {
      const outsider = await post('root', `/projects/${projectId}/transfer-ownership`, {
        newOwnerId: people.plain.id,
      }).expect(409);
      expect(bodyOf(outsider).code).toBe('INVALID_STATE');

      ctx.clock.advanceSeconds(6 * 60);
      const stale = await post('root', `/projects/${projectId}/transfer-ownership`, {
        newOwnerId: people.admin.id,
      }).expect(403);
      expect(bodyOf(stale).code).toBe('REAUTH_REQUIRED');
    });
  });

  it('el Administrador Global lista todos los proyectos y todas las papeleras', async () => {
    const active = (await insertProject(ctx.t.db, { owner: people.owner, name: 'Activo' })).project;
    const other = (await insertProject(ctx.t.db, { owner: people.admin, name: 'Ajeno' })).project;
    const trashed = (
      await insertProject(ctx.t.db, {
        owner: people.member,
        name: 'Viejo',
        status: 'TRASHED',
        previousStatus: 'ACTIVE',
        deletedAt: new Date('2026-05-01T00:00:00.000Z'),
        purgeEligibleAt: new Date('2026-07-30T00:00:00.000Z'),
      })
    ).project;

    const all = (await get('root', '/projects?scope=all').expect(200)).body as { id: string }[];
    expect(all.map((project) => project.id).sort()).toEqual([active.id, other.id].sort());
    const trash = (await get('root', '/projects/trash').expect(200)).body as { id: string }[];
    expect(trash.map((project) => project.id)).toEqual([trashed.id]);

    // Nadie más ve el listado global.
    await get('owner', '/projects?scope=all').expect(403);
  });
});
