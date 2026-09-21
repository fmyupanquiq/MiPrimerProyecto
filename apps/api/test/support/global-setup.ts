import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { runMigrations } from '../../src/database/migrate.js';
import * as schema from '../../src/database/schema/index.js';
import { TEST_DATABASE_URL } from './test-database.js';

/**
 * Antes de las pruebas: comprueba que PostgreSQL responde y reconstruye `letfer_test`
 * desde cero aplicando todas las migraciones (así también se prueban las migraciones).
 */
export async function setup(): Promise<void> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      throw new Error(
        'No se pudo conectar a la base de datos de pruebas (letfer_test). ' +
          'Inicia PostgreSQL con "npm run db:start".',
        { cause: error },
      );
    }
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
