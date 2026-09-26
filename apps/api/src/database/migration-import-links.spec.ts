import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../../test/support/test-database.js';
import { MIGRATIONS_FOLDER } from './migrate.js';

/**
 * Fase 9.1.2b (§113, ADR 0020): la migración que enlaza el modelo de importación con las
 * entidades financieras (`batch_id` en bets, financial_movements y stages, `occurred_at_known` y
 * `stages.starts_at`) se aplica sobre datos ya existentes sin tocarlos. Se construye una base de
 * datos aparte con las migraciones hasta la 0033 (el modelo base de importación), se insertan
 * datos ordinarios y se aplica el resto.
 */
const LAST_BEFORE_LINKS = 33; // 0033_import_batches_immutability
const HOOK_TIMEOUT_MS = 60_000;

const ID = {
  user: '0195f7c0-0000-7000-8000-000000000001',
  project: '0195f7c0-0000-7000-8000-000000000002',
  house: '0195f7c0-0000-7000-8000-000000000003',
  stage: '0195f7c0-0000-7000-8000-000000000004',
  bet: '0195f7c0-0000-7000-8000-000000000005',
  deposit: '0195f7c0-0000-7000-8000-000000000006',
  initial: '0195f7c0-0000-7000-8000-000000000007',
};
const OLD = '2026-01-15T10:00:00.000Z';

