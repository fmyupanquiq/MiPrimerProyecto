import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, sessions, users } from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  sessionSetCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';

describe('autenticación (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const audit = (action: string) =>
    ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, action));

  describe('POST /api/auth/login', () => {
    it('inicia sesión: devuelve usuario y sesión, y entrega la cookie HttpOnly sin token en el cuerpo', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const response = await login(ctx.server, 'Ana@Example.com').expect(200);

      expect(bodyOf(response).user).toMatchObject({
        id: user.id,
        email: 'ana@example.com',
        status: 'ACTIVE',
        systemRole: 'USER',
      });
      expect(bodyOf(response).user).not.toHaveProperty('passwordHash');
      expect(bodyOf(response).session).toMatchObject({ persistent: false, current: true });
      expect(response.headers['cache-control']).toBe('no-store');

      const setCookie = sessionSetCookie(response)!;
      expect(setCookie).toMatch(/^letfer_session=[A-Za-z0-9_-]{43};/);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).not.toContain('Max-Age'); // cookie de sesión del navegador
      expect(setCookie).not.toContain('Secure'); // solo en producción (HTTPS)

      const token = setCookie.split(';')[0]!.split('=')[1]!;
      expect(JSON.stringify(response.body)).not.toContain(token);
    });

    it('con "Mantener sesión iniciada" la cookie es persistente (90 días como máximo)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const response = await login(ctx.server, 'ana@example.com', TEST_PASSWORD, true).expect(200);

      expect(bodyOf(response).session.persistent).toBe(true);
      expect(sessionSetCookie(response)).toContain(`Max-Age=${90 * 86400}`);
    });

    it('registra el último acceso, la sesión y la auditoría con IP y agente', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      ctx.clock.set('2026-06-02T09:30:00.000Z');
      await request(ctx.server)
        .post('/api/auth/login')
        .set('User-Agent', 'UA-de-prueba/1.0')
        .send({ email: 'ana@example.com', password: TEST_PASSWORD, keepSignedIn: false })
        .expect(200);

      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.lastLoginAt?.toISOString()).toBe('2026-06-02T09:30:00.000Z');

      const [session] = await ctx.t.db.select().from(sessions);
      expect(session).toMatchObject({ userId: user.id, userAgent: 'UA-de-prueba/1.0' });
      expect(session!.ip).toBeTruthy();

      const [entry] = await audit('auth.login.succeeded');
      expect(entry).toMatchObject({
        actorUserId: user.id,
        entityId: user.id,
        sessionId: session!.id,
        userAgent: 'UA-de-prueba/1.0',
        metadata: { persistent: false },
      });
      expect(entry!.ip).toBeTruthy();
      expect(JSON.stringify(entry)).not.toContain(TEST_PASSWORD);
    });

    it('endurece el hash con los parámetros vigentes si el almacenado era más débil', async () => {
      const weakHasher = new (ctx.hasher.constructor as new (config: unknown) => typeof ctx.hasher)(
        {
          argon2: { memoryKib: 512, passes: 1, parallelism: 1 },
        },
      );
      const weak = await weakHasher.hash(TEST_PASSWORD);
      const user = await ctx.createUser({ email: 'ana@example.com', passwordHash: weak });

      await login(ctx.server, 'ana@example.com').expect(200);

      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.passwordHash).not.toBe(weak);
      expect(row!.passwordHash).toContain('m=1024,t=1,p=1');
      await expect(ctx.hasher.verify(TEST_PASSWORD, row!.passwordHash)).resolves.toBe(true);
    });

    it('rechaza cuerpos inválidos con VALIDATION_FAILED', async () => {
      const bad = await request(ctx.server)
        .post('/api/auth/login')
        .send({ email: 'x' })
        .expect(400);
      expect(bodyOf(bad).code).toBe('VALIDATION_FAILED');
      const paths = bodyOf(bad)
        .details.map((d) => d.path)
        .sort();
      expect(paths).toEqual(['email', 'password']);

      const huge = await request(ctx.server)
        .post('/api/auth/login')
        .send({ email: 'a@example.com', password: 'x'.repeat(2000) })
        .expect(400);
      expect(bodyOf(huge).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('respuestas uniformes ante credenciales inválidas (§104.3)', () => {
    it('correo inexistente, contraseña incorrecta y cuentas no activas dan exactamente la misma respuesta', async () => {
      await ctx.createUser({ email: 'activa@example.com' });
      await ctx.createUser({ email: 'deshabilitada@example.com', status: 'DISABLED' });
      await ctx.createUser({
        email: 'eliminada@example.com',
        status: 'DELETED',
        deletedAt: new Date('2026-05-01T00:00:00Z'),
      });

      const responses = await Promise.all([
        login(ctx.server, 'activa@example.com', 'contraseña-incorrecta'),
        login(ctx.server, 'no-existe@example.com'),
        login(ctx.server, 'deshabilitada@example.com'),
        login(ctx.server, 'eliminada@example.com'),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual(responses[0].body);
        expect(sessionCookie(response)).toBeUndefined();
      }
      expect(responses[0].body).toEqual({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Correo o contraseña incorrectos.',
      });
    });
  });

  describe('bloqueo temporal por intentos fallidos (§104.3)', () => {
    it('5 fallos bloquean 15 minutos; al cumplirse se puede entrar de nuevo', async () => {
      await ctx.createUser({ email: 'ana@example.com' });

      for (let i = 0; i < 5; i++) {
        await login(ctx.server, 'ana@example.com', 'incorrecta-numero-' + i).expect(401);
      }

      // Bloqueada: incluso la contraseña correcta se rechaza y se informa cuánto esperar.
      const locked = await login(ctx.server, 'ana@example.com').expect(429);
      expect(locked.body).toMatchObject({
        statusCode: 429,
        code: 'ACCOUNT_LOCKED',
        retryAfterSeconds: 900,
      });
      expect(locked.headers['retry-after']).toBe('900');
      expect(sessionCookie(locked)).toBeUndefined();

      // Los intentos durante el bloqueo no lo prolongan.
      ctx.clock.advanceSeconds(600);
      const still = await login(ctx.server, 'ana@example.com').expect(429);
      expect(bodyOf(still).retryAfterSeconds).toBe(300);

      ctx.clock.advanceSeconds(301);
      await login(ctx.server, 'ana@example.com').expect(200);
    });

    it('el bloqueo se audita una sola vez, al activarse', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 7; i++) await login(ctx.server, 'ana@example.com', 'mala-clave-' + i);

      const entries = await audit('auth.account_locked');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        entityId: user.id,
        actorUserId: null,
        metadata: { failures: 5, retryAfterSeconds: 900 },
      });
    });

    it('un correo inexistente se bloquea igual (no revela si la cuenta existe)', async () => {
      const responses = [];
      for (let i = 0; i < 6; i++)
        responses.push(await login(ctx.server, 'fantasma@example.com', 'x-' + i));

      expect(responses.slice(0, 5).every((r) => r.status === 401)).toBe(true);
      expect(responses[5]!.status).toBe(429);
      expect(responses[5]!.body).toMatchObject({ code: 'ACCOUNT_LOCKED', retryAfterSeconds: 900 });

      const [entry] = await audit('auth.account_locked');
      expect(entry).toMatchObject({ entityId: null, actorUserId: null });
    });

    it('un acceso correcto reinicia el conteo de fallos', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 4; i++)
        await login(ctx.server, 'ana@example.com', 'mala-' + i).expect(401);
      await login(ctx.server, 'ana@example.com').expect(200);
      // Otros 4 fallos no bloquean: el conteo empezó de cero tras el acceso correcto.
      for (let i = 0; i < 4; i++)
        await login(ctx.server, 'ana@example.com', 'mala-' + i).expect(401);
      await login(ctx.server, 'ana@example.com').expect(200);
    });

    it('los fallos fuera de la ventana de 15 minutos no cuentan', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 4; i++)
        await login(ctx.server, 'ana@example.com', 'mala-' + i).expect(401);
      ctx.clock.advanceSeconds(16 * 60);
      for (let i = 0; i < 4; i++)
        await login(ctx.server, 'ana@example.com', 'mala-' + i).expect(401);
      await login(ctx.server, 'ana@example.com').expect(200);
    });

    it('con intentos simultáneos el conteo es exacto (máximo 5 fallos registrados)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) => login(ctx.server, 'ana@example.com', 'mala-' + i)),
      );
      expect(responses.filter((r) => r.status === 401)).toHaveLength(5);
      expect(responses.filter((r) => r.status === 429)).toHaveLength(5);
    });
  });

  describe('GET /api/auth/me y denegar por defecto (§39)', () => {
    it('sin sesión responde 401 UNAUTHENTICATED', async () => {
      const response = await request(ctx.server).get('/api/auth/me').expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
    });

    it('con la cookie devuelve el usuario y la sesión actual', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;

      const me = await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(bodyOf(me).user.id).toBe(user.id);
      expect(bodyOf(me).session.current).toBe(true);
      expect(me.headers['cache-control']).toBe('no-store');
    });

    it('acepta el token también como Authorization: Bearer (futura app móvil)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;
      const token = cookie.split('=')[1]!;

      await request(ctx.server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(ctx.server)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer inventado')
        .expect(401);
      await request(ctx.server).get('/api/auth/me').set('Authorization', 'Basic abc').expect(401);
    });

    it('rechaza cookies inventadas o alteradas', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;
      await request(ctx.server)
        .get('/api/auth/me')
        .set('Cookie', 'letfer_session=inventada')
        .expect(401);
      await request(ctx.server)
        .get('/api/auth/me')
        .set('Cookie', cookie + 'x')
        .expect(401);
    });

    it('los endpoints públicos (health) no exigen sesión', async () => {
      await request(ctx.server).get('/api/health').expect(200);
    });

    it('la sesión temporal expira por inactividad y se renueva con el uso', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;
      const me = () => request(ctx.server).get('/api/auth/me').set('Cookie', cookie);

      // Uso cada 40 minutos: nunca hay 1 hora de inactividad.
      for (let i = 0; i < 3; i++) {
        ctx.clock.advanceSeconds(40 * 60);
        await me().expect(200);
      }
      ctx.clock.advanceSeconds(61 * 60);
      await me().expect(401);
    });

    it('una cuenta deshabilitada pierde su sesión al instante', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(200);

      await ctx.t.db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, user.id));
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revoca la sesión, borra la cookie y lo audita', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;

      const response = await request(ctx.server)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);
      expect(sessionSetCookie(response)).toMatch(
        /letfer_session=;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/,
      );

      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(401);

      const [session] = await ctx.t.db.select().from(sessions);
      expect(session).toMatchObject({ revokedReason: 'logout' });
      expect(session!.revokedAt).toBeInstanceOf(Date);

      const [entry] = await audit('auth.logout');
      expect(entry).toMatchObject({
        actorUserId: user.id,
        entityId: user.id,
        sessionId: session!.id,
      });
    });

    it('sin sesión responde 401', async () => {
      await request(ctx.server).post('/api/auth/logout').expect(401);
    });

    it('cerrar una sesión no afecta a las otras del mismo usuario', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const first = sessionCookie(await login(ctx.server, 'ana@example.com'))!;
      const second = sessionCookie(await login(ctx.server, 'ana@example.com'))!;

      await request(ctx.server).post('/api/auth/logout').set('Cookie', first).expect(204);
      await request(ctx.server).get('/api/auth/me').set('Cookie', first).expect(401);
      await request(ctx.server).get('/api/auth/me').set('Cookie', second).expect(200);
    });
  });

  describe('protección CSRF: validación del origen (§39, §41)', () => {
    afterEach(() => undefined);

    it('rechaza peticiones que modifican datos desde otro origen', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const response = await request(ctx.server)
        .post('/api/auth/login')
        .set('Origin', 'https://sitio-malicioso.example')
        .send({ email: 'ana@example.com', password: TEST_PASSWORD })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
    });

    it('acepta el origen configurado de la web', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await request(ctx.server)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'ana@example.com', password: TEST_PASSWORD })
        .expect(200);
    });

    it('sin Origin usa Sec-Fetch-Site: same-origin y none se permiten, cross-site no', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const attempt = (site: string) =>
        request(ctx.server)
          .post('/api/auth/login')
          .set('Sec-Fetch-Site', site)
          .send({ email: 'ana@example.com', password: TEST_PASSWORD });

      await attempt('same-origin').expect(200);
      await attempt('none').expect(200);
      await attempt('cross-site').expect(403);
      await attempt('same-site').expect(403);
    });

    it('un logout con cookie desde otro origen no cierra la sesión', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;

      await request(ctx.server)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', 'https://sitio-malicioso.example')
        .expect(403);
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(200);
    });

    it('las peticiones seguras (GET) no se restringen por origen', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com'))!;
      await request(ctx.server)
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .set('Origin', 'https://otro.example')
        .expect(200);
    });

    it('con Authorization: Bearer no se aplica (no usa cookies)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const token = sessionCookie(await login(ctx.server, 'ana@example.com'))!.split('=')[1]!;
      await request(ctx.server)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Origin', 'https://app-movil.example')
        .expect(204);
    });
  });

  it('las sesiones se listan ordenadas por uso reciente (consulta directa)', async () => {
    const user = await ctx.createUser({ email: 'ana@example.com' });
    await login(ctx.server, 'ana@example.com');
    ctx.clock.advanceSeconds(120);
    await login(ctx.server, 'ana@example.com');
    const rows = await ctx.t.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.lastSeenAt));
    expect(rows).toHaveLength(2);
  });
});
