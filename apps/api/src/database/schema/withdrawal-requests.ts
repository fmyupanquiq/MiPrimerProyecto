import { WITHDRAWAL_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { money, primaryId, timestamps, timestamptz, versionColumn } from './columns.js';
import { financialMovements } from './financial-movements.js';
import { houses } from './houses.js';
import { projects } from './projects.js';
import { stages } from './stages.js';
import { users } from './users.js';

export const withdrawalStatusEnum = pgEnum('withdrawal_status', WITHDRAWAL_STATUSES);

/**
 * Solicitudes de retiro (§16.2, §79, D5). El monto se reserva de inmediato al solicitarse
 * (cuenta como comprometido, §17) y solo se convierte en salida financiera efectiva —una fila
 * de `financial_movements`— al aprobarse. Rechazar o cancelar libera la reserva sin dejar
 * rastro en el ledger. Nunca se elimina físicamente.
 */
export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
    reason: text('reason').notNull(),
    status: withdrawalStatusEnum('status').notNull().default('PENDING'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamptz('decided_at'),
    decisionReason: text('decision_reason'),
    /** Solo cuando `status = 'APPROVED'`: el movimiento definitivo que generó. */
    movementId: uuid('movement_id').references(() => financialMovements.id, {
      onDelete: 'restrict',
    }),
    ...timestamps(),
    version: versionColumn(),
  },
  (table) => [
    index('withdrawal_requests_project_idx').on(table.projectId, table.status),
    index('withdrawal_requests_house_idx').on(table.houseId, table.status),
    check('withdrawal_requests_amount_positive', sql`${table.amount} > 0`),
    check('withdrawal_requests_reason_not_blank', sql`length(btrim(${table.reason})) > 0`),
    check(
      'withdrawal_requests_status_shape',
      sql`(${table.status} = 'PENDING'
            AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL AND ${table.movementId} IS NULL)
          OR (${table.status} = 'APPROVED'
            AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.movementId} IS NOT NULL)
          OR (${table.status} IN ('REJECTED', 'CANCELLED')
            AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.movementId} IS NULL)`,
    ),
  ],
);

export type WithdrawalRequestRow = typeof withdrawalRequests.$inferSelect;
export type NewWithdrawalRequest = typeof withdrawalRequests.$inferInsert;
