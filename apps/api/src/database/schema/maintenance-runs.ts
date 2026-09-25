import { MAINTENANCE_STATUSES, MAINTENANCE_TRIGGERS, type MaintenancePurged } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';
import { users } from './users.js';

export const maintenanceTriggerEnum = pgEnum('maintenance_trigger', MAINTENANCE_TRIGGERS);
export const maintenanceStatusEnum = pgEnum('maintenance_status', MAINTENANCE_STATUSES);

/**
 * Historial de purgas de registros auxiliares (§111.6, D8-3). Cada fila es el registro de una
 * ejecución ya terminada, inmutable (disparador `prevent_modification`, mismo espíritu que
 * `integrity_check_runs`). `run_by` es nulo cuando la lanzó la tarea programada.
 */
export const maintenanceRuns = pgTable(
  'maintenance_runs',
  {
    id: primaryId(),
    trigger: maintenanceTriggerEnum('trigger').notNull(),
    runBy: uuid('run_by').references(() => users.id, { onDelete: 'restrict' }),
    startedAt: timestamptz('started_at').notNull(),
    finishedAt: timestamptz('finished_at').notNull(),
    status: maintenanceStatusEnum('status').notNull(),
    retentionDays: integer('retention_days').notNull(),
    purged: jsonb('purged').notNull().$type<MaintenancePurged>(),
    errorMessage: text('error_message'),
  },
  (table) => [
    index('maintenance_runs_started_idx').on(table.startedAt),
    check('maintenance_runs_retention_positive', sql`${table.retentionDays} > 0`),
    check(
      'maintenance_runs_manual_has_author',
      sql`${table.trigger} <> 'MANUAL' OR ${table.runBy} IS NOT NULL`,
    ),
    check(
      'maintenance_runs_error_only_when_failed',
      sql`(${table.status} = 'FAILED') = (${table.errorMessage} IS NOT NULL)`,
    ),
  ],
);

export type MaintenanceRunRow = typeof maintenanceRuns.$inferSelect;
