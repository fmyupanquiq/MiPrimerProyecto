import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema/index.js';

/**
 * Ejecutor de consultas: la conexión de la aplicación o una transacción abierta.
 * Los servicios que participan en operaciones con varios efectos (§57) reciben un
 * `DbExecutor` para poder ejecutarse dentro de la transacción del llamador.
 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;
