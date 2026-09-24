import { INTEGRITY_CHECK_STATUSES, type IntegrityFinding } from '@letfer/shared';
import { index, jsonb, pgEnum, pgTable, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const integrityCheckStatusEnum = pgEnum('integrity_check_status', INTEGRITY_CHECK_STATUSES);

/**
 * Historial de verificaciones de integridad del ledger (§38, §109.2, D-I1). Herramienta de solo
 * lectura: nunca corrige datos ni crea movimientos; cada fila es el registro de una ejecución ya
 * terminada. `projectId` nulo identifica una ejecución global (D-I3, Administrador Global sobre
 * todos los proyectos). Inmutable (disparador `prevent_modification`, mismo espíritu que D2):
 * es un registro histórico, nunca se corrige ni se re-ejecuta sobre la misma fila.
 */
export const integrityCheckRuns = pgTable(
  'integrity_check_runs',
  {
    id: primaryId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    runBy: uuid('run_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startedAt: timestamptz('started_at').notNull(),
    finishedAt: timestamptz('finished_at').notNull(),
    status: integrityCheckStatusEnum('status').notNull(),
    findings: jsonb('findings').notNull().$type<IntegrityFinding[]>(),
  },
  (table) => [index('integrity_check_runs_project_idx').on(table.projectId, table.startedAt)],
);

export type IntegrityCheckRunRow = typeof integrityCheckRuns.$inferSelect;
export type NewIntegrityCheckRun = typeof integrityCheckRuns.$inferInsert;
