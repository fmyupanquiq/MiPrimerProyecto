import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser } from '../../test/support/factories.js';
import { FakeClock } from '../../test/support/fake-clock.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import { AuditService } from '../audit/audit.service.js';
import { loadConfig } from '../config/app-config.js';
import { roleKeyById } from '../database/role-lookup.js';
import { auditLogs, users } from '../database/schema/index.js';
import { SessionService } from '../sessions/session.service.js';
import { UsersService } from '../users/users.service.js';
import { BootstrapAdminError, BootstrapAdminService } from './bootstrap-admin.service.js';
import { PasswordHasher } from './password-hasher.js';

const input = {
  email: 'Admin@Letfer.example',
  password: 'contraseña-segura-2026',
  firstName: 'Fernando',
  lastName: 'Yupanqui',
};

describe('BootstrapAdminService (PostgreSQL real)', () => {
  let t: TestDatabase;
  let hasher: PasswordHasher;
  let service: BootstrapAdminService;

  beforeAll(() => {
    t = createTestDatabase();
    hasher = new PasswordHasher(
      loadConfig({
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        ARGON2_MEMORY_KIB: '1024',
        ARGON2_PASSES: '1',
      }),
    );
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.pool);
    const clock = new FakeClock();
    const audit = new AuditService(clock);
    const config = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    const sessions = new SessionService(t.db, clock, config);
    service = new BootstrapAdminService(
      t.db,
      new UsersService(t.db, clock, audit, sessions),
      hasher,
      audit,
    );
  });

  it('crea el Administrador Global con la contraseña hasheada y lo audita', async () => {
    const result = await service.run(input);
    expect(result.status).toBe('created');

    const [admin] = await t.db.select().from(users);
    expect(admin).toMatchObject({
      email: 'admin@letfer.example',
      firstName: 'Fernando',
      lastName: 'Yupanqui',
      status: 'ACTIVE',
    });
    expect(await roleKeyById(t.db, admin!.globalRoleId)).toBe('GLOBAL_ADMIN');
    expect(admin!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin!.passwordHash).not.toContain(input.password);
    await expect(hasher.verify(input.password, admin!.passwordHash)).resolves.toBe(true);

    const entries = await t.db.select().from(auditLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'user.bootstrap_admin',
      entityId: admin!.id,
      actorUserId: null,
      newValues: { email: 'admin@letfer.example', globalRole: 'GLOBAL_ADMIN' },
    });
    expect(JSON.stringify(entries)).not.toContain(input.password);
  });

  it('es idempotente: una segunda ejecución no cambia nada ni sobrescribe la contraseña', async () => {
    await service.run(input);
    const [before] = await t.db.select().from(users);

    const again = await service.run({ ...input, password: 'otra-contraseña-distinta-99' });
    expect(again.status).toBe('already_exists');

    const all = await t.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]!.passwordHash).toBe(before!.passwordHash);
    expect(await t.db.select().from(auditLogs)).toHaveLength(1);
  });

  it('si ya existe un Administrador Global (otro correo) no crea un segundo', async () => {
    await insertUser(t.db, { email: 'otro-admin@example.com', globalRole: 'GLOBAL_ADMIN' });
    await expect(service.run(input)).resolves.toEqual({ status: 'already_exists' });
    expect(await t.db.select().from(users)).toHaveLength(1);
  });

  it('no asciende a un usuario existente con el mismo correo', async () => {
    await insertUser(t.db, { email: 'admin@letfer.example' });
    await expect(service.run(input)).rejects.toBeInstanceOf(BootstrapAdminError);

    const [user] = await t.db.select().from(users).where(eq(users.email, 'admin@letfer.example'));
    expect(await roleKeyById(t.db, user!.globalRoleId)).toBe('USER');
  });

  it('rechaza una contraseña débil sin crear nada ni revelarla en el error', async () => {
    const weak = { ...input, password: 'corta' };
    const attempt = service.run(weak);
    await expect(attempt).rejects.toBeInstanceOf(BootstrapAdminError);
    await expect(attempt).rejects.toThrow(/al menos 10 caracteres/);
    await expect(attempt).rejects.not.toThrow(/corta/);
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it('rechaza una contraseña que contiene la parte local del correo', async () => {
    await expect(
      service.run({ ...input, email: 'fernando@letfer.example', password: 'fernando-2026-clave' }),
    ).rejects.toThrow(/parte local/);
  });

  it('rechaza correo inválido y nombres vacíos', async () => {
    await expect(service.run({ ...input, email: 'no-es-correo' })).rejects.toBeInstanceOf(
      BootstrapAdminError,
    );
    await expect(service.run({ ...input, firstName: '  ' })).rejects.toThrow(/firstName/);
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it('con dos ejecuciones simultáneas solo se crea un administrador', async () => {
    const results = await Promise.all([service.run(input), service.run(input)]);
    expect(results.map((r) => r.status).sort()).toEqual(['already_exists', 'created']);
    expect(await t.db.select().from(users)).toHaveLength(1);
  });
});
