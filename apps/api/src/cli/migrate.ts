// Comando administrativo: aplica las migraciones pendientes sobre DATABASE_URL (ADR 0021).
//
//   npm run migrate -w @letfer/api     (tras `npm run build`)
//
// Pensado para producción: usa el `dist/` compilado y no necesita drizzle-kit (dependencia de
// desarrollo). Es idempotente y nunca borra datos: solo aplica las migraciones aún no registradas
// en `drizzle.__drizzle_migrations`, cada una en su transacción.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnvFiles } from '../config/app-config.js';
import { runMigrations } from '../database/migrate.js';
import * as schema from '../database/schema/index.js';

loadEnvFiles();

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('Falta la variable de entorno DATABASE_URL.');
  process.exit(1);
}

// Solo el nombre de la base: la URL completa lleva la contraseña.
const databaseName = new URL(url).pathname.slice(1);
const pool = new pg.Pool({ connectionString: url, max: 1 });
let exitCode = 0;
try {
  const before = await appliedCount(pool);
  await runMigrations(drizzle(pool, { schema }));
  const after = await appliedCount(pool);
  console.log(
    `Base "${databaseName}": ${after - before} migraciones aplicadas ahora, ${after} en total.`,
  );
} catch (error) {
  console.error(`No se pudieron aplicar las migraciones sobre "${databaseName}".`);
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);

/** Migraciones ya registradas; 0 en una base nueva (la tabla de control aún no existe). */
async function appliedCount(client: pg.Pool): Promise<number> {
  const { rows: table } = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  if (!table[0]?.exists) return 0;
  const { rows } = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
  );
  return rows[0]?.n ?? 0;
}
