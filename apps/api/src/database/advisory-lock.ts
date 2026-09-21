import { sql } from 'drizzle-orm';
import type { DbExecutor } from './database.types.js';

/**
 * Serializa las transacciones que comparten `key` hasta que la actual termine (bloqueo asesor
 * de PostgreSQL). Sirve para operaciones que deben ejecutarse de una en una por recurso lógico
 * (p. ej. los intentos de acceso de un mismo correo). Debe llamarse dentro de una transacción.
 */
export async function lockByKey(executor: DbExecutor, key: string): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
