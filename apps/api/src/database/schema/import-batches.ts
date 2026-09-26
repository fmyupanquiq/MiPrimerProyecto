import { IMPORT_BATCH_STATUSES, IMPORT_MAX_FILE_BYTES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, primaryId, timestamps, timestamptz, versionColumn } from './columns.js';
import { houses } from './houses.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const importBatchStatusEnum = pgEnum('import_batch_status', IMPORT_BATCH_STATUSES);

/**
 * Lotes de importación del historial (Fase 9, §113, ADR 0020). Un lote es un archivo de origen de
 * una casa: se sube (`UPLOADED`), se valida (`VALIDATED`), se importa (`IMPORTED`) y puede anularse
 * (`ANNULLED`). Nunca se borra.
 *
 * - El archivo original se conserva aquí mismo (`source_file`, `bytea`, máximo 10 MB) para que
 *   entre en los backups (D-X26). `source_sha256` es la huella de esos bytes y la base de datos
 *   comprueba que coinciden. Al leer un lote, elige las columnas: no traigas `source_file` salvo
 *   que lo necesites.
 * - `house_id` puede ser nulo mientras el lote solo está subido (la casa sale del nombre del
 *   archivo y se confirma en la vista previa, D-X8); desde `VALIDATED` es obligatorio.
 * - Un lote `IMPORTED` es inmutable salvo su anulación, y uno `ANNULLED` no cambia más
 *   (disparador `import_batches_guard`, migración 0033). Los contadores y el informe se fijan al
 *   importar.
 * - No se puede importar dos veces el mismo archivo de la misma casa en un proyecto mientras el
 *   primer lote siga importado (índice único parcial); anulándolo, sí se puede reimportar (D-X10).
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    houseId: uuid('house_id').references(() => houses.id, { onDelete: 'restrict' }),
    status: importBatchStatusEnum('status').notNull().default('UPLOADED'),
    /** Nombre del archivo tal como se subió; de él sale la casa (D-X8). */
    originalName: text('original_name').notNull(),
    /** Huella SHA-256 (64 hex en minúsculas) de `source_file`. */
    sourceSha256: text('source_sha256').notNull(),
    sourceSizeBytes: integer('source_size_bytes').notNull(),
    sourceFile: bytea('source_file').notNull(),
    /** Ensayo declarado al confirmar (D-X26): queda exento del backup previo obligatorio. */
    isRehearsal: boolean('is_rehearsal').notNull().default(false),
    /** Plan de etapas confirmado (rondas, unidad y fronteras, D-X7). */
    stagePlan: jsonb('stage_plan').$type<Record<string, unknown>>(),
    /** Informe del lote (semáforo, diferencias, reconocimientos). Se fija al importar. */
    report: jsonb('report').$type<Record<string, unknown>>(),
    rowsTotal: integer('rows_total').notNull().default(0),
    rowsValid: integer('rows_valid').notNull().default(0),
    rowsTemplate: integer('rows_template').notNull().default(0),
    rowsEmpty: integer('rows_empty').notNull().default(0),
    rowsPartial: integer('rows_partial').notNull().default(0),
    rowsInvalid: integer('rows_invalid').notNull().default(0),
    /** Quién subió el archivo. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    validatedAt: timestamptz('validated_at'),
    validatedBy: uuid('validated_by').references(() => users.id, { onDelete: 'restrict' }),
    importedAt: timestamptz('imported_at'),
    importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'restrict' }),
    /** Motivo con el que se confirmó la importación (§113.6). */
    importReason: text('import_reason'),
    annulledAt: timestamptz('annulled_at'),
    annulledBy: uuid('annulled_by').references(() => users.id, { onDelete: 'restrict' }),
    annulmentReason: text('annulment_reason'),
    ...timestamps(),
    version: versionColumn(),
  },
  (table) => [
    index('import_batches_project_idx').on(table.projectId, table.createdAt),
    uniqueIndex('import_batches_one_import_per_file')
      .on(table.projectId, table.houseId, table.sourceSha256)
      .where(sql`${table.status} = 'IMPORTED'`),
    check('import_batches_name_not_blank', sql`length(btrim(${table.originalName})) > 0`),
    check('import_batches_sha256_format', sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'import_batches_sha256_matches_file',
      sql`encode(sha256(${table.sourceFile}), 'hex') = ${table.sourceSha256}`,
    ),
    check(
      'import_batches_size_matches_file',
      sql`${table.sourceSizeBytes} = octet_length(${table.sourceFile})`,
    ),
    check(
      'import_batches_size_limit',
      sql.raw(`"source_size_bytes" > 0 AND "source_size_bytes" <= ${IMPORT_MAX_FILE_BYTES}`),
    ),
    check(
      'import_batches_counters_non_negative',
      sql`${table.rowsTotal} >= 0 AND ${table.rowsValid} >= 0 AND ${table.rowsTemplate} >= 0
          AND ${table.rowsEmpty} >= 0 AND ${table.rowsPartial} >= 0 AND ${table.rowsInvalid} >= 0`,
    ),
    check(
      'import_batches_house_required',
      sql`${table.status} = 'UPLOADED' OR ${table.houseId} IS NOT NULL`,
    ),
    check(
      'import_batches_validated_shape',
      sql`${table.status} = 'UPLOADED'
          OR (${table.validatedAt} IS NOT NULL AND ${table.validatedBy} IS NOT NULL)`,
    ),
    check(
      'import_batches_imported_shape',
      sql`${table.status} NOT IN ('IMPORTED', 'ANNULLED')
          OR (${table.importedAt} IS NOT NULL AND ${table.importedBy} IS NOT NULL
              AND ${table.importReason} IS NOT NULL AND length(btrim(${table.importReason})) > 0
              AND ${table.report} IS NOT NULL)`,
    ),
    check(
      'import_batches_not_imported_shape',
      sql`${table.status} IN ('IMPORTED', 'ANNULLED')
          OR (${table.importedAt} IS NULL AND ${table.importedBy} IS NULL
              AND ${table.importReason} IS NULL)`,
    ),
    check(
      'import_batches_annulled_shape',
      sql`(${table.status} = 'ANNULLED'
            AND ${table.annulledAt} IS NOT NULL AND ${table.annulledBy} IS NOT NULL
            AND ${table.annulmentReason} IS NOT NULL
            AND length(btrim(${table.annulmentReason})) > 0)
          OR (${table.status} <> 'ANNULLED'
            AND ${table.annulledAt} IS NULL AND ${table.annulledBy} IS NULL
            AND ${table.annulmentReason} IS NULL)`,
    ),
  ],
);

export type ImportBatchRow = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
