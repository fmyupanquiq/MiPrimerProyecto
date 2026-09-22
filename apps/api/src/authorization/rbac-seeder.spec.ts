import { PERMISSION_CODES, SYSTEM_ROLE_DEFINITIONS } from '@letfer/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import {
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from '../database/pg-errors.js';
import { permissions, rolePermissions, roles } from '../database/schema/index.js';
import { AuthorizationService } from './authorization.service.js';
import { reconcileRbac } from './rbac-seeder.js';

describe('sembrado del catálogo RBAC (PostgreSQL real)', () => {
  let t: TestDatabase;
  let authorization: AuthorizationService;

  beforeAll(() => {
    t = createTestDatabase();
    authorization = new AuthorizationService(t.db);
  });
  afterAll(() => t.close());
  beforeEach(() => truncateAll(t.pool));

  const roleId = async (key: string) => {
    const [row] = await t.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    return row!.id;
  };
  const codesOf = async (key: string): Promise<string[]> => {
    const rows = await t.db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, await roleId(key)));
    return rows.map((row) => row.code).sort();
  };

  it('siembra todos los permisos y los seis roles de sistema con la matriz del catálogo', async () => {
    const all = await t.db.select().from(permissions);
    expect(all.map((row) => row.code).sort()).toEqual([...PERMISSION_CODES].sort());

    const systemRoles = await t.db.select().from(roles).where(eq(roles.isSystem, true));
    expect(systemRoles.map((row) => row.key).sort()).toEqual(
      SYSTEM_ROLE_DEFINITIONS.map((definition) => definition.key).sort(),
    );

    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      expect(await codesOf(definition.key)).toEqual([...definition.permissions].sort());
    }
  });

  it('F1: el rol USER tiene projects.create en la base de datos', async () => {
    expect(await codesOf('USER')).toContain('projects.create');
  });

  it('es idempotente: ejecutarlo de nuevo no cambia ids ni cuentas', async () => {
    const before = await t.db.select({ id: roles.id, key: roles.key }).from(roles);
    const beforePermissions = await t.db.select().from(rolePermissions);
    await reconcileRbac(t.db);
    await reconcileRbac(t.db);

    expect(await t.db.select({ id: roles.id, key: roles.key }).from(roles)).toEqual(before);
    expect(await t.db.select().from(rolePermissions)).toHaveLength(beforePermissions.length);
  });

  it('con arranques simultáneos no duplica nada', async () => {
    await Promise.all([reconcileRbac(t.db), reconcileRbac(t.db), reconcileRbac(t.db)]);
    const systemRoles = await t.db.select().from(roles).where(eq(roles.isSystem, true));
    expect(systemRoles).toHaveLength(SYSTEM_ROLE_DEFINITIONS.length);
  });

  it('corrige la deriva: restituye lo que falta y quita lo que sobra en roles de sistema', async () => {
    const usuario = await roleId('USER');
    const lector = await roleId('READER');
    await t.db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, usuario),
          eq(rolePermissions.permissionCode, 'projects.create'),
        ),
      );
    await t.db.insert(rolePermissions).values({ roleId: lector, permissionCode: 'project.trash' });
    await t.db.update(roles).set({ name: 'Nombre alterado' }).where(eq(roles.id, lector));

    await reconcileRbac(t.db);

    expect(await codesOf('USER')).toEqual(['projects.create']);
    expect(await codesOf('READER')).toEqual(
      ['houses.view', 'members.view', 'movements.view', 'project.view', 'stages.view'].sort(),
    );
    const [reader] = await t.db.select().from(roles).where(eq(roles.id, lector));
    expect(reader!.name).toBe('Lector');
  });

  it('no toca los roles personalizados', async () => {
    const [custom] = await t.db
      .insert(roles)
      .values({ scope: 'GLOBAL', name: 'Auditor', description: 'solo lectura global' })
      .returning();
    await t.db
      .insert(rolePermissions)
      .values({ roleId: custom!.id, permissionCode: 'projects.list_all' });

    await reconcileRbac(t.db);

    const rows = await t.db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, custom!.id));
    expect(rows.map((row) => row.code)).toEqual(['projects.list_all']);
  });

  describe('restricciones de la tabla de roles', () => {
    it('no permite dos roles de sistema con la misma clave', async () => {
      await expect(
        t.db.insert(roles).values({ key: 'USER', scope: 'GLOBAL', name: 'Otro', isSystem: true }),
      ).rejects.toSatisfy((error) => pgErrorCode(error) === PG_UNIQUE_VIOLATION);
    });

    it('un rol de sistema exige clave y un rol con clave debe ser de sistema', async () => {
      await expect(
        t.db.insert(roles).values({ scope: 'GLOBAL', name: 'Sin clave', isSystem: true }),
      ).rejects.toSatisfy((error) => pgErrorCode(error) === PG_CHECK_VIOLATION);
      await expect(
        t.db
          .insert(roles)
          .values({ key: 'FALSO', scope: 'GLOBAL', name: 'Falso', isSystem: false }),
      ).rejects.toSatisfy((error) => pgErrorCode(error) === PG_CHECK_VIOLATION);
    });

    it('un rol global no puede pertenecer a un proyecto', async () => {
      await expect(
        t.db.insert(roles).values({
          scope: 'GLOBAL',
          name: 'Global de proyecto',
          projectId: '00000000-0000-7000-8000-000000000001',
        }),
      ).rejects.toSatisfy((error) => pgErrorCode(error) === PG_CHECK_VIOLATION);
    });

    it('los roles no se eliminan físicamente', async () => {
      await expect(t.pool.query(`DELETE FROM roles WHERE key = 'READER'`)).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_RESTRICT_VIOLATION,
      );
    });
  });

  describe('AuthorizationService', () => {
    it('carga un rol con sus permisos', async () => {
      const loaded = await authorization.loadRole(await roleId('PROJECT_ADMIN'));
      expect(loaded!.key).toBe('PROJECT_ADMIN');
      expect([...loaded!.permissions].sort()).toEqual(
        [...SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === 'PROJECT_ADMIN')!.permissions].sort(),
      );
    });

    it('un rol inexistente devuelve null', async () => {
      expect(await authorization.loadRole('00000000-0000-7000-8000-000000000009')).toBeNull();
    });

    it('el Administrador Global tiene todos los permisos y USER solo projects.create', async () => {
      const admin = await authorization.globalAccess({
        globalRoleId: await roleId('GLOBAL_ADMIN'),
      });
      expect(admin.roleKey).toBe('GLOBAL_ADMIN');
      expect([...admin.permissions].sort()).toEqual([...PERMISSION_CODES].sort());

      const user = await authorization.globalAccess({ globalRoleId: await roleId('USER') });
      expect([...user.permissions]).toEqual(['projects.create']);
    });

    it('un rol global personalizado se respeta (la arquitectura lo admite, §4.5)', async () => {
      const [custom] = await t.db
        .insert(roles)
        .values({ scope: 'GLOBAL', name: 'Auditor global' })
        .returning();
      await t.db.insert(rolePermissions).values([
        { roleId: custom!.id, permissionCode: 'projects.list_all' },
        { roleId: custom!.id, permissionCode: 'project.view' },
      ]);

      const access = await authorization.globalAccess({ globalRoleId: custom!.id });
      expect(access.roleKey).toBe('Auditor global');
      expect([...access.permissions].sort()).toEqual(['project.view', 'projects.list_all']);
      expect(access.permissions.has('projects.create')).toBe(false);
    });

    it('ignora códigos de permiso desconocidos guardados en la base de datos', async () => {
      const usuario = await roleId('USER');
      await t.pool.query(
        `INSERT INTO permissions (code, scope, description) VALUES ('legado.borrado', 'GLOBAL', 'x')`,
      );
      await t.pool.query(
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'legado.borrado')`,
        [usuario],
      );
      const loaded = await authorization.loadRole(usuario);
      expect([...loaded!.permissions]).toEqual(['projects.create']);
      // El sembrado deja la matriz del catálogo exacta.
      await reconcileRbac(t.db);
      expect(await codesOf('USER')).toEqual(['projects.create']);
    });
  });
});
