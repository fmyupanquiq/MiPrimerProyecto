import type { AdminUserDetail, AdminUserPage } from '@letfer/shared';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, sessions, users, type UserRow } from '../src/database/schema/index.js';
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

describe('administración de usuarios (e2e, PostgreSQL real, §111.3, §111.4)', () => {
  let ctx: TestApp;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  /** Solo `root` es Administrador Global; `withSecondAdmin` añade `root2`. */
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
  const versionOf = async (user: UserRow) =>
    (await ctx.t.db.select().from(users).where(eq(users.id, user.id)))[0]!.version;
  const statusOf = async (user: UserRow) =>
    (await ctx.t.db.select().from(users).where(eq(users.id, user.id)))[0]!.status;
  /** Deshabilita con la versión vigente; ofrece `.expect(estado)` como supertest. */
  const disable = (actor: Actor, target: UserRow, extra: object = {}) => {
    const pending = (async () =>
      post(actor, `/admin/users/${target.id}/disable`, {
        version: await versionOf(target),
        ...extra,
      }))();
    return Object.assign(pending, {
      expect: async (status: number) => {
        const response = await pending;
        expect(response.status, JSON.stringify(response.body)).toBe(status);
        return response;
      },
    });
  };
  const blockedAudits = () =>
    ctx.t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.user_deactivation.blocked'));

  describe('listar y consultar', () => {
    it('lista con total, paginación y datos útiles para decidir', async () => {
      await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo Norte' });
      const page = (await get('root', '/admin/users?limit=2&offset=0').expect(200))
        .body as AdminUserPage;
      expect(page.total).toBe(4);
      expect(page.items).toHaveLength(2);
      const all = (await get('root', '/admin/users?limit=100').expect(200)).body as AdminUserPage;
      const ownerRow = all.items.find((item) => item.id === people.owner.id)!;
      expect(ownerRow).toMatchObject({
        email: 'owner@example.com',
        status: 'ACTIVE',
        globalRole: 'USER',
        ownedProjectCount: 1,
        hasPendingDeletionRequest: false,
      });
      expect(all.items.find((item) => item.id === people.root.id)!.globalRole).toBe('GLOBAL_ADMIN');
      expect(JSON.stringify(all)).not.toContain('passwordHash');
      expect(JSON.stringify(all)).not.toContain('hash-de-prueba');
    });

    it('filtra por estado y busca por nombre o correo, sin tratar % como comodín', async () => {
      await ctx.t.db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, people.plain.id));
      const byStatus = (await get('root', '/admin/users?status=DISABLED').expect(200))
        .body as AdminUserPage;
      expect(byStatus.items.map((item) => item.id)).toEqual([people.plain.id]);

      const byName = (await get('root', '/admin/users?search=olga').expect(200))
        .body as AdminUserPage;
      expect(byName.items.map((item) => item.id)).toEqual([people.owner.id]);
      const byEmail = (await get('root', '/admin/users?search=member@').expect(200))
        .body as AdminUserPage;
      expect(byEmail.items.map((item) => item.id)).toEqual([people.member.id]);
      const wildcard = (await get('root', '/admin/users?search=%25').expect(200))
        .body as AdminUserPage;
      expect(wildcard.total).toBe(0);
      // Un `%` o `_` literal en el nombre sí se encuentra, y no actúa como comodín.
      await ctx.t.db
        .update(users)
        .set({ firstName: '100%_Cien' })
        .where(eq(users.id, people.member.id));
      const literal = (await get('root', '/admin/users?search=100%25_C').expect(200))
        .body as AdminUserPage;
      expect(literal.items.map((item) => item.id)).toEqual([people.member.id]);
      const notWildcard = (await get('root', '/admin/users?search=1%2500').expect(200))
        .body as AdminUserPage;
      expect(notWildcard.total).toBe(0);
      await get('root', '/admin/users?limit=101').expect(400);
    });

    it('el detalle incluye proyectos propios, sesiones activas y la última solicitud', async () => {
      const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo Sur' });
      await post('owner', '/users/me/deletion-request', { reason: 'Ya no lo uso' }).expect(201);
      const detail = (await get('root', `/admin/users/${people.owner.id}`).expect(200))
        .body as AdminUserDetail;
      expect(detail.ownedProjects).toEqual([
        { id: project.id, name: 'Grupo Sur', status: 'ACTIVE' },
      ]);
      expect(detail.activeSessionCount).toBe(1);
      expect(detail.hasPendingDeletionRequest).toBe(true);
      expect(detail.deletionRequest).toMatchObject({ status: 'PENDING', reason: 'Ya no lo uso' });
    });

    it('un identificador mal formado o inexistente responde 404', async () => {
      await get('root', '/admin/users/no-es-uuid').expect(404);
      await get('root', '/admin/users/0195f7c0-0000-7000-8000-00000000ffff').expect(404);
    });

    it('solo el Administrador Global puede consultar', async () => {
      for (const actor of ['owner', 'member', 'plain'] as const) {
        await get(actor, '/admin/users').expect(403);
        await get(actor, `/admin/users/${people.root.id}`).expect(403);
      }
      await request(ctx.server).get('/api/admin/users').expect(401);
    });
  });

  describe('deshabilitar y reactivar', () => {
    it('deshabilita: cierra sus sesiones, impide el acceso y lo audita', async () => {
      const response = await disable('root', people.plain, { reason: 'Uso indebido' }).expect(200);
      expect((response.body as AdminUserDetail).status).toBe('DISABLED');
      expect(await statusOf(people.plain)).toBe('DISABLED');

      await get('plain', '/auth/me').expect(401); // su sesión ya no vale
      const attempt = await login(ctx.server, people.plain.email);
      expect(attempt.status).toBe(401);
      expect(bodyOf(attempt).code).toBe('INVALID_CREDENTIALS'); // indistinguible de una clave errónea

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'user.status.changed'), eq(auditLogs.entityId, people.plain.id)),
        );
      expect(log).toMatchObject({
        actorUserId: people.root.id,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'DISABLED' },
      });
      expect(log!.metadata).toMatchObject({ reason: 'Uso indebido', revokedSessions: 1 });
    });

    it('reactiva una cuenta deshabilitada; la persona vuelve a poder iniciar sesión', async () => {
      await disable('root', people.plain).expect(200);
      const response = await post('root', `/admin/users/${people.plain.id}/enable`, {
        version: await versionOf(people.plain),
      }).expect(200);
      expect((response.body as AdminUserDetail).status).toBe('ACTIVE');
      await login(ctx.server, people.plain.email).expect(200);
    });

    it('no reactiva una cuenta activa ni una eliminada; no deshabilita una ya deshabilitada', async () => {
      const enableActive = await post('root', `/admin/users/${people.plain.id}/enable`, {
        version: await versionOf(people.plain),
      }).expect(409);
      expect(bodyOf(enableActive).code).toBe('INVALID_STATE');

      await disable('root', people.plain).expect(200);
      await disable('root', people.plain).expect(409);

      await ctx.t.db
        .update(users)
        .set({ status: 'DELETED', deletedAt: new Date() })
        .where(eq(users.id, people.plain.id));
      await post('root', `/admin/users/${people.plain.id}/enable`, {
        version: await versionOf(people.plain),
      }).expect(409);
    });

    it('rechaza una versión desactualizada (concurrencia optimista, §96)', async () => {
      const response = await post('root', `/admin/users/${people.plain.id}/disable`, {
        version: 999,
      }).expect(409);
      expect(bodyOf(response).code).toBe('CONCURRENCY_CONFLICT');
      expect(await statusOf(people.plain)).toBe('ACTIVE');
    });

    it('exige reautenticación reciente', async () => {
      ctx.clock.advanceSeconds(6 * 60);
      const response = await disable('root', people.plain).expect(403);
      expect(bodyOf(response).code).toBe('REAUTH_REQUIRED');
      expect(await statusOf(people.plain)).toBe('ACTIVE');

      await post('root', '/auth/reauth', { password: TEST_PASSWORD }).expect(200);
      await disable('root', people.plain).expect(200);
    });

    it('solo el Administrador Global puede; el resto recibe 403 y no cambia nada', async () => {
      for (const actor of ['owner', 'member', 'plain'] as const) {
        await disable(actor, people.member).expect(403);
        await post(actor, `/admin/users/${people.member.id}/enable`, { version: 1 }).expect(403);
      }
      expect(await statusOf(people.member)).toBe('ACTIVE');
    });

    it('no acepta cuerpos inválidos', async () => {
      await post('root', `/admin/users/${people.plain.id}/disable`, {}).expect(400);
      await post('root', `/admin/users/${people.plain.id}/disable`, {
        version: 1,
        reason: 'x'.repeat(501),
      }).expect(400);
    });
  });

  describe('propietario de proyectos (D8-6)', () => {
    it('no se puede deshabilitar a un propietario: 409 con sus proyectos, y queda auditado', async () => {
      const { project } = await insertProject(ctx.t.db, {
        owner: people.owner,
        name: 'Grupo Norte',
      });
      const response = await disable('root', people.owner).expect(409);
      expect(bodyOf(response).code).toBe('OWNS_PROJECTS');
      expect(response.body).toMatchObject({
        details: { projects: [{ id: project.id, name: 'Grupo Norte' }] },
      });
      expect(await statusOf(people.owner)).toBe('ACTIVE');
      await get('owner', '/auth/me').expect(200); // sigue con sesión

      const [log] = await blockedAudits();
      expect(log).toMatchObject({
        actorUserId: people.root.id,
        entityId: people.owner.id,
        metadata: { attempted: 'disable', reason: 'OWNS_PROJECTS' },
      });
    });

    it('también bloquea si el proyecto está en la papelera', async () => {
      await insertProject(ctx.t.db, {
        owner: people.owner,
        status: 'TRASHED',
        previousStatus: 'ACTIVE',
        deletedAt: new Date('2026-05-01T00:00:00Z'),
        purgeEligibleAt: new Date('2026-07-30T00:00:00Z'),
      });
      const response = await disable('root', people.owner).expect(409);
      expect(bodyOf(response).code).toBe('OWNS_PROJECTS');
    });

    it('tras transferir la propiedad, la cuenta ya se puede deshabilitar', async () => {
      const { project } = await insertProject(ctx.t.db, { owner: people.owner });
      await insertMember(ctx.t.db, {
        projectId: project.id,
        userId: people.member.id,
        roleKey: 'PROJECT_ADMIN',
      });
      await post('root', `/projects/${project.id}/transfer-ownership`, {
        newOwnerId: people.member.id,
      }).expect(200);
      await disable('root', people.owner).expect(200);
      expect(await statusOf(people.owner)).toBe('DISABLED');
    });
  });

  describe('último Administrador Global (D8-10)', () => {
    it('no se puede deshabilitar al único Administrador Global, y el intento queda auditado', async () => {
      const response = await disable('root', people.root).expect(409);
      expect(bodyOf(response).code).toBe('LAST_GLOBAL_ADMIN');
      expect(await statusOf(people.root)).toBe('ACTIVE');
      await get('root', '/auth/me').expect(200);

      const logs = await blockedAudits();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actorUserId: people.root.id,
        entityId: people.root.id,
        metadata: { attempted: 'disable', reason: 'LAST_GLOBAL_ADMIN' },
      });
    });

    it('con otro administrador activo se puede deshabilitar a uno, pero no al que queda', async () => {
      await seed({ withSecondAdmin: true });
      await disable('root', people.root2).expect(200);
      const last = await disable('root', people.root).expect(409);
      expect(bodyOf(last).code).toBe('LAST_GLOBAL_ADMIN');
      expect(await statusOf(people.root)).toBe('ACTIVE');
    });

    it('un administrador ya deshabilitado no cuenta como activo', async () => {
      await seed({ withSecondAdmin: true });
      await ctx.t.db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, people.root2.id));
      const response = await disable('root', people.root).expect(409);
      expect(bodyOf(response).code).toBe('LAST_GLOBAL_ADMIN');
    });

    it('dos administradores que se deshabilitan a la vez: solo uno lo consigue y siempre queda uno', async () => {
      // Se repite varias veces para ejercitar distintos entrelazados de las dos transacciones.
      for (let round = 0; round < 5; round++) {
        await seed({ withSecondAdmin: true });
        const [a, b] = await Promise.all([
          disable('root', people.root2),
          disable('root2', people.root),
        ]);
        const statuses = [a.status, b.status];
        // El perdedor recibe 409 (protección) o 401 (el ganador ya le cerró la sesión).
        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(statuses.filter((status) => status !== 200)[0]).toBeOneOf([401, 409]);

        const admins = await ctx.t.db
          .select()
          .from(users)
          .where(and(eq(users.status, 'ACTIVE'), eq(users.globalRoleId, people.root.globalRoleId)));
        expect(admins).toHaveLength(1);
        // Cada 409 dejó su intento auditado; un 401 nunca llegó a la protección.
        expect(await blockedAudits()).toHaveLength(statuses.filter((s) => s === 409).length);
      }
    });

    it('el disparador de la base de datos también lo impide fuera de la API', async () => {
      const attempt = ctx.t.pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [
        people.root.id,
      ]);
      await expect(attempt).rejects.toMatchObject({
        code: '23001',
        constraint: 'users_last_global_admin',
      });
      const demote = ctx.t.pool.query(
        "UPDATE users SET global_role_id = (SELECT id FROM roles WHERE key = 'USER') WHERE id = $1",
        [people.root.id],
      );
      await expect(demote).rejects.toMatchObject({ constraint: 'users_last_global_admin' });
      const remove = ctx.t.pool.query(
        "UPDATE users SET status = 'DELETED', deleted_at = now() WHERE id = $1",
        [people.root.id],
      );
      await expect(remove).rejects.toMatchObject({ constraint: 'users_last_global_admin' });
      expect(await statusOf(people.root)).toBe('ACTIVE');
    });

    it('el disparador permite lo demás: perfil, último acceso y deshabilitar si hay otro administrador', async () => {
      await seed({ withSecondAdmin: true });
      await ctx.t.pool.query("UPDATE users SET first_name = 'Rosalía' WHERE id = $1", [
        people.root.id,
      ]);
      await ctx.t.pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [
        people.root.id,
      ]);
      await ctx.t.pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [
        people.root2.id,
      ]);
      expect(await statusOf(people.root2)).toBe('DISABLED');
    });

    it('un intento bloqueado no revoca las sesiones ni cambia la versión', async () => {
      const before = await versionOf(people.root);
      await disable('root', people.root).expect(409);
      expect(await versionOf(people.root)).toBe(before);
      const live = await ctx.t.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, people.root.id));
      expect(live.every((session) => session.revokedAt === null)).toBe(true);
    });
  });

  it('cuentas y sesiones ajenas: un miembro de un proyecto no gana acceso a la administración', async () => {
    const { project } = await insertProject(ctx.t.db, { owner: people.owner });
    await insertMember(ctx.t.db, {
      projectId: project.id,
      userId: people.member.id,
      roleKey: 'PROJECT_ADMIN',
    });
    await get('member', '/admin/users').expect(403);
  });
});
