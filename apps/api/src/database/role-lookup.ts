import { eq } from 'drizzle-orm';
import type { DbExecutor } from './database.types.js';
import { roles } from './schema/index.js';

/** Id del rol de sistema con esa clave. Falla si falta: indica que no se sembró el catálogo. */
export async function roleIdByKey(executor: DbExecutor, key: string): Promise<string> {
  const [row] = await executor
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, key))
    .limit(1);
  if (!row)
    throw new Error(`No existe el rol de sistema "${key}" (¿se aplicaron las migraciones?)`);
  return row.id;
}

/** Clave de un rol, o `null` si es un rol personalizado o no existe. */
export async function roleKeyById(executor: DbExecutor, id: string): Promise<string | null> {
  const [row] = await executor
    .select({ key: roles.key })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  return row?.key ?? null;
}
