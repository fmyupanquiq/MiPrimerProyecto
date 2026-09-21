import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';
import { users } from './users.js';

/**
 * Sesiones abiertas (§3). El token de sesión es un valor aleatorio de 256 bits que solo
 * conoce el cliente: aquí se guarda únicamente su hash SHA-256, de modo que una filtración
 * de la base de datos no permite suplantar sesiones (§41).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** SHA-256 (hex) del token de sesión. */
    tokenHash: text('token_hash').notNull().unique(),
    /** `true` si el usuario marcó "Mantener sesión iniciada" (§104.2). */
    persistent: boolean('persistent').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Último uso; base de la expiración por inactividad. */
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    /** Expiración absoluta: la sesión termina en este instante aunque siga activa. */
    expiresAt: timestamptz('expires_at').notNull(),
    /** Segundos de inactividad tras los cuales la sesión expira. */
    idleTimeoutSeconds: integer('idle_timeout_seconds').notNull(),
    /** Última confirmación de contraseña (inicio de sesión o reautenticación, §39). */
    reauthenticatedAt: timestamptz('reauthenticated_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamptz('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (table) => [index('sessions_user_idx').on(table.userId, table.revokedAt)],
);

export type SessionRow = typeof sessions.$inferSelect;
