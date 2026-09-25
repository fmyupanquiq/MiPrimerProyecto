import { ACCOUNT_DELETION_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz, versionColumn } from './columns.js';
import { users } from './users.js';

export const accountDeletionStatusEnum = pgEnum(
  'account_deletion_status',
  ACCOUNT_DELETION_STATUSES,
);

/**
 * Solicitudes de eliminación de cuenta (§8, §111.3, D8-5). Mismo ciclo que
 * `withdrawal_requests` (D5): la persona usuaria solicita; solo el Administrador Global aprueba
 * o rechaza; quien solicitó puede cancelar mientras siga pendiente. Aprobar deja la cuenta
 * eliminada lógicamente (§104.6), nunca de forma física. Una sola solicitud pendiente por
 * usuario (índice único parcial). Nunca se elimina físicamente.
 */
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: accountDeletionStatusEnum('status').notNull().default('PENDING'),
    /** Motivo que da la persona al solicitar. */
    reason: text('reason'),
    /** Quién decidió: el Administrador Global al aprobar o rechazar; la propia persona al cancelar. */
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamptz('decided_at'),
    decisionReason: text('decision_reason'),
    ...timestamps(),
    version: versionColumn(),
  },
  (table) => [
    index('account_deletion_requests_status_idx').on(table.status, table.createdAt),
    index('account_deletion_requests_user_idx').on(table.userId, table.createdAt),
    uniqueIndex('account_deletion_requests_one_pending')
      .on(table.userId)
      .where(sql`${table.status} = 'PENDING'`),
    check(
      'account_deletion_requests_status_shape',
      sql`(${table.status} = 'PENDING' AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL)
          OR (${table.status} <> 'PENDING' AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
  ],
);

export type AccountDeletionRequestRow = typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest = typeof accountDeletionRequests.$inferInsert;
