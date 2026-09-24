import { RECONCILIATION_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { money, primaryId, timestamptz } from './columns.js';
import { houses } from './houses.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const reconciliationStatusEnum = pgEnum('reconciliation_status', RECONCILIATION_STATUSES);

/**
 * Checkpoints de conciliación (§32, §80, §109.1, D-C1). Registro histórico de comparación, no
 * un ajuste financiero: nunca modifica saldos ni crea movimientos. Se registra tanto si coincide
 * (`MATCHED`) como si no (`DISCREPANCY`); el sistema puede pasarlo después a `INVALIDATED`
 * (§109.1.3) cuando una apuesta anterior a `occurredAt` cambia, pero nadie más lo edita: las
 * cifras comparadas son inmutables desde que se crean (disparador
 * `protect_reconciliation_checkpoint_fields`, mismo espíritu que D2).
 */
export const reconciliationCheckpoints = pgTable(
  'reconciliation_checkpoints',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    occurredAt: timestamptz('occurred_at').notNull(),
    /** `available` calculado por LetFer en ese instante (D3), igual que en el resto de la app. */
    letferAvailable: money('letfer_available').notNull(),
    officialAvailable: money('official_available').notNull(),
    /** Diagnóstico: no participa en la comparación (D-C3, §80). */
    committed: money('committed').notNull(),
    /** `officialAvailable - letferAvailable`. */
    difference: money('difference').notNull(),
    status: reconciliationStatusEnum('status').notNull(),
    performedBy: uuid('performed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    invalidatedAt: timestamptz('invalidated_at'),
    invalidatedReason: text('invalidated_reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('reconciliation_checkpoints_house_idx').on(table.houseId, table.occurredAt),
    index('reconciliation_checkpoints_project_idx').on(table.projectId),
    check('reconciliation_checkpoints_letfer_available_nonneg', sql`${table.letferAvailable} >= 0`),
    check(
      'reconciliation_checkpoints_official_available_nonneg',
      sql`${table.officialAvailable} >= 0`,
    ),
    check('reconciliation_checkpoints_committed_nonneg', sql`${table.committed} >= 0`),
    check(
      'reconciliation_checkpoints_invalidation_shape',
      sql`(${table.status} = 'INVALIDATED') = (${table.invalidatedAt} IS NOT NULL)
          AND (${table.status} = 'INVALIDATED') = (${table.invalidatedReason} IS NOT NULL)`,
    ),
  ],
);

export type ReconciliationCheckpointRow = typeof reconciliationCheckpoints.$inferSelect;
export type NewReconciliationCheckpoint = typeof reconciliationCheckpoints.$inferInsert;
