import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';
import { users } from './users.js';

/**
 * Tokens de recuperación de contraseña (§84, §104.4). Como las sesiones, solo se guarda el hash
 * SHA-256 del token: quien lea la base de datos no puede restablecer contraseñas ajenas.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamptz('created_at').notNull(),
    /** Vence 1 hora después de la solicitud (§104.4). */
    expiresAt: timestamptz('expires_at').notNull(),
    /** Cuándo se usó (un solo uso). */
    usedAt: timestamptz('used_at'),
    /** Cuándo lo invalidó una solicitud posterior. */
    invalidatedAt: timestamptz('invalidated_at'),
    requestedIp: text('requested_ip'),
  },
  (table) => [index('password_reset_tokens_user_idx').on(table.userId, table.createdAt)],
);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
