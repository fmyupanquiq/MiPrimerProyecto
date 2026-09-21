import { Controller, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequireRecentAuth } from '../src/auth/recent-auth.guard.js';
import { auditLogs, sessions, users } from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';

/** Ruta de prueba que exige contraseña confirmada recientemente (§39, §104.5). */
@Controller('probe')
class SensitiveProbeController {
  @Post('sensitive')
  @RequireRecentAuth()
  run() {
    return { ok: true };
  }
}

const NEW_PASSWORD = 'nueva-clave-segura-77';

describe('cuenta del usuario (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [SensitiveProbeController] });
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const cookieFor = async (email: string, password = TEST_PASSWORD) =>
    sessionCookie(await login(ctx.server, email, password).expect(200))!;

  const audit = (action: string) =>
    ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, action));

  describe('POST /api/auth/password/change', () => {
    const change = (cookie: string, body: Record<string, unknown>) =>
      request(ctx.server).post('/api/auth/password/change').set('Cookie', cookie).send(body);

    it('cambia la contraseña, cierra las demás sesiones y conserva la actual', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const current = await cookieFor('ana@example.com');
      const other = await cookieFor('ana@example.com');
      const [before] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      ctx.clock.advanceSeconds(120);

      await change(current, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(
        204,
      );

      await request(ctx.server).get('/api/auth/me').set('Cookie', current).expect(200);
      await request(ctx.server).get('/api/auth/me').set('Cookie', other).expect(401);

      const [after] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(after!.passwordHash).not.toBe(before!.passwordHash);
      expect(after!.passwordChangedAt.toISOString()).toBe('2026-06-01T12:02:00.000Z');

      // La contraseña nueva funciona y la antigua ya no.
      await login(ctx.server, 'ana@example.com', NEW_PASSWORD).expect(200);
      await login(ctx.server, 'ana@example.com', TEST_PASSWORD).expect(401);

      const [entry] = await audit('user.password_changed');
      expect(entry).toMatchObject({
        actorUserId: user.id,
        entityId: user.id,
        metadata: { revokedSessions: 1 },
      });
      expect(JSON.stringify(await ctx.t.db.select().from(auditLogs))).not.toContain(NEW_PASSWORD);
    });

    it('rechaza una contraseña actual incorrecta (403) y no cambia nada', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      const response = await change(cookie, {
        currentPassword: 'no-es-esta-clave',
        newPassword: NEW_PASSWORD,
      }).expect(403);

      expect(bodyOf(response).code).toBe('INVALID_CREDENTIALS');
      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.passwordHash).toBe(user.passwordHash);
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(200);
    });

    it('los fallos comparten el contador de bloqueo con el inicio de sesión (§104.3)', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');

      for (let i = 0; i < 5; i++) {
        await change(cookie, { currentPassword: 'mala-' + i, newPassword: NEW_PASSWORD }).expect(
          403,
        );
      }
      const locked = await change(cookie, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(429);
      expect(bodyOf(locked)).toMatchObject({ code: 'ACCOUNT_LOCKED', retryAfterSeconds: 900 });

      // También queda bloqueado el inicio de sesión de ese correo.
      await login(ctx.server, 'ana@example.com').expect(429);

      ctx.clock.advanceSeconds(901);
      await change(cookie, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(
        204,
      );
    });

    it('aplica la política de contraseñas (§104.4)', async () => {
      await ctx.createUser({ email: 'ana.perez@example.com' });
      const cookie = await cookieFor('ana.perez@example.com');

      const short = await change(cookie, {
        currentPassword: TEST_PASSWORD,
        newPassword: 'corta',
      }).expect(400);
      expect(bodyOf(short).code).toBe('VALIDATION_FAILED');
      expect(bodyOf(short).details.map((d) => d.path)).toContain('newPassword');

      const withLocalPart = await change(cookie, {
        currentPassword: TEST_PASSWORD,
        newPassword: 'mi-ana.perez-2026!',
      }).expect(400);
      expect(bodyOf(withLocalPart).details[0]!.message).toMatch(/parte local/);

      // Ninguna de las dos cambió la contraseña.
      await login(ctx.server, 'ana.perez@example.com').expect(200);
    });

    it('exige sesión y origen válido', async () => {
      await request(ctx.server)
        .post('/api/auth/password/change')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);

      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      await request(ctx.server)
        .post('/api/auth/password/change')
        .set('Cookie', cookie)
        .set('Origin', 'https://sitio-malicioso.example')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(403);
    });
  });

  describe('reautenticación (§39, §104.5)', () => {
    const probe = (cookie: string) =>
      request(ctx.server).post('/api/probe/sensitive').set('Cookie', cookie);
    const reauth = (cookie: string, password: string) =>
      request(ctx.server).post('/api/auth/reauth').set('Cookie', cookie).send({ password });

    it('el inicio de sesión cuenta como confirmación; caduca a los 5 minutos', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');

      await probe(cookie).expect(201);
      ctx.clock.advanceSeconds(4 * 60);
      await probe(cookie).expect(201);

      ctx.clock.advanceSeconds(2 * 60);
      const denied = await probe(cookie).expect(403);
      expect(denied.body).toMatchObject({ code: 'REAUTH_REQUIRED' });
    });

    it('confirmar la contraseña reabre la ventana de 5 minutos', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      ctx.clock.advanceSeconds(10 * 60);
      await probe(cookie).expect(403);

      const response = await reauth(cookie, TEST_PASSWORD).expect(200);
      expect((response.body as { reauthenticatedAt: string }).reauthenticatedAt).toBe(
        '2026-06-01T12:10:00.000Z',
      );
      await probe(cookie).expect(201);

      ctx.clock.advanceSeconds(4 * 60);
      await probe(cookie).expect(201);
      ctx.clock.advanceSeconds(2 * 60);
      await probe(cookie).expect(403);
    });

    it('una contraseña incorrecta no reabre la ventana', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      ctx.clock.advanceSeconds(10 * 60);

      const response = await reauth(cookie, 'incorrecta').expect(403);
      expect(bodyOf(response).code).toBe('INVALID_CREDENTIALS');
      await probe(cookie).expect(403);
    });

    it('sin sesión la ruta sensible responde 401 (no 403)', async () => {
      await request(ctx.server).post('/api/probe/sensitive').expect(401);
      await request(ctx.server).post('/api/auth/reauth').send({ password: 'x' }).expect(401);
    });
  });

  describe('PATCH /api/users/me', () => {
    const patch = (cookie: string, body: Record<string, unknown>) =>
      request(ctx.server).patch('/api/users/me').set('Cookie', cookie).send(body);

    it('edita nombre y apellido, incrementa la versión y audita el cambio', async () => {
      const user = await ctx.createUser({
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: 'Ruiz',
      });
      const cookie = await cookieFor('ana@example.com');

      const response = await patch(cookie, { lastName: '  Rojas ', version: 1 }).expect(200);
      expect(response.body).toMatchObject({
        id: user.id,
        firstName: 'Ana',
        lastName: 'Rojas',
        version: 2,
      });
      expect(response.body).not.toHaveProperty('passwordHash');

      const [entry] = await audit('user.profile.updated');
      expect(entry).toMatchObject({
        actorUserId: user.id,
        oldValues: { lastName: 'Ruiz' },
        newValues: { lastName: 'Rojas' },
      });
    });

    it('con una versión obsoleta responde 409 CONCURRENCY_CONFLICT', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      await patch(cookie, { firstName: 'Uno', version: 1 }).expect(200);

      const stale = await patch(cookie, { firstName: 'Dos', version: 1 }).expect(409);
      expect(bodyOf(stale).code).toBe('CONCURRENCY_CONFLICT');
    });

    it('dos ediciones simultáneas con la misma versión: una gana y la otra recibe 409', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      const results = await Promise.all([
        patch(cookie, { firstName: 'A', version: 1 }),
        patch(cookie, { firstName: 'B', version: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('no permite modificar rol, estado, correo ni hash aunque se envíen (sin escalada de privilegios)', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');

      await patch(cookie, {
        firstName: 'Ana',
        version: 1,
        systemRole: 'GLOBAL_ADMIN',
        status: 'DISABLED',
        email: 'otro@example.com',
        passwordHash: 'hackeado',
        id: '00000000-0000-7000-8000-000000000000',
      }).expect(200);

      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row).toMatchObject({
        systemRole: 'USER',
        status: 'ACTIVE',
        email: 'ana@example.com',
        passwordHash: user.passwordHash,
      });
    });

    it('valida los datos', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      for (const body of [
        { version: 1 }, // nada que modificar
        { firstName: '   ', version: 1 },
        { firstName: 'x'.repeat(101), version: 1 },
        { firstName: 'Ana' }, // falta la versión
        { firstName: 'Ana', version: 0 },
      ]) {
        const response = await patch(cookie, body).expect(400);
        expect(bodyOf(response).code).toBe('VALIDATION_FAILED');
      }
    });

    it('exige sesión', async () => {
      await request(ctx.server)
        .patch('/api/users/me')
        .send({ firstName: 'x', version: 1 })
        .expect(401);
    });
  });

  describe('POST /api/users/me/email (§104.9)', () => {
    const changeEmail = (cookie: string, body: Record<string, unknown>) =>
      request(ctx.server).post('/api/users/me/email').set('Cookie', cookie).send(body);

    it('cambia el correo, avisa al anterior y audita el valor anterior y el nuevo', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');

      const response = await changeEmail(cookie, {
        newEmail: 'Ana.Nueva@Example.com',
        password: TEST_PASSWORD,
      }).expect(200);
      expect(response.body).toMatchObject({
        id: user.id,
        email: 'ana.nueva@example.com',
        version: 2,
      });

      // La identidad (id) y la sesión se conservan.
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(200);
      await login(ctx.server, 'ana.nueva@example.com').expect(200);
      await login(ctx.server, 'ana@example.com').expect(401);

      const [entry] = await audit('user.email.changed');
      expect(entry).toMatchObject({
        actorUserId: user.id,
        entityId: user.id,
        oldValues: { email: 'ana@example.com' },
        newValues: { email: 'ana.nueva@example.com' },
      });

      expect(ctx.mail.sent).toHaveLength(1);
      const [mail] = ctx.mail.sent;
      expect(mail!.to).toBe('ana@example.com');
      expect(mail!.subject).toMatch(/correo/i);
      expect(mail!.text).toContain('a***@example.com'); // dirección nueva enmascarada
      expect(mail!.text).not.toContain('ana.nueva@example.com');
      expect(mail!.text).not.toContain(TEST_PASSWORD);
    });

    it('con contraseña incorrecta responde 403 y no cambia ni avisa', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      const response = await changeEmail(cookie, {
        newEmail: 'nueva@example.com',
        password: 'incorrecta',
      }).expect(403);

      expect(bodyOf(response).code).toBe('INVALID_CREDENTIALS');
      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.email).toBe('ana@example.com');
      expect(ctx.mail.sent).toHaveLength(0);
    });

    it('un correo ya registrado (aunque cambie la capitalización) da 409 EMAIL_IN_USE', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await ctx.createUser({ email: 'ocupado@example.com' });
      const cookie = await cookieFor('ana@example.com');

      const response = await changeEmail(cookie, {
        newEmail: 'OCUPADO@example.com',
        password: TEST_PASSWORD,
      }).expect(409);
      expect(bodyOf(response).code).toBe('EMAIL_IN_USE');
      expect(await audit('user.email.changed')).toHaveLength(0);
      expect(ctx.mail.sent).toHaveLength(0);
    });

    it('rechaza el mismo correo y los formatos inválidos', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');

      const same = await changeEmail(cookie, {
        newEmail: ' ANA@example.com ',
        password: TEST_PASSWORD,
      }).expect(400);
      expect(bodyOf(same).details[0]!.path).toBe('newEmail');

      await changeEmail(cookie, { newEmail: 'no-es-correo', password: TEST_PASSWORD }).expect(400);
    });

    it('un fallo del proveedor de correo no revierte el cambio', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieFor('ana@example.com');
      ctx.mail.failing = true;

      await changeEmail(cookie, { newEmail: 'nueva@example.com', password: TEST_PASSWORD }).expect(
        200,
      );
      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.email).toBe('nueva@example.com');
      expect(await audit('user.email.changed')).toHaveLength(1);
    });

    it('exige sesión', async () => {
      await request(ctx.server)
        .post('/api/users/me/email')
        .send({ newEmail: 'x@example.com', password: TEST_PASSWORD })
        .expect(401);
    });
  });

  it('las sesiones y contraseñas se auditan sin exponer secretos', async () => {
    await ctx.createUser({ email: 'ana@example.com' });
    const cookie = await cookieFor('ana@example.com');
    await request(ctx.server)
      .post('/api/auth/password/change')
      .set('Cookie', cookie)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);

    const everything = JSON.stringify(await ctx.t.db.select().from(auditLogs));
    const sessionRows = JSON.stringify(await ctx.t.db.select().from(sessions));
    for (const secret of [TEST_PASSWORD, NEW_PASSWORD, cookie.split('=')[1]!]) {
      expect(everything).not.toContain(secret);
      expect(sessionRows).not.toContain(secret);
    }
  });
});
