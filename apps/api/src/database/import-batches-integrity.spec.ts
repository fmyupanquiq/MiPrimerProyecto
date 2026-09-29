import { IMPORT_MAX_FILE_BYTES } from '@letfer/shared';
import { createHash } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  insertBet,
  insertHouse,
  insertProject,
  insertStage,
  insertUser,
} from '../../test/support/factories.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import {
  PG_CHECK_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraintName,
  pgErrorCode,
} from './pg-errors.js';
import {
  bets,
  financialMovements,
  importBatches,
  importRows,
  type HouseRow,
  type NewImportBatch,
  type NewImportRow,
  type UserRow,
} from './schema/index.js';

const PG_RESTRICT = '23001';
const PG_NOT_NULL_VIOLATION = '23502';
const PG_INVALID_TEXT = '22P02';

const code = (expected: string) => (error: unknown) => pgErrorCode(error) === expected;
const constraint = (name: string) => (error: unknown) =>
  pgErrorCode(error) === PG_CHECK_VIOLATION && pgConstraintName(error) === name;
const sha256 = (file: Buffer) => createHash('sha256').update(file).digest('hex');

/**
 * Fase 9.1.2a (§113, ADR 0020): el modelo base de lotes de importación y su staging. La base de
 * datos garantiza la huella del archivo, el límite de 10 MB, la unicidad de lo importado, la
 * inmutabilidad tras importar y el aislamiento del ledger.
 */
