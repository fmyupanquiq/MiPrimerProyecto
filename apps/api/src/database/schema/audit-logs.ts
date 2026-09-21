import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';
import { projects } from './projects.js';
import { users } from './users.js';

/**
 * Registro de auditoría (§10, §35). Es inmutable: los disparadores de la migración
 * `audit_logs_immutable` rechazan UPDATE, DELETE y TRUNCATE.

 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    /** Usuario que ejecutó la acción; nulo para acciones anónimas o del sistema. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    /** Acción, p. ej. `auth.login.succeeded`. */
    action: text('action').notNull(),
    /** Tipo de registro afectado, p. ej. `user`. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    oldValues: jsonb('old_values').$type<Record<string, unknown>>(),
    newValues: jsonb('new_values').$type<Record<string, unknown>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    sessionId: uuid('session_id'),
    requestId: text('request_id'),
  },
  (table) => [
    index('audit_logs_occurred_at_idx').on(table.occurredAt),
    index('audit_logs_actor_idx').on(table.actorUserId, table.occurredAt),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_project_idx').on(table.projectId, table.occurredAt),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
