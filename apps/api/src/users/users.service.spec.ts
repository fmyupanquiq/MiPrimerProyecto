import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../test/support/fake-clock.js';
import { insertUser } from '../../test/support/factories.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { ConcurrencyConflictError } from '../database/concurrency.js';
import {
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from '../database/pg-errors.js';
import { roleKeyById } from '../database/role-lookup.js';
import { auditLogs, users } from '../database/schema/index.js';
import { SessionService } from '../sessions/session.service.js';
import { loadConfig } from '../config/app-config.js';
import { toPublicUser, UsersService } from './users.service.js';

describe('UsersService (PostgreSQL real)', () => {
  let t: TestDatabase;
  let clock: FakeClock;
  let service: UsersService;
  let sessionService: SessionService;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.pool);
    clock = new FakeClock('2026-06-01T12:00:00.000Z');
    sessionService = new SessionService(
      t.db,
      clock,
      loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }),
    );
    service = new UsersService(t.db, clock, new AuditService(clock), sessionService);
  });

  const newUser = (email = 'Ana.Perez@Example.com') => ({
    firstName: ' Ana ',
    lastName: 'Pérez',
    email,
    passwordHash: '$argon2id$hash-de-prueba',
  });

  describe('creación y búsqueda', () => {
    it('crea el usuario con los valores por defecto del §2 y §104', async () => {
      const user = await service.create(newUser());

      expect(user).toMatchObject({
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana.perez@example.com',
        status: 'ACTIVE',
        version: 1,
        avatarRef: null,
        lastLoginAt: null,
        deletedAt: null,
      });
      expect(await roleKeyById(t.db, user.globalRoleId)).toBe('USER');
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.passwordChangedAt).toBeInstanceOf(Date);
    });

    it('busca por correo sin distinguir mayúsculas ni espacios', async () => {
      const created = await service.create(newUser());
      expect((await service.findByEmail('  ANA.PEREZ@example.COM '))?.id).toBe(created.id);
      expect(await service.findByEmail('otra@example.com')).toBeNull();
      expect((await service.findById(created.id))?.email).toBe('ana.perez@example.com');
      expect(await service.findById(randomUUID())).toBeNull();
    });

    it('rechaza un correo repetido aunque cambie la capitalización (409 EMAIL_IN_USE)', async () => {
      await service.create(newUser('ana@example.com'));
      const attempt = service.create(newUser('ANA@Example.com'));
      await expect(attempt).rejects.toSatisfy(
        (error) => error instanceof AppError && error.getStatus() === 409,
      );
      await expect(attempt).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
    });

    it('con dos altas simultáneas del mismo correo solo una prospera', async () => {
      const results = await Promise.allSettled([
        service.create(newUser('carrera@example.com')),
        service.create(newUser('CARRERA@example.com')),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'EMAIL_IN_USE' });
    });

    it('toPublicUser nunca expone el hash de contraseña', async () => {
      const user = await service.create(newUser());
      const publicUser = toPublicUser(user, 'USER');
      expect(JSON.stringify(publicUser)).not.toContain('argon2id');
      expect(publicUser).not.toHaveProperty('passwordHash');
      expect(publicUser).toMatchObject({ email: 'ana.perez@example.com', version: 1 });
    });
  });

  describe('restricciones de la base de datos (última barrera, §58)', () => {
    it('el índice único impide correos repetidos también con SQL directo', async () => {
      await insertUser(t.db, { email: 'dup@example.com' });
      await expect(insertUser(t.db, { email: 'DUP@example.com' })).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_UNIQUE_VIOLATION,
      );
    });

    it('rechaza un estado DELETED sin deleted_at y viceversa', async () => {
      const user = await insertUser(t.db);
      await expect(
        t.pool.query(`UPDATE users SET status = 'DELETED' WHERE id = $1`, [user.id]),
      ).rejects.toSatisfy((error) => pgErrorCode(error) === PG_CHECK_VIOLATION);
      await expect(
        t.pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [user.id]),
      ).rejects.toSatisfy((error) => pgErrorCode(error) === PG_CHECK_VIOLATION);
    });

    it('rechaza nombres en blanco y correos con espacios', async () => {
      await expect(insertUser(t.db, { firstName: '   ' })).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_CHECK_VIOLATION,
      );
      await expect(insertUser(t.db, { email: ' con-espacios@example.com' })).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_CHECK_VIOLATION,
      );
    });

    it('impide eliminar físicamente a un usuario', async () => {
      const user = await insertUser(t.db);
      await expect(t.pool.query('DELETE FROM users WHERE id = $1', [user.id])).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_RESTRICT_VIOLATION,
      );
      expect(await service.findById(user.id)).not.toBeNull();
    });

    it('mantiene updated_at con el disparador', async () => {
      const user = await insertUser(t.db);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await t.db.update(users).set({ avatarRef: 'a.png' }).where(eq(users.id, user.id));
      const after = await service.findById(user.id);
      expect(after!.updatedAt.getTime()).toBeGreaterThan(user.updatedAt.getTime());
    });
  });

  describe('edición de perfil con concurrencia optimista', () => {
    it('actualiza, incrementa la versión y audita solo los campos cambiados', async () => {
      const user = await insertUser(t.db, { firstName: 'Ana', lastName: 'Ruiz' });
      const updated = await service.updateProfile(user.id, 1, { lastName: ' Rojas ' });

      expect(updated).toMatchObject({ firstName: 'Ana', lastName: 'Rojas', version: 2 });
      const audit = await t.db.select().from(auditLogs);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'user.profile.updated',
        entityType: 'user',
        entityId: user.id,
        oldValues: { lastName: 'Ruiz' },
        newValues: { lastName: 'Rojas' },
      });
    });

    it('rechaza una versión obsoleta con ConcurrencyConflictError', async () => {
      const user = await insertUser(t.db);
      await service.updateProfile(user.id, 1, { firstName: 'Uno' });
      await expect(service.updateProfile(user.id, 1, { firstName: 'Dos' })).rejects.toBeInstanceOf(
        ConcurrencyConflictError,
      );
      expect((await service.findById(user.id))!.firstName).toBe('Uno');
    });

    it('con dos ediciones simultáneas de la misma versión solo una se aplica', async () => {
      const user = await insertUser(t.db);
      const results = await Promise.allSettled([
        service.updateProfile(user.id, 1, { firstName: 'A' }),
        service.updateProfile(user.id, 1, { firstName: 'B' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('si no hay cambios reales no genera auditoría', async () => {
      const user = await insertUser(t.db, { firstName: 'Ana' });
      await service.updateProfile(user.id, 1, { firstName: 'Ana' });
      expect(await t.db.select().from(auditLogs)).toHaveLength(0);
    });
  });

  describe('estado de cuenta y borrado lógico (§104.6)', () => {
    it('DISABLED conserva la cuenta y queda auditado', async () => {
      const user = await insertUser(t.db);
      const updated = await service.setStatus(user.id, 'DISABLED', { reason: 'baja temporal' });

      expect(updated).toMatchObject({ status: 'DISABLED', deletedAt: null });
      const [entry] = await t.db.select().from(auditLogs);
      expect(entry).toMatchObject({
        action: 'user.status.changed',
        entityId: user.id,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'DISABLED' },
        metadata: { reason: 'baja temporal', revokedSessions: 0 },
      });
    });

    it('DELETED es lógico (motivo, fecha y autor) y se puede restaurar', async () => {
      const admin = await insertUser(t.db);
      const user = await insertUser(t.db);

      const deleted = await service.setStatus(user.id, 'DELETED', {
        actorUserId: admin.id,
        reason: 'solicitud del usuario',
      });
      expect(deleted).toMatchObject({
        status: 'DELETED',
        deletionReason: 'solicitud del usuario',
        deletedBy: admin.id,
      });
      expect(deleted.deletedAt?.toISOString()).toBe('2026-06-01T12:00:00.000Z');
      // La identidad permanece: se puede seguir encontrando.
      expect((await service.findByEmail(user.email))?.id).toBe(user.id);

      const restored = await service.setStatus(user.id, 'ACTIVE', { actorUserId: admin.id });
      expect(restored).toMatchObject({
        status: 'ACTIVE',
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      });
      expect(await t.db.select().from(auditLogs)).toHaveLength(2);
    });

    it('desactivar o eliminar cierra las sesiones y reactivar no las revive (§104.6)', async () => {
      const user = await insertUser(t.db);
      const other = await insertUser(t.db);
      const { token } = await sessionService.create({ userId: user.id, persistent: true });
      const { token: otherToken } = await sessionService.create({
        userId: other.id,
        persistent: false,
      });
      expect(await sessionService.validate(token)).not.toBeNull();

      await service.setStatus(user.id, 'DISABLED', {});
      expect(await sessionService.validate(token)).toBeNull();
      // Las sesiones de otros usuarios no se ven afectadas.
      expect(await sessionService.validate(otherToken)).not.toBeNull();

      await service.setStatus(user.id, 'ACTIVE', {});
      expect(await sessionService.validate(token)).toBeNull();

      const { token: fresh } = await sessionService.create({ userId: user.id, persistent: false });
      await service.setStatus(user.id, 'DELETED', { reason: 'baja' });
      expect(await sessionService.validate(fresh)).toBeNull();

      const entries = await t.db.select().from(auditLogs).orderBy(auditLogs.occurredAt);
      expect(entries.at(0)!.metadata).toMatchObject({ revokedSessions: 1 });
    });

    it('un usuario inexistente da 404', async () => {
      await expect(service.setStatus(randomUUID(), 'DISABLED', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('markLogin registra el último acceso con la hora del reloj', async () => {
      const user = await insertUser(t.db);
      clock.set('2026-07-01T08:30:00.000Z');
      await service.markLogin(user.id);
      expect((await service.findById(user.id))!.lastLoginAt?.toISOString()).toBe(
        '2026-07-01T08:30:00.000Z',
      );
    });
  });

  it('la auditoría solo acepta actores que existan (referencia histórica)', async () => {
    await expect(
      new AuditService(clock).record(t.db, {
        action: 'x.y.z',
        entityType: 'x',
        actorUserId: randomUUID(),
      }),
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');
  });
});
