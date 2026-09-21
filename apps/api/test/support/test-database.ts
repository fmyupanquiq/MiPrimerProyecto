import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { reconcileRbac } from '../../src/authorization/rbac-seeder.js';
import type { Database } from '../../src/database/database.module.js';
import * as schema from '../../src/database/schema/index.js';

/** Base de datos de pruebas de integración (PostgreSQL real, spec §58 y ADR 0002). */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://letfer:letfer_dev@localhost:5432/letfer_test';

export interface TestDatabase {
  pool: pg.Pool;
  db: Database;
  close: () => Promise<void>;
}

export function createTestDatabase(): TestDatabase {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}

/**
 * Vacía todas las tablas de la aplicación entre pruebas.
 * Las tablas de auditoría son inmutables (TRUNCATE bloqueado por disparador), así que se
 * desactivan los disparadores solo en esta sesión de pruebas (`session_replication_role`).
 */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (rows.length === 0) return;
    const list = rows.map((row) => `"${row.tablename}"`).join(', ');
    await client.query(`SET session_replication_role = 'replica'`);
    await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    await client.query(`SET session_replication_role = 'origin'`);
  } finally {
    client.release();
  }
  // El vaciado también borra los roles de sistema: se vuelven a sembrar (idempotente).
  await reconcileRbac(drizzle(pool, { schema }));
}
