import { bigint, boolean, index, pgTable, text } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';

/**
 * Intentos de acceso por correo (§41, §104.3). Se indexan por correo normalizado, no por
 * usuario, para que un correo inexistente se comporte exactamente igual que uno existente.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: primaryId(),
    /**
     * Orden de inserción, monótono. Sirve para saber si un fallo ocurrió después del último
     * acceso correcto sin depender de la resolución del reloj.
     */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    emailNormalized: text('email_normalized').notNull(),
    ip: text('ip'),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: timestamptz('attempted_at').notNull(),
  },
  (table) => [index('login_attempts_email_idx').on(table.emailNormalized, table.attemptedAt)],
);

export type LoginAttemptRow = typeof loginAttempts.$inferSelect;
