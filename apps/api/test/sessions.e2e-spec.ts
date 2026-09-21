import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { auditLogs, sessions } from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  sessionSetCookie,
  type TestApp,
} from './support/create-app.js';

describe('gestión de sesiones abiertas (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const loginCookie = async (email: string, keep = false) =>
    sessionCookie(await login(ctx.server, email, undefined, keep).expect(200))!;

  const audit = (action: string) =>
    ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, action));

  interface SessionList {
    sessions: { id: string; current: boolean; persistent: boolean; ip: string | null }[];
  }
  const listSessions = async (cookie: string): Promise<SessionList['sessions']> => {
    const response = await request(ctx.server)
      .get('/api/auth/sessions')
      .set('Cookie', cookie)
      .expect(200);
    return (response.body as SessionList).sessions;
  };

  it('todas las rutas exigen sesión', async () => {
    await request(ctx.server).get('/api/auth/sessions').expect(401);
    await request(ctx.server).delete(`/api/auth/sessions/${randomUUID()}`).expect(401);
    await request(ctx.server).post('/api/auth/sessions/revoke-others').expect(401);
  });

  describe('GET /api/auth/sessions', () => {
    it('lista solo las sesiones vigentes del usuario y marca la actual', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await ctx.createUser({ email: 'otro@example.com' });
      const temporal = await loginCookie('ana@example.com');
      const persistent = await loginCookie('ana@example.com', true);
      await loginCookie('otro@example.com');

      const list = await listSessions(temporal);
      expect(list).toHaveLength(2);
      expect(list.filter((s) => s.current)).toHaveLength(1);
      expect(list.map((s) => s.persistent).sort()).toEqual([false, true]);
      expect(list.every((s) => s.ip)).toBe(true);

      // Desde la otra sesión, la marcada como actual es distinta.
      const fromPersistent = await listSessions(persistent);
      const currentA = list.find((s) => s.current)!.id;
      const currentB = fromPersistent.find((s) => s.current)!.id;
      expect(currentA).not.toBe(currentB);
    });

    it('no muestra las expiradas por inactividad ni las cerradas', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const old = await loginCookie('ana@example.com'); // temporal
      ctx.clock.advanceSeconds(2 * 3600); // la anterior expira por inactividad
      const keep = await loginCookie('ana@example.com', true);
      const closed = await loginCookie('ana@example.com');
      await request(ctx.server).post('/api/auth/logout').set('Cookie', closed).expect(204);

      const list = await listSessions(keep);
      expect(list).toHaveLength(1);
      expect(list[0]!.persistent).toBe(true);
      expect(old).toBeTruthy();
    });
  });

  describe('DELETE /api/auth/sessions/:id', () => {
    it('revoca otra sesión propia sin afectar a la actual, y lo audita', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const current = await loginCookie('ana@example.com');
      const other = await loginCookie('ana@example.com');
      const otherId = (await listSessions(current)).find((s) => !s.current)!.id;

      await request(ctx.server)
        .delete(`/api/auth/sessions/${otherId}`)
        .set('Cookie', current)
        .expect(204);

      await request(ctx.server).get('/api/auth/me').set('Cookie', other).expect(401);
      await request(ctx.server).get('/api/auth/me').set('Cookie', current).expect(200);

      const [row] = await ctx.t.db.select().from(sessions).where(eq(sessions.id, otherId));
      expect(row).toMatchObject({ revokedReason: 'user_revoked' });

      const [entry] = await audit('auth.session.revoked');
      expect(entry).toMatchObject({
        actorUserId: user.id,
        metadata: { revokedSessionId: otherId, current: false },
      });
    });

    it('revocar la sesión actual equivale a cerrar sesión (y borra la cookie)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const current = await loginCookie('ana@example.com');
      const currentId = (await listSessions(current)).find((s) => s.current)!.id;

      const response = await request(ctx.server)
        .delete(`/api/auth/sessions/${currentId}`)
        .set('Cookie', current)
        .expect(204);
      expect(sessionSetCookie(response)).toMatch(/letfer_session=;/);
      await request(ctx.server).get('/api/auth/me').set('Cookie', current).expect(401);
    });

    it('una sesión de otro usuario y una inexistente dan el mismo 404 (no se revela)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const victim = await ctx.createUser({ email: 'victima@example.com' });
      const mine = await loginCookie('ana@example.com');
      const victimCookie = await loginCookie('victima@example.com');
      const victimSessionId = (await listSessions(victimCookie))[0]!.id;

      const foreign = await request(ctx.server)
        .delete(`/api/auth/sessions/${victimSessionId}`)
        .set('Cookie', mine)
        .expect(404);
      const missing = await request(ctx.server)
        .delete(`/api/auth/sessions/${randomUUID()}`)
        .set('Cookie', mine)
        .expect(404);
      expect(foreign.body).toEqual(missing.body);
      expect(bodyOf(foreign).code).toBe('NOT_FOUND');

      // La sesión de la víctima sigue intacta.
      await request(ctx.server).get('/api/auth/me').set('Cookie', victimCookie).expect(200);
      expect(await audit('auth.session.revoked')).toHaveLength(0);
      expect(victim.id).toBeTruthy();
    });

    it('un identificador con formato inválido da 400', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await loginCookie('ana@example.com');
      const response = await request(ctx.server)
        .delete('/api/auth/sessions/no-es-un-uuid')
        .set('Cookie', cookie)
        .expect(400);
      expect(bodyOf(response).code).toBe('VALIDATION_FAILED');
    });

    it('revocar dos veces la misma sesión: la segunda da 404', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const current = await loginCookie('ana@example.com');
      await loginCookie('ana@example.com');
      const otherId = (await listSessions(current)).find((s) => !s.current)!.id;
      await request(ctx.server)
        .delete(`/api/auth/sessions/${otherId}`)
        .set('Cookie', current)
        .expect(204);
      await request(ctx.server)
        .delete(`/api/auth/sessions/${otherId}`)
        .set('Cookie', current)
        .expect(404);
    });
  });

  describe('POST /api/auth/sessions/revoke-others', () => {
    it('cierra todas las demás, conserva la actual y no toca a otros usuarios', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      await ctx.createUser({ email: 'otro@example.com' });
      const current = await loginCookie('ana@example.com');
      const second = await loginCookie('ana@example.com', true);
      const third = await loginCookie('ana@example.com');
      const stranger = await loginCookie('otro@example.com');

      const response = await request(ctx.server)
        .post('/api/auth/sessions/revoke-others')
        .set('Cookie', current)
        .expect(200);
      expect(response.body).toEqual({ revoked: 2 });

      await request(ctx.server).get('/api/auth/me').set('Cookie', second).expect(401);
      await request(ctx.server).get('/api/auth/me').set('Cookie', third).expect(401);
      await request(ctx.server).get('/api/auth/me').set('Cookie', current).expect(200);
      await request(ctx.server).get('/api/auth/me').set('Cookie', stranger).expect(200);

      const [entry] = await audit('auth.sessions.revoked_others');
      expect(entry).toMatchObject({ actorUserId: user.id, metadata: { revoked: 2 } });
    });

    it('sin otras sesiones devuelve 0', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const current = await loginCookie('ana@example.com');
      const response = await request(ctx.server)
        .post('/api/auth/sessions/revoke-others')
        .set('Cookie', current)
        .expect(200);
      expect(response.body).toEqual({ revoked: 0 });
    });
  });
});
