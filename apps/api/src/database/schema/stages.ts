import { STAGE_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  money,
  primaryId,
  softDeleteColumns,
  timestamps,
  timestamptz,
  versionColumn,
} from './columns.js';
import { importBatches } from './import-batches.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const stageStatusEnum = pgEnum('stage_status', STAGE_STATUSES);

/**
 * Etapas (§11, §12, §86). Representan periodos de estrategia de banca/stake, no rondas: la
 * banca continúa de una a otra. Como máximo una `ACTIVE` por proyecto, protegido con un índice
 * único parcial (§86: "protegido también a nivel de base de datos cuando sea viable"). Solo se
 * envía a la papelera una etapa `CLOSED` (nunca la activa), así que al restaurarla siempre
 * vuelve a `CLOSED`: no hace falta guardar un "estado anterior" como en los proyectos.
 */
export const stages = pgTable(
  'stages',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Unidad de stake de la etapa (§12): `monto teórico = stake × unidad`. */
    unitStake: money('unit_stake').notNull(),
    status: stageStatusEnum('status').notNull().default('ACTIVE'),
    purgeEligibleAt: timestamptz('purge_eligible_at'),
    /**
     * Cuándo empezó la etapa, si se conoce (etapas históricas de una importación, D-X28). Nulo en
     * las ordinarias: los marcadores del gráfico de banca siguen usando `created_at`.
     */
    startsAt: timestamptz('starts_at'),
    /** Lote de importación que la creó (Fase 9, §113); `null` en las etapas ordinarias. */
    batchId: uuid('batch_id').references(() => importBatches.id, {
      onDelete: 'restrict',
    }),
    ...timestamps(),
    version: versionColumn(),
    ...softDeleteColumns(),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('stages_project_idx').on(table.projectId, table.status),
    uniqueIndex('stages_project_active_unique')
      .on(table.projectId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('stages_batch_idx')
      .on(table.batchId)
      .where(sql`${table.batchId} IS NOT NULL`),
    check('stages_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    check('stages_unit_stake_positive', sql`${table.unitStake} > 0`),
    check(
      'stages_trash_consistency',
      sql`(${table.status} = 'TRASHED') = (${table.deletedAt} IS NOT NULL)
        AND (${table.status} = 'TRASHED') = (${table.purgeEligibleAt} IS NOT NULL)`,
    ),
  ],
);

export type StageRow = typeof stages.$inferSelect;
export type NewStage = typeof stages.$inferInsert;
