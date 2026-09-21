import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../../test/support/test-database.js';
import { MIGRATIONS_FOLDER } from './migrate.js';

/**
 * Prueba de migración sobre un estado real de la Fase 1: se construye una base de datos aparte
 * con las migraciones 0000 a 0008 (el esquema exacto de la Fase 1), se insertan usuarios reales
 * con el `system_role` antiguo y luego se aplican las migraciones de la Fase 2.
 */
const PHASE1_LAST_MIGRATION = 8; // 0008_password_reset_tokens
const FIRST_PHASE2_MIGRATION = 9;

// Crear y borrar la base temporal puede tardar más de 10 s en Windows con toda la suite en marcha.
const HOOK_TIMEOUT_MS = 60_000;

describe('migración desde el estado de la Fase 1', () => {
  const scratchName = 'letfer_migration_scratch';
  const scratchUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${scratchName}`);
  let admin: pg.Pool;
  let pool: pg.Pool;
  let phase1Folder: string;

  beforeAll(async () => {
    admin = new pg.Pool({
      connectionString: TEST_DATABASE_URL.replace(/\/[^/]+$/, '/postgres'),
      max: 1,
    });
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${scratchName}`);
    pool = new pg.Pool({ connectionString: scratchUrl, max: 2 });

    // Carpeta con solo las migraciones de la Fase 1 (diario truncado).
    phase1Folder = mkdtempSync(join(tmpdir(), 'letfer-phase1-'));
    mkdirSync(join(phase1Folder, 'meta'));
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as {
      entries: { idx: number; tag: string }[];
    };
    const phase1Entries = journal.entries.filter((entry) => entry.idx <= PHASE1_LAST_MIGRATION);
    writeFileSync(
      join(phase1Folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: phase1Entries }),
    );
    for (const entry of phase1Entries) {
      cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(phase1Folder, `${entry.tag}.sql`));
    }
    expect(journal.entries.length).toBeGreaterThan(FIRST_PHASE2_MIGRATION);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
    rmSync(phase1Folder, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  it('conserva a los usuarios existentes y les asigna el rol global equivalente', async () => {
    // 1. Estado de la Fase 1.
    await migrate(drizzle(pool), { migrationsFolder: phase1Folder });
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    expect(columns.rows.map((r: { column_name: string }) => r.column_name)).toContain(
      'system_role',
    );

    const oldTimestamp = '2026-01-15T10:00:00.000Z';
    await pool.query(
      `INSERT INTO users (id, first_name, last_name, email, password_hash, status, system_role, created_at, updated_at)
       VALUES
         ('0195f7c0-0000-7000-8000-000000000001', 'Admin', 'Local', 'admin@letfer.local', '$argon2id$x', 'ACTIVE', 'GLOBAL_ADMIN', $1, $1),
         ('0195f7c0-0000-7000-8000-000000000002', 'Ana', 'Pérez', 'ana@example.com', '$argon2id$x', 'ACTIVE', 'USER', $1, $1),
         ('0195f7c0-0000-7000-8000-000000000003', 'Beto', 'Ruiz', 'beto@example.com', '$argon2id$x', 'DISABLED', 'USER', $1, $1)`,
      [oldTimestamp],
    );
    await pool.query(
      `INSERT INTO audit_logs (id, action, entity_type, actor_user_id)
       VALUES ('0195f7c0-0000-7000-8000-0000000000a1', 'user.bootstrap_admin', 'user', '0195f7c0-0000-7000-8000-000000000001')`,
    );

    // 2. Se aplican las migraciones de la Fase 2 (el diario completo).
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    // 3. Comprobaciones.
    const rows = await pool.query<{
      email: string;
      role_key: string;
      updated_at: Date;
      status: string;
    }>(
      `SELECT u.email, r.key AS role_key, u.updated_at, u.status
         FROM users u JOIN roles r ON r.id = u.global_role_id ORDER BY u.email`,
    );
    expect(rows.rows.map((r) => [r.email, r.role_key, r.status])).toEqual([
      ['admin@letfer.local', 'GLOBAL_ADMIN', 'ACTIVE'],
      ['ana@example.com', 'USER', 'ACTIVE'],
      ['beto@example.com', 'USER', 'DISABLED'],
    ]);
    // La migración no altera la fecha de modificación de los usuarios existentes.
    for (const row of rows.rows) expect(row.updated_at.toISOString()).toBe(oldTimestamp);

    // La columna y el tipo antiguos ya no existen, y la nueva es obligatoria.
    const after = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'users'`,
    );
    const byName = new Map(
      after.rows.map((r: { column_name: string; is_nullable: string }) => [
        r.column_name,
        r.is_nullable,
      ]),
    );
    expect(byName.has('system_role')).toBe(false);
    expect(byName.get('global_role_id')).toBe('NO');
    const types = await pool.query(`SELECT typname FROM pg_type WHERE typname = 'system_role'`);
    expect(types.rows).toHaveLength(0);

    // Los datos de la Fase 1 (auditoría) se conservan intactos.
    const audit = await pool.query(`SELECT action FROM audit_logs`);
    expect(audit.rows).toEqual([{ action: 'user.bootstrap_admin' }]);

    // Los seis roles de sistema quedaron creados (los permisos los siembra la aplicación).
    const roleKeys = await pool.query(`SELECT key FROM roles WHERE is_system ORDER BY key`);
    expect(roleKeys.rows.map((r: { key: string }) => r.key)).toEqual([
      'COLLABORATOR',
      'GLOBAL_ADMIN',
      'PROJECT_ADMIN',
      'PROJECT_OWNER',
      'READER',
      'USER',
    ]);
  });

  it('volver a aplicar las migraciones es idempotente', async () => {
    await expect(
      migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.not.toThrow();
    const count = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
    expect(count.rows[0]!.n).toBe(3);
  });
});
