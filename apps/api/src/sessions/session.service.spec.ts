import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser } from '../../test/support/factories.js';
import { FakeClock } from '../../test/support/fake-clock.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import { loadConfig } from '../config/app-config.js';
import { sessions, users, type UserRow } from '../database/schema/index.js';
import { hashToken, SessionService } from './session.service.js';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

describe('SessionService (PostgreSQL real, reloj falso)', () => {
  let t: TestDatabase;
  let clock: FakeClock;
  let service: SessionService;
  let user: UserRow;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.pool);
    clock = new FakeClock('2026-06-01T12:00:00.000Z');
    service = new SessionService(
      t.db,
      clock,
      loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }),
    );
    user = await insertUser(t.db);
  });

  /** Simula un usuario activo: cada `interval` segundos valida y renueva la sesión. */
  async function useEvery(token: string, interval: number, until: number): Promise<boolean> {
    for (let elapsed = 0; elapsed < until; elapsed += interval) {
      clock.advanceSeconds(interval);
      const valid = await service.validate(token);
      if (!valid) return false;
      await service.touch(valid.session);
    }
    return true;
  }

  describe('creación', () => {
    it('genera un token de 256 bits y guarda solo su hash SHA-256', async () => {
      const { token, session } = await service.create({ userId: user.id, persistent: false });

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(session.tokenHash).toBe(hashToken(token));

      const stored = JSON.stringify(await t.db.select().from(sessions));
      expect(stored).not.toContain(token);
    });

    it('cada sesión recibe un token distinto', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 5 }, () => service.create({ userId: user.id, persistent: false })),
      );
      expect(new Set(tokens.map((created) => created.token)).size).toBe(5);
    });

    it('sin "Mantener sesión": 1 hora de inactividad y 12 horas como máximo (§104.2)', async () => {
      const { session } = await service.create({ userId: user.id, persistent: false });
      expect(session.persistent).toBe(false);
      expect(session.idleTimeoutSeconds).toBe(HOUR);
      expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(12 * HOUR * 1000);
    });

    it('con "Mantener sesión": 30 días de inactividad y 90 días como máximo (§104.2)', async () => {
      const { session } = await service.create({ userId: user.id, persistent: true });
      expect(session.persistent).toBe(true);
      expect(session.idleTimeoutSeconds).toBe(30 * DAY);
      expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(90 * DAY * 1000);
    });

    it('el inicio de sesión cuenta como confirmación de contraseña', async () => {
      const { session } = await service.create({
        userId: user.id,
        persistent: false,
        ip: '203.0.113.5',
        userAgent: 'UA/1',
      });
      expect(session.reauthenticatedAt).toEqual(session.createdAt);
      expect(session).toMatchObject({ ip: '203.0.113.5', userAgent: 'UA/1' });
    });
  });

  describe('validación', () => {
    it('devuelve la sesión y el usuario con un token válido', async () => {
      const { token, session } = await service.create({ userId: user.id, persistent: false });
      const valid = await service.validate(token);
      expect(valid?.session.id).toBe(session.id);
      expect(valid?.user.id).toBe(user.id);
    });

    it('rechaza tokens desconocidos, alterados o vacíos', async () => {
      const { token } = await service.create({ userId: user.id, persistent: false });
      expect(await service.validate('')).toBeNull();
      expect(await service.validate('token-inventado')).toBeNull();
      expect(await service.validate(`${token}x`)).toBeNull();
      expect(await service.validate(token.slice(0, -1))).toBeNull();
      // El propio hash almacenado no sirve como token.
      expect(await service.validate(hashToken(token))).toBeNull();
    });

    it('temporal: expira tras 1 hora sin actividad', async () => {
      const { token } = await service.create({ userId: user.id, persistent: false });
      clock.advanceSeconds(59 * MINUTE);
      expect(await service.validate(token)).not.toBeNull();
      clock.advanceSeconds(2 * MINUTE);
      expect(await service.validate(token)).toBeNull();
    });

    it('temporal: usar la sesión renueva la ventana de inactividad (deslizante)', async () => {
      const { token } = await service.create({ userId: user.id, persistent: false });
      // Actividad cada 30 minutos durante 5 horas: sigue viva.
      expect(await useEvery(token, 30 * MINUTE, 5 * HOUR)).toBe(true);
    });

    it('temporal: termina a las 12 horas aunque siga activa (tope absoluto)', async () => {
      const { token } = await service.create({ userId: user.id, persistent: false });
      expect(await useEvery(token, 30 * MINUTE, 11 * HOUR)).toBe(true);
      // Pasadas las 12 horas desde el inicio, deja de valer pese a la actividad.
      expect(await useEvery(token, 30 * MINUTE, 2 * HOUR)).toBe(false);
    });

    it('persistente: sigue válida a los 29 días sin uso y expira a los 31', async () => {
      const { token } = await service.create({ userId: user.id, persistent: true });
      clock.advanceSeconds(29 * DAY);
      expect(await service.validate(token)).not.toBeNull();
      clock.advanceSeconds(2 * DAY);
      expect(await service.validate(token)).toBeNull();
    });

    it('persistente: se renueva con el uso pero termina a los 90 días (tope absoluto)', async () => {
      const { token } = await service.create({ userId: user.id, persistent: true });
      // Uso cada 20 días: la inactividad nunca llega a 30 días.
      expect(await useEvery(token, 20 * DAY, 80 * DAY)).toBe(true);
      expect(await useEvery(token, 20 * DAY, 20 * DAY)).toBe(false);
    });

    it('rechaza la sesión si la cuenta no está ACTIVE', async () => {
      const { token } = await service.create({ userId: user.id, persistent: false });
      await t.pool.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [user.id]);
      expect(await service.validate(token)).toBeNull();
      await t.db.update(users).set({ status: 'ACTIVE' }).where(eq(users.id, user.id));
      expect(await service.validate(token)).not.toBeNull();
    });
  });

  describe('touch', () => {
    it('no escribe si no pasó el intervalo mínimo (evita una escritura por petición)', async () => {
      const { session } = await service.create({ userId: user.id, persistent: false });
      clock.advanceSeconds(30);
      const same = await service.touch(session);
      expect(same.lastSeenAt).toEqual(session.lastSeenAt);
    });

    it('actualiza el último uso una vez superado el intervalo', async () => {
      const { session } = await service.create({ userId: user.id, persistent: false });
      clock.advanceSeconds(61);
      const touched = await service.touch(session);
      expect(touched.lastSeenAt.toISOString()).toBe('2026-06-01T12:01:01.000Z');
    });

    it('no revive una sesión revocada', async () => {
      const { session } = await service.create({ userId: user.id, persistent: false });
      await service.revoke(session.id, 'test');
      clock.advanceSeconds(120);
      const touched = await service.touch(session);
      expect(touched.lastSeenAt).toEqual(session.lastSeenAt);
    });
  });

  describe('revocación y listado', () => {
    it('revocar invalida la sesión y registra el motivo', async () => {
      const { token, session } = await service.create({ userId: user.id, persistent: true });
      expect(await service.revoke(session.id, 'logout')).toBe(true);
      expect(await service.validate(token)).toBeNull();
      expect(await service.revoke(session.id, 'logout')).toBe(false);

      const [row] = await t.db.select().from(sessions).where(eq(sessions.id, session.id));
      expect(row).toMatchObject({ revokedReason: 'logout' });
      expect(row!.revokedAt).toBeInstanceOf(Date);
    });

    it('con userId solo revoca sesiones de ese usuario', async () => {
      const other = await insertUser(t.db);
      const { session } = await service.create({ userId: other.id, persistent: false });
      expect(await service.revoke(session.id, 'x', { userId: user.id })).toBe(false);
      expect(await service.revoke(session.id, 'x', { userId: other.id })).toBe(true);
    });

    it('revokeAllForUser cierra todas menos la indicada y no toca a otros usuarios', async () => {
      const other = await insertUser(t.db);
      const a = await service.create({ userId: user.id, persistent: false });
      const b = await service.create({ userId: user.id, persistent: true });
      const c = await service.create({ userId: other.id, persistent: false });

      const revoked = await service.revokeAllForUser(user.id, 'password_changed', {
        exceptSessionId: a.session.id,
      });
      expect(revoked).toBe(1);
      expect(await service.validate(a.token)).not.toBeNull();
      expect(await service.validate(b.token)).toBeNull();
      expect(await service.validate(c.token)).not.toBeNull();

      expect(await service.revokeAllForUser(user.id, 'password_changed')).toBe(1);
      expect(await service.validate(a.token)).toBeNull();
    });

    it('listActive muestra solo sesiones vigentes, la más reciente primero', async () => {
      const first = await service.create({ userId: user.id, persistent: false });
      clock.advanceSeconds(10 * MINUTE);
      const second = await service.create({ userId: user.id, persistent: true });
      const revoked = await service.create({ userId: user.id, persistent: true });
      await service.revoke(revoked.session.id, 'logout');

      expect((await service.listActive(user.id)).map((s) => s.id)).toEqual([
        second.session.id,
        first.session.id,
      ]);

      // La temporal expira por inactividad; la persistente sigue.
      clock.advanceSeconds(HOUR);
      expect((await service.listActive(user.id)).map((s) => s.id)).toEqual([second.session.id]);
    });

    it('markReauthenticated actualiza la última confirmación de contraseña', async () => {
      const { session } = await service.create({ userId: user.id, persistent: false });
      clock.advanceSeconds(10 * MINUTE);
      const updated = await service.markReauthenticated(session.id);
      expect(updated.reauthenticatedAt.toISOString()).toBe('2026-06-01T12:10:00.000Z');
    });
  });
});
