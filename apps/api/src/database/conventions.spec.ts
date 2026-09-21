import { and, eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { validate, version as uuidVersion } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/support/test-database.js';
import {
  ConcurrencyConflictError,
  expectUpdated,
  nextVersion,
  notDeleted,
  restoreValues,
  softDeleteValues,
} from './concurrency.js';
import { PG_RESTRICT_VIOLATION, pgErrorCode } from './pg-errors.js';
import { primaryId, softDeleteColumns, timestamps, versionColumn } from './schema/columns.js';

// Tabla de prueba efímera que usa las convenciones del proyecto. Se crea con SQL para
// comprobar que las columnas de Drizzle coinciden con lo que la base de datos realmente tiene.
const scratchItems = pgTable('scratch_items', {
  id: primaryId(),
  name: text('name').notNull(),
  ...timestamps(),
  version: versionColumn(),
  ...softDeleteColumns(),
});

describe('convenciones de esquema (PostgreSQL real)', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = createTestDatabase();
    await t.pool.query(`
      CREATE TABLE scratch_items (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        deletion_reason text
      );
      CREATE TRIGGER scratch_items_updated_at BEFORE UPDATE ON scratch_items
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER scratch_items_no_delete BEFORE DELETE ON scratch_items
        FOR EACH ROW EXECUTE FUNCTION prevent_delete();

      CREATE TABLE scratch_immutable (id integer PRIMARY KEY, note text);
      CREATE TRIGGER scratch_immutable_rows BEFORE UPDATE OR DELETE ON scratch_immutable
        FOR EACH ROW EXECUTE FUNCTION prevent_modification();
      CREATE TRIGGER scratch_immutable_truncate BEFORE TRUNCATE ON scratch_immutable
        FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
    `);
  });

  afterAll(async () => {
    await t.pool.query('DROP TABLE IF EXISTS scratch_items, scratch_immutable');
    await t.close();
  });

  it('genera identificadores UUIDv7 en la aplicación', async () => {
    const [a, b] = await t.db
      .insert(scratchItems)
      .values([{ name: 'a' }, { name: 'b' }])
      .returning();
    expect(validate(a!.id)).toBe(true);
    expect(uuidVersion(a!.id)).toBe(7);
    expect(a!.id < b!.id).toBe(true);
  });

  it('almacena los instantes como timestamptz', async () => {
    const { rows } = await t.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'scratch_items' AND column_name IN ('created_at', 'updated_at', 'deleted_at')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.data_type).toBe('timestamp with time zone');

    const instant = new Date('2026-03-01T15:04:05.678Z');
    const [row] = await t.db
      .insert(scratchItems)
      .values({ name: 'utc', createdAt: instant })
      .returning();
    expect(row!.createdAt.toISOString()).toBe('2026-03-01T15:04:05.678Z');
  });

  it('el disparador actualiza updated_at aunque la aplicación no lo envíe', async () => {
    const [created] = await t.db.insert(scratchItems).values({ name: 'orig' }).returning();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [updated] = await t.db
      .update(scratchItems)
      .set({ name: 'cambiado' })
      .where(eq(scratchItems.id, created!.id))
      .returning();
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(created!.updatedAt.getTime());
    expect(updated!.createdAt.getTime()).toBe(created!.createdAt.getTime());
  });

  it('control optimista: la versión esperada actualiza y la obsoleta se rechaza', async () => {
    const [created] = await t.db.insert(scratchItems).values({ name: 'v' }).returning();
    const id = created!.id;
    const update = (expectedVersion: number, name: string) =>
      t.db
        .update(scratchItems)
        .set({ name, version: nextVersion(scratchItems.version) })
        .where(and(eq(scratchItems.id, id), eq(scratchItems.version, expectedVersion)))
        .returning();

    const first = expectUpdated(await update(1, 'primero'), 'scratch_items');
    expect(first.version).toBe(2);

    // Segunda edición con la versión ya obsoleta (lectura anterior a la primera).
    expect(() => expectUpdated([], 'scratch_items')).toThrow(ConcurrencyConflictError);
    const stale = await update(1, 'obsoleto');
    expect(stale).toHaveLength(0);
    expect(() => expectUpdated(stale, 'scratch_items')).toThrow(ConcurrencyConflictError);

    const [current] = await t.db.select().from(scratchItems).where(eq(scratchItems.id, id));
    expect(current!.name).toBe('primero');
  });

  it('dos ediciones simultáneas con la misma versión: solo una se aplica', async () => {
    const [created] = await t.db.insert(scratchItems).values({ name: 'carrera' }).returning();
    const id = created!.id;
    const attempt = (name: string) =>
      t.db
        .update(scratchItems)
        .set({ name, version: nextVersion(scratchItems.version) })
        .where(and(eq(scratchItems.id, id), eq(scratchItems.version, 1)))
        .returning();

    const results = await Promise.all([attempt('A'), attempt('B')]);
    expect(results.filter((rows) => rows.length === 1)).toHaveLength(1);
  });

  it('borrado lógico y restauración con los ayudantes', async () => {
    const [created] = await t.db.insert(scratchItems).values({ name: 'temporal' }).returning();
    const id = created!.id;
    const active = () =>
      t.db
        .select()
        .from(scratchItems)
        .where(and(eq(scratchItems.id, id), notDeleted(scratchItems.deletedAt)));

    expect(await active()).toHaveLength(1);

    const now = new Date('2026-05-01T10:00:00.000Z');
    await t.db
      .update(scratchItems)
      .set(softDeleteValues({ now, reason: 'duplicado' }))
      .where(eq(scratchItems.id, id));
    expect(await active()).toHaveLength(0);
    const [deleted] = await t.db.select().from(scratchItems).where(eq(scratchItems.id, id));
    expect(deleted!.deletedAt?.toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(deleted!.deletionReason).toBe('duplicado');

    await t.db.update(scratchItems).set(restoreValues()).where(eq(scratchItems.id, id));
    expect(await active()).toHaveLength(1);
  });

  it('impide la eliminación física (prevent_delete)', async () => {
    const [created] = await t.db.insert(scratchItems).values({ name: 'protegido' }).returning();
    const attempt = t.pool.query('DELETE FROM scratch_items WHERE id = $1', [created!.id]);
    await expect(attempt).rejects.toSatisfy(
      (error) => pgErrorCode(error) === PG_RESTRICT_VIOLATION,
    );
    const [still] = await t.db.select().from(scratchItems).where(eq(scratchItems.id, created!.id));
    expect(still).toBeDefined();
  });

  it('una tabla inmutable rechaza UPDATE, DELETE y TRUNCATE (prevent_modification)', async () => {
    await t.pool.query(`INSERT INTO scratch_immutable VALUES (1, 'original')`);
    for (const sqlText of [
      `UPDATE scratch_immutable SET note = 'x' WHERE id = 1`,
      `DELETE FROM scratch_immutable WHERE id = 1`,
      `TRUNCATE scratch_immutable`,
    ]) {
      await expect(t.pool.query(sqlText)).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_RESTRICT_VIOLATION,
      );
    }
    const { rows } = await t.pool.query<{ note: string }>('SELECT note FROM scratch_immutable');
    expect(rows).toEqual([{ note: 'original' }]);
  });
});
