import { newId } from '../../src/database/schema/columns.js';
import { users, type NewUser, type UserRow } from '../../src/database/schema/index.js';
import type { DbExecutor } from '../../src/database/database.types.js';

/** Inserta un usuario de prueba directamente en la base de datos (sin hash real). */
export async function insertUser(
  db: DbExecutor,
  overrides: Partial<NewUser> = {},
): Promise<UserRow> {
  const [user] = await db
    .insert(users)
    .values({
      firstName: 'Ana',
      lastName: 'Pérez',
      email: `usuario-${newId()}@example.com`,
      passwordHash: 'hash-de-prueba',
      ...overrides,
    })
    .returning();
  return user!;
}
