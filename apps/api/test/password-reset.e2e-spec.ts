import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, passwordResetTokens, sessions, users } from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';

const NEW_PASSWORD = 'clave-restablecida-88';

describe('recuperación de contraseña (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const forgot = (email: string) =>
    request(ctx.server).post('/api/auth/password/forgot').send({ email });
  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    request(ctx.server).post('/api/auth/password/reset').send({ token, newPassword });
  const audit = (action: string) =>
    ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, action));

  /** Extrae el token del enlace del último correo enviado. */
  const tokenFromLastMail = (): string => {
    const mail = ctx.mail.sent.at(-1)!;
    const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.text);
    expect(match).not.toBeNull();
    return match![1]!;
  };

  describe('POST /api/auth/password/forgot', () => {
    it('envía el enlace al correo del usuario y guarda solo el hash del token', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const response = await forgot('Ana@Example.com').expect(202);
      expect(response.body).toEqual({ accepted: true });

      expect(ctx.mail.sent).toHaveLength(1);
      const [mail] = ctx.mail.sent;
      expect(mail!.to).toBe('ana@example.com');
      expect(mail!.text).toContain('http://localhost:5173/reset-password?token=');
      expect(mail!.text).toContain('60 minutos');
      const token = tokenFromLastMail();
      expect(token).toHaveLength(43);

      const [row] = await ctx.t.db.select().from(passwordResetTokens);
      expect(row).toMatchObject({ userId: user.id, usedAt: null, invalidatedAt: null });
      expect(row!.tokenHash).not.toBe(token);
      expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(3600 * 1000);

      // El token en claro no está en ningún sitio de la base de datos.
      const everything = JSON.stringify([
        await ctx.t.db.select().from(passwordResetTokens),
        await ctx.t.db.select().from(auditLogs),
        await ctx.t.db.select().from(sessions),
      ]);
      expect(everything).not.toContain(token);

      const [entry] = await audit('auth.password_reset.requested');
      expect(entry).toMatchObject({ actorUserId: null, entityId: user.id });
    });

    it('responde exactamente igual para un correo inexistente y para cuentas no activas (§104.4)', async () => {
      await ctx.createUser({ email: 'activa@example.com' });
      await ctx.createUser({ email: 'deshabilitada@example.com', status: 'DISABLED' });

      const responses = [
        await forgot('activa@example.com'),
        await forgot('no-existe@example.com'),
        await forgot('deshabilitada@example.com'),
      ];
      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(response.body).toEqual({ accepted: true });
      }
      // Solo la cuenta activa recibió un correo.
      expect(ctx.mail.sent.map((m) => m.to)).toEqual(['activa@example.com']);
      expect(await ctx.t.db.select().from(passwordResetTokens)).toHaveLength(1);
    });

    it('rechaza un correo con formato inválido (400)', async () => {
      const response = await forgot('no-es-correo').expect(400);
      expect(bodyOf(response).code).toBe('VALIDATION_FAILED');
    });

    it('un enlace nuevo invalida los anteriores', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await forgot('ana@example.com').expect(202);
      const first = tokenFromLastMail();
      await forgot('ana@example.com').expect(202);
      const second = tokenFromLastMail();
      expect(second).not.toBe(first);

      const stale = await reset(first).expect(400);
      expect(bodyOf(stale).code).toBe('INVALID_TOKEN');
      await reset(second).expect(204);
    });

    it('limita a 3 solicitudes por hora por usuario (sin revelarlo) y luego se libera', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 5; i++) await forgot('ana@example.com').expect(202);
      expect(ctx.mail.sent).toHaveLength(3);

      ctx.clock.advanceSeconds(3601);
      await forgot('ana@example.com').expect(202);
      expect(ctx.mail.sent).toHaveLength(4);
    });

    it('con solicitudes simultáneas solo queda un enlace vigente', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await Promise.all([
        forgot('ana@example.com'),
        forgot('ana@example.com'),
        forgot('ana@example.com'),
      ]);

      const rows = await ctx.t.db.select().from(passwordResetTokens);
      expect(rows.filter((row) => row.invalidatedAt === null && row.usedAt === null)).toHaveLength(
        1,
      );
    });

    it('un fallo del proveedor de correo no cambia la respuesta', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      ctx.mail.failing = true;
      const response = await forgot('ana@example.com').expect(202);
      expect(response.body).toEqual({ accepted: true });
    });
  });

  describe('POST /api/auth/password/reset', () => {
    it('restablece la contraseña, cierra todas las sesiones y lo audita', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = sessionCookie(await login(ctx.server, 'ana@example.com').expect(200))!;
      const other = sessionCookie(await login(ctx.server, 'ana@example.com').expect(200))!;
      ctx.clock.advanceSeconds(300);

      await forgot('ana@example.com');
      await reset(tokenFromLastMail()).expect(204);

      // Todas las sesiones previas quedan cerradas (§104.4).
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(401);
      await request(ctx.server).get('/api/auth/me').set('Cookie', other).expect(401);

      // La contraseña nueva funciona y la anterior no.
      await login(ctx.server, 'ana@example.com', NEW_PASSWORD).expect(200);
      await login(ctx.server, 'ana@example.com', TEST_PASSWORD).expect(401);

      const [row] = await ctx.t.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.passwordChangedAt.toISOString()).toBe('2026-06-01T12:05:00.000Z');

      const [entry] = await audit('auth.password_reset.completed');
      expect(entry).toMatchObject({
        entityId: user.id,
        actorUserId: null,
        metadata: { revokedSessions: 2 },
      });
      expect(JSON.stringify(await ctx.t.db.select().from(auditLogs))).not.toContain(NEW_PASSWORD);
    });

    it('el token es de un solo uso', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await forgot('ana@example.com');
      const token = tokenFromLastMail();

      await reset(token).expect(204);
      const again = await reset(token, 'otra-clave-distinta-99').expect(400);
      expect(bodyOf(again).code).toBe('INVALID_TOKEN');
      await login(ctx.server, 'ana@example.com', NEW_PASSWORD).expect(200);
    });

    it('con dos usos simultáneos del mismo token solo uno prospera', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await forgot('ana@example.com');
      const token = tokenFromLastMail();

      const results = await Promise.all([
        reset(token, 'clave-uno-restablecida-1'),
        reset(token, 'clave-dos-restablecida-2'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
    });

    it('caduca a la hora: válido a los 59 minutos, inválido a los 61', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      await forgot('ana@example.com');
      const token = tokenFromLastMail();

      ctx.clock.advanceSeconds(61 * 60);
      const expired = await reset(token).expect(400);
      expect(bodyOf(expired).code).toBe('INVALID_TOKEN');

      await forgot('ana@example.com'); // (3.ª solicitud de la hora: sigue dentro del límite)
      const fresh = tokenFromLastMail();
      ctx.clock.advanceSeconds(59 * 60);
      await reset(fresh).expect(204);
    });

    it('rechaza tokens inventados o mal formados', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      const unknown = await reset('a'.repeat(43)).expect(400);
      expect(bodyOf(unknown).code).toBe('INVALID_TOKEN');
      const short = await reset('corto').expect(400);
      expect(bodyOf(short).code).toBe('VALIDATION_FAILED');
    });

    it('con una contraseña que incumple la política NO consume el token (se puede reintentar)', async () => {
      await ctx.createUser({ email: 'ana.perez@example.com' });
      await forgot('ana.perez@example.com');
      const token = tokenFromLastMail();

      const weak = await reset(token, 'corta').expect(400);
      expect(bodyOf(weak).code).toBe('VALIDATION_FAILED');
      const localPart = await reset(token, 'mi-ana.perez-2026!').expect(400);
      expect(bodyOf(localPart).details[0]!.message).toMatch(/parte local/);

      const [row] = await ctx.t.db.select().from(passwordResetTokens);
      expect(row!.usedAt).toBeNull();
      await reset(token, NEW_PASSWORD).expect(204);
    });

    it('un enlace de una cuenta deshabilitada después de pedirlo ya no sirve', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      await forgot('ana@example.com');
      const token = tokenFromLastMail();
      await ctx.t.db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, user.id));

      const response = await reset(token).expect(400);
      expect(bodyOf(response).code).toBe('INVALID_TOKEN');
    });

    it('recuperar la contraseña levanta el bloqueo por intentos fallidos', async () => {
      await ctx.createUser({ email: 'ana@example.com' });
      for (let i = 0; i < 5; i++)
        await login(ctx.server, 'ana@example.com', 'mala-' + i).expect(401);
      await login(ctx.server, 'ana@example.com').expect(429);

      await forgot('ana@example.com');
      await reset(tokenFromLastMail()).expect(204);

      // Sin esperar los 15 minutos del bloqueo.
      await login(ctx.server, 'ana@example.com', NEW_PASSWORD).expect(200);
    });

    it('no permite usar el enlace de un usuario para cambiar la contraseña de otro', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const bea = await ctx.createUser({ email: 'bea@example.com' });
      await forgot('ana@example.com');
      await reset(tokenFromLastMail()).expect(204);

      const [anaRow] = await ctx.t.db.select().from(users).where(eq(users.id, ana.id));
      const [beaRow] = await ctx.t.db.select().from(users).where(eq(users.id, bea.id));
      expect(anaRow!.passwordHash).not.toBe(ana.passwordHash);
      expect(beaRow!.passwordHash).toBe(bea.passwordHash);
    });
  });
});
