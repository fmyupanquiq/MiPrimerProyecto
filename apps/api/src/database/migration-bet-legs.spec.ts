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
 * §114: las migraciones 0042 (columnas documentales del leg y referencia externa) y 0043 (regla de
 * cuotas por leg) se aplican sobre apuestas ya registradas SIN modificarlas. Se construye una base
 * de datos aparte (nunca la de producción) con las migraciones hasta la 0041, se insertan apuestas
 * Simple, Creada, Múltiple e importada con la forma de siempre, y se aplica el resto.
 */
const LAST_BEFORE = 41; // 0041_bet_selection_created_null_odds
const HOOK_TIMEOUT_MS = 60_000;

const ID = {
  user: '0195f7c0-0000-7000-8000-000000000001',
  project: '0195f7c0-0000-7000-8000-000000000002',
  house: '0195f7c0-0000-7000-8000-000000000003',
  stage: '0195f7c0-0000-7000-8000-000000000004',
  batch: '0195f7c0-0000-7000-8000-000000000008',
  simple: '0195f7c0-0000-7000-8000-0000000000e1',
  created: '0195f7c0-0000-7000-8000-0000000000e2',
  multiple: '0195f7c0-0000-7000-8000-0000000000e3',
  imported: '0195f7c0-0000-7000-8000-0000000000e4',
  newMultiple: '0195f7c0-0000-7000-8000-0000000000e5',
};
const OLD = '2026-01-15T10:00:00.000Z';

