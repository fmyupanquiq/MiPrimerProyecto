import type { DbExecutor } from '../../src/database/database.types.js';
import { roleIdByKey } from '../../src/database/role-lookup.js';
import { newId } from '../../src/database/schema/columns.js';
import { users, type NewUser, type UserRow } from '../../src/database/schema/index.js';

/**
 * Inserta un usuario de prueba directamente en la base de datos (sin hash real).
 * `globalRole` es la clave del rol global (por defecto `USER`).
 */
export async function insertUser(
  db: DbExecutor,
  overrides: Partial<NewUser> & { globalRole?: string } = {},
): Promise<UserRow> {
  const { globalRole = 'USER', ...values } = overrides;
  const [user] = await db
    .insert(users)
    .values({
      firstName: 'Ana',
      lastName: 'Pérez',
      email: `usuario-${newId()}@example.com`,
      passwordHash: 'hash-de-prueba',
      globalRoleId: values.globalRoleId ?? (await roleIdByKey(db, globalRole)),
      ...values,
    })
    .returning();
  return user!;
}