describe('lotes de importación y staging en PostgreSQL (§113)', () => {
  let t: TestDatabase;
  let author: UserRow;
  let projectId: string;
  let house: HouseRow;
  let otherHouse: HouseRow;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.pool);
    author = await insertUser(t.db);
    projectId = (await insertProject(t.db, { owner: author })).project.id;
    house = await insertHouse(t.db, { projectId, name: 'Betsafe' });
    otherHouse = await insertHouse(t.db, { projectId, name: 'Betano' });
  });

  const file = (text = 'contenido del archivo') => Buffer.from(text);
  const now = new Date('2026-09-26T12:00:00.000Z');

  /** Lote recién subido con un archivo coherente (huella y tamaño calculados). */
  async function upload(overrides: Partial<NewImportBatch> = {}, bytes = file()) {
    const [batch] = await t.db
      .insert(importBatches)
      .values({
        projectId,
        origin: 'Betsafe',
        originalName: 'Betsafe.xlsx',
        sourceFile: bytes,
        sourceSha256: sha256(bytes),
        sourceSizeBytes: bytes.length,
        createdBy: author.id,
        ...overrides,
      })
      .returning();
    return batch!;
  }
  const validate = (id: string, houseId = house.id) =>
    t.db
      .update(importBatches)
      .set({ status: 'VALIDATED', houseId, validatedAt: now, validatedBy: author.id })
      .where(eq(importBatches.id, id))
      .returning()
      .then((rows) => rows[0]!);
  const doImport = (id: string, overrides: Partial<NewImportBatch> = {}) =>
    t.db
      .update(importBatches)
      .set({
        status: 'IMPORTED',
        importedAt: now,
        importedBy: author.id,
        importReason: 'Historial de Betsafe',
        report: { semaphore: 'GREEN' },
        rowsTotal: 3,
        rowsValid: 2,
        ...overrides,
      })
      .where(eq(importBatches.id, id))
      .returning()
      .then((rows) => rows[0]!);
  const annul = (id: string, overrides: Partial<NewImportBatch> = {}) =>
    t.db
      .update(importBatches)
      .set({
        status: 'ANNULLED',
        annulledAt: now,
        annulledBy: author.id,
        annulmentReason: 'Archivo equivocado',
        ...overrides,
      })
      .where(eq(importBatches.id, id))
      .returning()
      .then((rows) => rows[0]!);
  const importedBatch = async (bytes = file(), houseId = house.id) => {
    const batch = await upload({}, bytes);
    await validate(batch.id, houseId);
    return doImport(batch.id);
  };

  const insertRow = async (batchId: string, overrides: Partial<NewImportRow> = {}) => {
    const [row] = await t.db
      .insert(importRows)
      .values({
        importBatchId: batchId,
        rowNumber: 1,
        rawValues: { N: '1', FECHA: '2024-10-22', APUESTA: '62.5' },
        status: 'VALID',
        ...overrides,
      })
      .returning();
    return row!;
  };

  describe('lote', () => {
    it('se crea recién subido con los valores por defecto', async () => {
      const batch = await upload();
      expect(batch).toMatchObject({
        status: 'UPLOADED',
        houseId: null,
        isRehearsal: false,
        rowsTotal: 0,
        rowsValid: 0,
        rowsTemplate: 0,
        rowsEmpty: 0,
        rowsPartial: 0,
        rowsInvalid: 0,
        report: null,
        importedAt: null,
        annulledAt: null,
        version: 1,
      });
      expect(batch.sourceFile.equals(file())).toBe(true);
      expect(batch.sourceSha256).toBe(sha256(file()));
      expect(batch.sourceSizeBytes).toBe(file().length);
    });

    it('recorre el ciclo UPLOADED → VALIDATED → IMPORTED → ANNULLED', async () => {
      const batch = await upload();
      expect((await validate(batch.id)).status).toBe('VALIDATED');
      const imported = await doImport(batch.id);
      expect(imported).toMatchObject({ status: 'IMPORTED', rowsTotal: 3, rowsValid: 2 });
      const annulled = await annul(batch.id);
      expect(annulled).toMatchObject({
        status: 'ANNULLED',
        annulmentReason: 'Archivo equivocado',
        report: { semaphore: 'GREEN' },
      });
    });

    it('solo admite los cuatro estados definidos', async () => {
      await expect(
        upload({ status: 'DISCARDED' as unknown as NewImportBatch['status'] }),
      ).rejects.toSatisfy(code(PG_INVALID_TEXT));
    });

    it('la huella es obligatoria y debe ser sha256 en hexadecimal', async () => {
      await expect(upload({ sourceSha256: undefined as unknown as string })).rejects.toSatisfy(
        code(PG_NOT_NULL_VIOLATION),
      );
      await expect(upload({ sourceSha256: 'abc' })).rejects.toSatisfy(
        constraint('import_batches_sha256_format'),
      );
      await expect(upload({ sourceSha256: sha256(file()).toUpperCase() })).rejects.toSatisfy(
        constraint('import_batches_sha256_format'),
      );
    });

    it('la huella debe corresponder a los bytes del archivo original', async () => {
      await expect(upload({ sourceSha256: sha256(file('otro archivo')) })).rejects.toSatisfy(
        constraint('import_batches_sha256_matches_file'),
      );
    });

    it('el tamaño declarado debe coincidir con el archivo', async () => {
      await expect(upload({ sourceSizeBytes: 5 })).rejects.toSatisfy(
        constraint('import_batches_size_matches_file'),
      );
    });

    it('acepta exactamente 10 MB y rechaza un archivo mayor o vacío', async () => {
      const atLimit = Buffer.alloc(IMPORT_MAX_FILE_BYTES, 1);
      await expect(upload({}, atLimit)).resolves.toMatchObject({
        sourceSizeBytes: IMPORT_MAX_FILE_BYTES,
      });
      const over = Buffer.alloc(IMPORT_MAX_FILE_BYTES + 1, 2);
      await expect(upload({}, over)).rejects.toSatisfy(constraint('import_batches_size_limit'));
      await expect(upload({}, Buffer.alloc(0))).rejects.toSatisfy(
        constraint('import_batches_size_limit'),
      );
    });

    it('exige nombre, casa desde la validación y los datos de cada estado', async () => {
      await expect(upload({ originalName: '   ' })).rejects.toSatisfy(
        constraint('import_batches_name_not_blank'),
      );
      const batch = await upload();
      // Validado sin casa.
      await expect(
        t.db
          .update(importBatches)
          .set({ status: 'VALIDATED', validatedAt: now, validatedBy: author.id })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(constraint('import_batches_house_required'));
      // Validado sin quién ni cuándo.
      await expect(
        t.db
          .update(importBatches)
          .set({ status: 'VALIDATED', houseId: house.id })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(constraint('import_batches_validated_shape'));
      await validate(batch.id);
      // Importado sin motivo ni informe.
      await expect(doImport(batch.id, { importReason: '  ' })).rejects.toSatisfy(
        constraint('import_batches_imported_shape'),
      );
      await expect(doImport(batch.id, { report: null })).rejects.toSatisfy(
        constraint('import_batches_imported_shape'),
      );
      // Un lote no importado no puede llevar datos de importación.
      await expect(
        t.db
          .update(importBatches)
          .set({ importReason: 'antes de tiempo' })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(constraint('import_batches_not_imported_shape'));
      // Anulado sin motivo.
      await doImport(batch.id);
      await expect(annul(batch.id, { annulmentReason: '  ' })).rejects.toSatisfy(
        constraint('import_batches_annulled_shape'),
      );
    });

    it('los contadores no pueden ser negativos', async () => {
      await expect(upload({ rowsPartial: -1 })).rejects.toSatisfy(
        constraint('import_batches_counters_non_negative'),
      );
    });
  });

  describe('reconocimiento (D-X17b, Fase 9.3.1)', () => {
    it('exige las tres columnas juntas o ninguna, separado de import_reason y annulment_reason', async () => {
      const batch = await upload();
      await expect(upload({ acknowledgmentReason: 'Fila roja aceptada' })).rejects.toSatisfy(
        constraint('import_batches_acknowledgment_shape'),
      );
      await expect(upload({ acknowledgedBy: author.id, acknowledgedAt: now })).rejects.toSatisfy(
        constraint('import_batches_acknowledgment_shape'),
      );
      await expect(
        upload({ acknowledgmentReason: '   ', acknowledgedBy: author.id, acknowledgedAt: now }),
      ).rejects.toSatisfy(constraint('import_batches_acknowledgment_shape'));

      const [acknowledged] = await t.db
        .update(importBatches)
        .set({
          acknowledgmentReason: 'Fila roja aceptada: diferencia explicada por redondeo',
          acknowledgedBy: author.id,
          acknowledgedAt: now,
        })
        .where(eq(importBatches.id, batch.id))
        .returning();
      expect(acknowledged).toMatchObject({
        acknowledgmentReason: 'Fila roja aceptada: diferencia explicada por redondeo',
        acknowledgedBy: author.id,
        // El motivo del reconocimiento nunca es el de importar ni el de anular.
        importReason: null,
        annulmentReason: null,
      });
    });

    it('un lote sin nada que reconocer se importa y se anula igual, con las tres columnas en null', async () => {
      const batch = await importedBatch();
      expect(batch).toMatchObject({
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgmentReason: null,
      });
      const annulled = await annul(batch.id);
      expect(annulled).toMatchObject({ acknowledgmentReason: null });
    });

    it('el reconocimiento queda congelado en cuanto el lote se importa, igual que el resto', async () => {
      const batch = await upload();
      await validate(batch.id);
      await t.db
        .update(importBatches)
        .set({
          acknowledgmentReason: 'Parcial reconocida antes de importar',
          acknowledgedBy: author.id,
          acknowledgedAt: now,
        })
        .where(eq(importBatches.id, batch.id));
      const imported = await doImport(batch.id);
      expect(imported.acknowledgmentReason).toBe('Parcial reconocida antes de importar');

      await expect(
        t.db
          .update(importBatches)
          .set({ acknowledgmentReason: 'Intento de cambiarlo después de importar' })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
      // Tampoco se puede reconocer algo nuevo por primera vez si nunca se reconoció nada.
      const other = await importedBatch(file('otro archivo'));
      await expect(
        t.db
          .update(importBatches)
          .set({ acknowledgmentReason: 'x', acknowledgedBy: author.id, acknowledgedAt: now })
          .where(eq(importBatches.id, other.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
    });
  });

  describe('idempotencia: un archivo importado no se importa dos veces', () => {
    it('no permite dos lotes IMPORTED con la misma casa y huella en un proyecto', async () => {
      await importedBatch();
      const second = await upload();
      await validate(second.id);
      await expect(doImport(second.id)).rejects.toSatisfy(code(PG_UNIQUE_VIOLATION));
    });

    it('sí permite reimportar tras anular el lote anterior', async () => {
      const first = await importedBatch();
      await annul(first.id);
      const again = await upload();
      await validate(again.id);
      await expect(doImport(again.id)).resolves.toMatchObject({ status: 'IMPORTED' });
    });

    it('la misma huella en otra casa o en otro proyecto no choca; subidos o validados, tampoco', async () => {
      await importedBatch();
      const other = await upload();
      await validate(other.id, otherHouse.id);
      await expect(doImport(other.id)).resolves.toMatchObject({ status: 'IMPORTED' });

      await upload();
      const validated = await upload();
      await validate(validated.id);

      const otherProject = (await insertProject(t.db, { owner: author })).project.id;
      const foreignHouse = await insertHouse(t.db, { projectId: otherProject });
      const [foreign] = await t.db
        .insert(importBatches)
        .values({
          projectId: otherProject,
          origin: 'Betsafe',
          houseId: foreignHouse.id,
          status: 'IMPORTED',
          originalName: 'Betsafe.xlsx',
          sourceFile: file(),
          sourceSha256: sha256(file()),
          sourceSizeBytes: file().length,
          createdBy: author.id,
          validatedAt: now,
          validatedBy: author.id,
          importedAt: now,
          importedBy: author.id,
          importReason: 'Otro proyecto',
          report: {},
        })
        .returning();
      expect(foreign?.status).toBe('IMPORTED');
    });
  });

  describe('inmutabilidad', () => {
    it('el archivo, su huella y su nombre no cambian jamás', async () => {
      const batch = await upload();
      const other = file('otro');
      await expect(
        t.db
          .update(importBatches)
          .set({ sourceFile: other, sourceSha256: sha256(other), sourceSizeBytes: other.length })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
      await expect(
        t.db
          .update(importBatches)
          .set({ originalName: 'Otro.xlsx' })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
    });

    it('antes de importar, los contadores y el plan sí se pueden actualizar', async () => {
      const batch = await upload();
      const [updated] = await t.db
        .update(importBatches)
        .set({ rowsTotal: 158, rowsValid: 6, rowsTemplate: 152, stagePlan: { rounds: 1 } })
        .where(eq(importBatches.id, batch.id))
        .returning();
      expect(updated).toMatchObject({ rowsTotal: 158, rowsTemplate: 152 });
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(batch.updatedAt.getTime());
    });

    it('un lote importado solo puede anularse y conserva sus datos', async () => {
      const batch = await importedBatch();
      for (const change of [
        { report: { semaphore: 'RED' } },
        { rowsValid: 99 },
        { houseId: otherHouse.id },
        { importReason: 'otro motivo' },
        { isRehearsal: true },
        { stagePlan: { rounds: 9 } },
        { status: 'VALIDATED' as const },
        { status: 'UPLOADED' as const },
      ]) {
        await expect(
          t.db.update(importBatches).set(change).where(eq(importBatches.id, batch.id)),
        ).rejects.toSatisfy(
          (error: unknown) =>
            pgErrorCode(error) === PG_RESTRICT || pgErrorCode(error) === PG_CHECK_VIOLATION,
        );
      }
      // Anular con un cambio adicional a escondidas también se rechaza.
      await expect(annul(batch.id, { rowsValid: 0 })).rejects.toSatisfy(code(PG_RESTRICT));
      const annulled = await annul(batch.id);
      expect(annulled).toMatchObject({ rowsValid: 2, report: { semaphore: 'GREEN' } });
    });

    it('un lote anulado no vuelve a cambiar', async () => {
      const batch = await importedBatch();
      await annul(batch.id);
      await expect(
        t.db
          .update(importBatches)
          .set({ annulmentReason: 'Otro motivo' })
          .where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
      await expect(
        t.db.update(importBatches).set({ version: 2 }).where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
    });

    it('solo se importa un lote validado y solo se anula uno importado', async () => {
      const batch = await upload();
      await expect(
        doImport(batch.id, { houseId: house.id, validatedAt: now, validatedBy: author.id }),
      ).rejects.toSatisfy(code(PG_RESTRICT));
      await validate(batch.id);
      await expect(annul(batch.id)).rejects.toSatisfy(code(PG_RESTRICT));
    });

    it('un lote nunca se borra ni se vacía la tabla', async () => {
      const batch = await upload();
      await expect(
        t.db.delete(importBatches).where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
      await expect(t.pool.query('TRUNCATE import_batches CASCADE')).rejects.toSatisfy(
        code(PG_RESTRICT),
      );
    });
  });

  describe('filas de staging', () => {
    it('guarda los valores originales, la clasificación, el semáforo y los hallazgos', async () => {
      const batch = await upload();
      const row = await insertRow(batch.id, {
        status: 'PARTIAL',
        trafficLight: 'YELLOW',
        normalized: { amount: '62.50' },
        findings: [{ code: 'MISSING_ODDS', message: 'Falta la cuota' }],
      });
      expect(row).toMatchObject({
        status: 'PARTIAL',
        trafficLight: 'YELLOW',
        createdBetId: null,
        rawValues: { N: '1', FECHA: '2024-10-22', APUESTA: '62.5' },
        findings: [{ code: 'MISSING_ODDS', message: 'Falta la cuota' }],
      });
      expect(await insertRow(batch.id, { rowNumber: 2 })).toMatchObject({ findings: [] });
    });

    it('admite las cinco clasificaciones y los tres semáforos, y nada más', async () => {
      const batch = await upload();
      const statuses = ['VALID', 'TEMPLATE', 'EMPTY', 'PARTIAL', 'INVALID'] as const;
      const lights = ['GREEN', 'YELLOW', 'RED'] as const;
      for (const [index, status] of statuses.entries()) {
        await insertRow(batch.id, {
          rowNumber: index + 1,
          status,
          trafficLight: lights[index % 3],
        });
      }
      await expect(
        insertRow(batch.id, {
          rowNumber: 10,
          status: 'IGNORED' as unknown as NewImportRow['status'],
        }),
      ).rejects.toSatisfy(code(PG_INVALID_TEXT));
      await expect(
        insertRow(batch.id, {
          rowNumber: 11,
          trafficLight: 'BLUE' as unknown as NewImportRow['trafficLight'],
        }),
      ).rejects.toSatisfy(code(PG_INVALID_TEXT));
    });

    it('cada número de fila aparece una sola vez por lote y es positivo', async () => {
      const batch = await upload();
      await insertRow(batch.id, { rowNumber: 7 });
      await expect(insertRow(batch.id, { rowNumber: 7 })).rejects.toSatisfy(
        code(PG_UNIQUE_VIOLATION),
      );
      await expect(insertRow(batch.id, { rowNumber: 0 })).rejects.toSatisfy(
        constraint('import_rows_row_number_positive'),
      );
      const other = await upload({}, file('otro archivo'));
      await expect(insertRow(other.id, { rowNumber: 7 })).resolves.toBeDefined();
    });

    it('los hallazgos son una lista y solo una fila válida puede referir una apuesta', async () => {
      const batch = await upload();
      await expect(
        insertRow(batch.id, { findings: { code: 'X' } as unknown as Record<string, unknown>[] }),
      ).rejects.toSatisfy(constraint('import_rows_findings_is_array'));
      const stage = await insertStage(t.db, { projectId });
      const { bet } = await insertBet(t.db, {
        projectId,
        stageId: stage.id,
        houseId: house.id,
        createdBy: author.id,
      });
      await expect(
        insertRow(batch.id, { status: 'TEMPLATE', createdBetId: bet.id }),
      ).rejects.toSatisfy(constraint('import_rows_created_bet_only_valid'));
      await insertRow(batch.id, { status: 'VALID', createdBetId: bet.id });
      await expect(
        insertRow(batch.id, { rowNumber: 2, status: 'VALID', createdBetId: bet.id }),
      ).rejects.toSatisfy(code(PG_UNIQUE_VIOLATION));
    });

    it('antes de importar se pueden reescribir y borrar, pero sus valores originales no cambian', async () => {
      const batch = await upload();
      const row = await insertRow(batch.id);
      const [updated] = await t.db
        .update(importRows)
        .set({ status: 'INVALID', trafficLight: 'RED', findings: [{ code: 'BAD_DATE' }] })
        .where(eq(importRows.id, row.id))
        .returning();
      expect(updated).toMatchObject({ status: 'INVALID', trafficLight: 'RED' });

      for (const change of [{ rawValues: { N: '2' } }, { rowNumber: 9 }]) {
        await expect(
          t.db.update(importRows).set(change).where(eq(importRows.id, row.id)),
        ).rejects.toSatisfy(code(PG_RESTRICT));
      }
      await t.db.delete(importRows).where(eq(importRows.id, row.id));
      const [remaining] = await t.db.select({ total: count() }).from(importRows);
      expect(remaining?.total).toBe(0);
    });

    it('desde que el lote se importa sus filas son inmutables; también anulado', async () => {
      const batch = await upload();
      const row = await insertRow(batch.id);
      await validate(batch.id);
      // Todavía validado: se pueden completar las referencias antes de importar.
      await t.db.update(importRows).set({ trafficLight: 'GREEN' }).where(eq(importRows.id, row.id));
      await doImport(batch.id);

      const frozen = async () => {
        await expect(
          t.db.update(importRows).set({ trafficLight: 'RED' }).where(eq(importRows.id, row.id)),
        ).rejects.toSatisfy(code(PG_RESTRICT));
        await expect(t.db.delete(importRows).where(eq(importRows.id, row.id))).rejects.toSatisfy(
          code(PG_RESTRICT),
        );
        await expect(insertRow(batch.id, { rowNumber: 2 })).rejects.toSatisfy(code(PG_RESTRICT));
      };
      await frozen();
      await annul(batch.id);
      await frozen();
      await expect(t.pool.query('TRUNCATE import_rows')).rejects.toSatisfy(code(PG_RESTRICT));
    });

    it('una fila pertenece a su lote y este no se puede borrar mientras tenga filas', async () => {
      const batch = await upload();
      await insertRow(batch.id);
      await expect(
        t.db.delete(importBatches).where(eq(importBatches.id, batch.id)),
      ).rejects.toSatisfy(code(PG_RESTRICT));
      await expect(
        insertRow('01a0ddc6-a0f8-7149-8ef2-2f5f1aea5fb4', { rowNumber: 3 }),
      ).rejects.toSatisfy(code('23503'));
    });
  });

  describe('aislamiento del ledger', () => {
    it('escribir lotes y filas de staging no crea apuestas ni movimientos', async () => {
      const ledgerBefore = await t.db.select({ total: count() }).from(financialMovements);
      const betsBefore = await t.db.select({ total: count() }).from(bets);

      const batch = await upload();
      for (let index = 1; index <= 20; index += 1) {
        await insertRow(batch.id, {
          rowNumber: index,
          status: index <= 6 ? 'VALID' : 'TEMPLATE',
          trafficLight: index <= 6 ? 'GREEN' : null,
          normalized: index <= 6 ? { amount: '12.50', odds: '1.95' } : null,
        });
      }
      await validate(batch.id);
      await doImport(batch.id);
      await annul(batch.id);

      expect(await t.db.select({ total: count() }).from(financialMovements)).toEqual(ledgerBefore);
      expect(await t.db.select({ total: count() }).from(bets)).toEqual(betsBefore);
      expect(await t.db.select({ total: count() }).from(importRows)).toEqual([{ total: 20 }]);
    });
  });
});