describe('migraciones 0042-0044 sobre apuestas existentes (PostgreSQL real)', () => {
  const scratchName = 'letfer_migration_legs_scratch';
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

    beforeFolder = mkdtempSync(join(tmpdir(), 'letfer-before-legs-'));
    mkdirSync(join(beforeFolder, 'meta'));
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter((entry) => entry.idx <= LAST_BEFORE);
    writeFileSync(
      join(beforeFolder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(beforeFolder, `${entry.tag}.sql`));
    }
    expect(journal.entries.length).toBeGreaterThan(LAST_BEFORE + 1);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
    rmSync(beforeFolder, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const insertBet = (client: pg.PoolClient, id: string, betType: string, batch: string | null) =>
    client.query(
      `INSERT INTO bets (id, project_id, stage_id, house_id, created_by, bet_type, stake,
                         visible_total_odds, placed_at, created_at, updated_at, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, 2.0000, 3.500000, $7, $7, $7, $8)`,
      [id, ID.project, ID.stage, ID.house, ID.user, betType, OLD, batch],
    );
  const insertSelection = (
    client: pg.PoolClient,
    betId: string,
    group: number,
    position: number,
    selection: string,
    odds: string | null,
  ) =>
    client.query(
      `INSERT INTO bet_selections (id, bet_id, event_group, position, event, selection, visible_odds)
       VALUES (gen_random_uuid(), $1, $2, $3, 'A vs. B', $4, $5)`,
      [betId, group, position, selection, odds],
    );

  const snapshot = async (): Promise<Record<string, unknown>[]> =>
    (
      await pool.query<Record<string, unknown>>(
        `SELECT b.id AS bet_id, b.bet_type, b.stake::text, b.visible_total_odds::text,
                b.status, b.reason, b.updated_at, b.version,
                s.event_group, s.position, s.event, s.market, s.selection, s.visible_odds::text
           FROM bets b JOIN bet_selections s ON s.bet_id = b.id
          ORDER BY b.id, s.event_group, s.position`,
      )
    ).rows;

  async function expectRejected(run: () => Promise<unknown>) {
    await expect(run()).rejects.toMatchObject({ code: '23514' }); // check_violation
  }

  it(
    'las apuestas existentes no cambian y la regla nueva solo relaja',
    async () => {
      await migrate(drizzle(pool), { migrationsFolder: beforeFolder });

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
          `INSERT INTO import_batches (id, project_id, origin, original_name, source_file, source_sha256,
                                     source_size_bytes, created_by)
         VALUES ($1, $2, 'Betsafe', 'b.xlsx', 'x'::bytea, encode(sha256('x'::bytea), 'hex'), 1, $3)`,
          [ID.batch, ID.project, ID.user],
        );
        // Simple, Creada con selecciones sin cuota, Múltiple de 3 legs de una fila e importada sin cuotas.
        await insertBet(client, ID.simple, 'SIMPLE', null);
        await insertSelection(client, ID.simple, 0, 0, 'A gana', '1.950000');
        await insertBet(client, ID.created, 'CREATED', null);
        await insertSelection(client, ID.created, 0, 0, 'Más de 2.5', null);
        await insertSelection(client, ID.created, 0, 1, 'Ambos marcan', null);
        await insertBet(client, ID.multiple, 'MULTIPLE', null);
        await insertSelection(client, ID.multiple, 0, 0, 'A gana', '1.500000');
        await insertSelection(client, ID.multiple, 1, 0, 'B gana', '2.100000');
        await insertSelection(client, ID.multiple, 2, 0, 'C gana', '1.110000');
        await insertBet(client, ID.imported, 'MULTIPLE', ID.batch);
        await insertSelection(client, ID.imported, 0, 0, 'A gana', null);
        await insertSelection(client, ID.imported, 1, 0, 'B gana', null);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const before = await snapshot();
      expect(before).toHaveLength(8);

      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

      // 1. Idéntico fila por fila (incluidos updated_at y version): no se reescribió nada.
      expect(await snapshot()).toEqual(before);

      // 2. Columnas nuevas: nulas en todo lo existente.
      const extra = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bet_selections
        WHERE leg_score IS NOT NULL OR leg_result IS NOT NULL OR condition_status IS NOT NULL`,
      );
      expect(extra.rows[0]!.n).toBe('0');
      const refs = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bets WHERE external_reference IS NOT NULL`,
      );
      expect(refs.rows[0]!.n).toBe('0');

      // 2b. 0044: toda cuota total existente (incluida la de una importación) queda de origen
      // DESCONOCIDO — jamás se marca oficial por suposición — y su valor no cambia.
      const sources = await pool.query<{ total_odds_source: string; odds: string; n: string }>(
        `SELECT total_odds_source::text, visible_total_odds::text AS odds, count(*)::text AS n
           FROM bets GROUP BY 1, 2`,
      );
      expect(sources.rows).toEqual([{ total_odds_source: 'UNKNOWN', odds: '3.500000', n: '4' }]);

      // 3. Control de la regla nueva: ninguna Múltiple ordinaria existente tiene filas sin cuota.
      const offenders = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bet_selections s JOIN bets b ON b.id = s.bet_id
        WHERE s.visible_odds IS NULL AND b.batch_id IS NULL AND b.bet_type = 'MULTIPLE'`,
      );
      expect(offenders.rows[0]!.n).toBe('0');
    },
    HOOK_TIMEOUT_MS,
  );

  it(
    'tras migrar: una Múltiple admite un leg creado con la cuota UNA vez; lo inválido se rechaza',
    async () => {
      // Leg 1 normal (2.15) + leg 2 creado (2.47 en la primera fila, la interna sin cuota).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertBet(client, ID.newMultiple, 'MULTIPLE', null);
        await insertSelection(client, ID.newMultiple, 0, 0, '1X', '2.150000');
        await insertSelection(client, ID.newMultiple, 1, 0, 'Manchester City', '2.470000');
        await insertSelection(client, ID.newMultiple, 1, 1, 'Más de 2.5', null);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const rows = await pool.query<{ visible_odds: string | null }>(
        `SELECT visible_odds::text FROM bet_selections WHERE bet_id = $1
        ORDER BY event_group, position`,
        [ID.newMultiple],
      );
      expect(rows.rows.map((r) => r.visible_odds)).toEqual(['2.150000', '2.470000', null]);

      // Sigue rechazado: la fila principal de un leg sin cuota (BEFORE, al instante).
      await expectRejected(() => insertSelection(pool as never, ID.newMultiple, 2, 0, 'X', null));
      // Sigue rechazado: una condición interna sin la cuota del leg (diferido, al confirmar).
      await expectRejected(async () => {
        await insertSelection(pool as never, ID.newMultiple, 3, 1, 'Huérfana', null);
      });
      // Sigue rechazado: una Simple sin cuota.
      await expectRejected(async () => {
        const c = await pool.connect();
        try {
          await insertBet(c, ID.simple.replace(/e1$/, 'f1'), 'SIMPLE', null);
          await insertSelection(c, ID.simple.replace(/e1$/, 'f1'), 0, 0, 'A', null);
        } finally {
          c.release();
        }
      });
    },
    HOOK_TIMEOUT_MS,
  );
});
