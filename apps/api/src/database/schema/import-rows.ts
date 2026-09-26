import { IMPORT_ROW_STATUSES, IMPORT_TRAFFIC_LIGHTS } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgEnum, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bets } from './bets.js';
import { importBatches } from './import-batches.js';
import { primaryId, timestamptz } from './columns.js';

export const importRowStatusEnum = pgEnum('import_row_status', IMPORT_ROW_STATUSES);
export const importTrafficLightEnum = pgEnum('import_traffic_light', IMPORT_TRAFFIC_LIGHTS);

/**
 * Staging de un lote de importación (Fase 9, §113.6, ADR 0020): una fila por cada fila del archivo
 * de origen, con sus valores originales, su clasificación, su semáforo y sus hallazgos. **No toca el
 * ledger**: escribir aquí nunca crea movimientos, apuestas ni etapas.
 *
 * - `raw_values` son los valores exactos del archivo (como texto, D-X12) y no cambian jamás.
 * - `normalized` es lo que LetFer entendió de la fila (si se pudo); `findings` son los avisos y
 *   errores de la validación.
 * - `created_bet_id` apunta a la apuesta que creó la importación (solo filas `VALID`).
 * - Mientras el lote está `UPLOADED` o `VALIDATED` las filas se pueden reescribir y borrar (nueva
 *   validación); desde `IMPORTED` son inmutables (disparadores de la migración 0033).
 */
export const importRows = pgTable(
  'import_rows',
  {
    id: primaryId(),
    importBatchId: uuid('import_batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    /** Número de fila del archivo original (N° de la hoja o fila de la hoja de cálculo). */
    rowNumber: integer('row_number').notNull(),
    rawValues: jsonb('raw_values').notNull().$type<Record<string, unknown>>(),
    normalized: jsonb('normalized').$type<Record<string, unknown>>(),
    status: importRowStatusEnum('status').notNull(),
    trafficLight: importTrafficLightEnum('traffic_light'),
    findings: jsonb('findings').notNull().$type<Record<string, unknown>[]>().default([]),
    createdBetId: uuid('created_bet_id').references(() => bets.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_rows_batch_row_unique').on(table.importBatchId, table.rowNumber),
    uniqueIndex('import_rows_created_bet_unique')
      .on(table.createdBetId)
      .where(sql`${table.createdBetId} IS NOT NULL`),
    check('import_rows_row_number_positive', sql`${table.rowNumber} > 0`),
    check('import_rows_findings_is_array', sql`jsonb_typeof(${table.findings}) = 'array'`),
    check(
      'import_rows_created_bet_only_valid',
      sql`${table.createdBetId} IS NULL OR ${table.status} = 'VALID'`,
    ),
  ],
);

export type ImportRowRow = typeof importRows.$inferSelect;
export type NewImportRow = typeof importRows.$inferInsert;