describe('migración de los enlaces de importación sobre datos existentes (PostgreSQL real)', () => {
  const scratchName = 'letfer_migration_links_scratch';
  const scratchUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${scratchName}`);
  let admin: pg.Pool;
  let pool: pg.Pool;
  let beforeFolder: string;

  beforeAll(async () => {
    admin = new pg.Pool({
      connectionString: TEST_DATABASE_URL.replace(/\/[^/]+$/, '/postgres'),
      max: 1,
    });
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${scratchName}`);
    pool = new pg.Pool({ connectionString: scratchUrl, max: 2 });

    // Carpeta con las migraciones hasta la 0033 (diario truncado).
    beforeFolder = mkdtempSync(join(tmpdir(), 'letfer-before-links-'));
    mkdirSync(join(beforeFolder, 'meta'));
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter((entry) => entry.idx <= LAST_BEFORE_LINKS);
    writeFileSync(
      join(beforeFolder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(beforeFolder, `${entry.tag}.sql`));
    }
    expect(journal.entries.length).toBeGreaterThan(LAST_BEFORE_LINKS + 1);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
    rmSync(beforeFolder, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const columnInfo = async (table: string, column: string) => {
    const result = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return result.rows[0];
  };

  it('los datos existentes quedan sin lote, con fecha conocida y sin cambios', async () => {
    // 1. Estado anterior: no existen las columnas nuevas.
    await migrate(drizzle(pool), { migrationsFolder: beforeFolder });
    expect(await columnInfo('bets', 'batch_id')).toBeUndefined();
    expect(await columnInfo('financial_movements', 'occurred_at_known')).toBeUndefined();
    expect(await columnInfo('stages', 'starts_at')).toBeUndefined();

    // 2. Datos ordinarios: proyecto con propietario, casa, etapa, capital, depósito y una apuesta.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users (id, first_name, last_name, email, password_hash, global_role_id)
         VALUES ($1, 'Ana', 'Pérez', 'ana@example.com', '$argon2id$x',
                 (SELECT id FROM roles WHERE key = 'USER'))`,
        [ID.user],
      );
      await client.query(`INSERT INTO projects (id, name, owner_id) VALUES ($1, 'Grupo', $2)`, [
        ID.project,
        ID.user,
      ]);
      await client.query(
        `INSERT INTO project_members (id, project_id, user_id, role_id, joined_at)
         VALUES ('0195f7c0-0000-7000-8000-0000000000a1', $1, $2,
                 (SELECT id FROM roles WHERE key = 'PROJECT_ADMIN'), $3)`,
        [ID.project, ID.user, OLD],
      );
      await client.query(`INSERT INTO houses (id, project_id, name) VALUES ($1, $2, 'Betano')`, [
        ID.house,
        ID.project,
      ]);
      await client.query(
        `INSERT INTO stages (id, project_id, name, unit_stake, created_at, updated_at)
         VALUES ($1, $2, 'Etapa 1', 12.50, $3, $3)`,
        [ID.stage, ID.project, OLD],
      );
      await client.query(
        `INSERT INTO financial_movements
           (id, operation_id, project_id, stage_id, type, direction, house_id, amount, occurred_at, created_by)
         VALUES ($1, $1, $2, $3, 'INITIAL_CAPITAL', 'CREDIT', $4, 1000.00, $5, $6),
                ($7, $7, $2, $3, 'DEPOSIT', 'CREDIT', $4, 250.00, $5, $6)`,
        [ID.initial, ID.project, ID.stage, ID.house, OLD, ID.user, ID.deposit],
      );
      await client.query(
        `INSERT INTO bets (id, project_id, stage_id, house_id, created_by, bet_type, stake,
                           visible_total_odds, placed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'SIMPLE', 2.0000, 1.950000, $6, $6, $6)`,
        [ID.bet, ID.project, ID.stage, ID.house, ID.user, OLD],
      );
      await client.query(
        `INSERT INTO bet_selections (id, bet_id, event_group, position, event, selection, visible_odds)
         VALUES ('0195f7c0-0000-7000-8000-0000000000b1', $1, 0, 0, 'A vs. B', 'A gana', 1.950000)`,
        [ID.bet],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // 3. Se aplican las migraciones restantes (el diario completo).
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    // 4. Las columnas nuevas existen con lo previsto.
    expect(await columnInfo('bets', 'batch_id')).toMatchObject({ is_nullable: 'YES' });
    expect(await columnInfo('stages', 'batch_id')).toMatchObject({ is_nullable: 'YES' });
    expect(await columnInfo('stages', 'starts_at')).toMatchObject({ is_nullable: 'YES' });
    expect(await columnInfo('financial_movements', 'batch_id')).toMatchObject({
      is_nullable: 'YES',
    });
    expect(await columnInfo('financial_movements', 'occurred_at_known')).toMatchObject({
      is_nullable: 'NO',
      column_default: 'true',
    });

    // 5. Los datos existentes: sin lote, fecha conocida, sin etapa histórica y sin cambios.
    const movements = await pool.query<{
      id: string;
      batch_id: string | null;
      occurred_at_known: boolean;
      amount: string;
      occurred_at: Date;
    }>(
      `SELECT id, batch_id, occurred_at_known, amount, occurred_at
         FROM financial_movements ORDER BY amount DESC`,
    );
    expect(movements.rows.map((r) => [r.id, r.batch_id, r.occurred_at_known, r.amount])).toEqual([
      [ID.initial, null, true, '1000.00'],
      [ID.deposit, null, true, '250.00'],
    ]);
    for (const row of movements.rows) expect(row.occurred_at.toISOString()).toBe(OLD);

    const stage = await pool.query<{
      batch_id: string | null;
      starts_at: Date | null;
      unit_stake: string;
      status: string;
      updated_at: Date;
    }>(`SELECT batch_id, starts_at, unit_stake, status, updated_at FROM stages`);
    expect(stage.rows[0]).toMatchObject({
      batch_id: null,
      starts_at: null,
      unit_stake: '12.50',
      status: 'ACTIVE',
    });
    expect(stage.rows[0]!.updated_at.toISOString()).toBe(OLD);

    const bet = await pool.query<{ batch_id: string | null; status: string; updated_at: Date }>(
      `SELECT batch_id, status, updated_at FROM bets`,
    );
    expect(bet.rows[0]).toMatchObject({ batch_id: null, status: 'PENDING' });
    expect(bet.rows[0]!.updated_at.toISOString()).toBe(OLD);

    // El ledger sigue siendo inmutable y el saldo se reconstruye igual.
    const balance = await pool.query<{ total: string }>(
      `SELECT sum(amount)::text AS total FROM financial_movements WHERE house_id = $1`,
      [ID.house],
    );
    expect(balance.rows[0]!.total).toBe('1250.00');
    await expect(pool.query(`UPDATE financial_movements SET amount = 1`)).rejects.toThrow(
      /inmutables/,
    );
  });

  it('volver a aplicar las migraciones es idempotente y no toca los datos', async () => {
    await expect(
      migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.not.toThrow();
    const count = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM financial_movements`,
    );
    expect(count.rows[0]!.n).toBe(2);
  });
});
