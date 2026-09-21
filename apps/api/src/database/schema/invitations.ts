import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz, versionColumn } from './columns.js';
import { projects } from './projects.js';
import { roles } from './rbac.js';
import { users } from './users.js';

/**
 * Invitaciones a un proyecto (§84, §105.7). Solo se guarda el hash SHA-256 del token (256 bits):
 * el enlace se muestra una única vez al crearla. El estado (ACTIVE, ACCEPTED, EXPIRED, DISABLED) no
 * se guarda: se calcula al consultar. Nunca se eliminan físicamente.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    /** Rol con el que ingresa quien acepta; lo define quien invita, dentro de su límite (§105.2). */
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    singleUse: boolean('single_use').notNull(),
    /** `null`: sin vencimiento, hasta desactivarla manualmente. */
    expiresAt: timestamptz('expires_at'),
    /** Correo (en minúsculas) al que se restringe la invitación, si se indicó. */
    restrictedEmail: text('restricted_email'),
    /** Consumo de una invitación de un solo uso (atómico, lo garantiza la base de datos). */
    consumedAt: timestamptz('consumed_at'),
    consumedBy: uuid('consumed_by').references(() => users.id, { onDelete: 'restrict' }),
    disabledAt: timestamptz('disabled_at'),
    disabledBy: uuid('disabled_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
    version: versionColumn(),
  },
  (table) => [
    uniqueIndex('invitations_token_hash_unique').on(table.tokenHash),
    index('invitations_project_idx').on(table.projectId, table.createdAt),
    check(
      'invitations_email_normalized',
      sql`${table.restrictedEmail} IS NULL OR ${table.restrictedEmail} = lower(btrim(${table.restrictedEmail}))`,
    ),
    check(
      'invitations_consumed_consistency',
      sql`(${table.consumedAt} IS NULL) = (${table.consumedBy} IS NULL)`,
    ),
    check(
      'invitations_consumed_single_use',
      sql`${table.consumedAt} IS NULL OR ${table.singleUse}`,
    ),
    check(
      'invitations_disabled_consistency',
      sql`(${table.disabledAt} IS NULL) = (${table.disabledBy} IS NULL)`,
    ),
  ],
);

/**
 * Aceptaciones de invitaciones (§105.7): quién ingresó con cuál invitación. Una fila por
 * (invitación, usuario); aceptar por segunda vez es idempotente y no crea otra.
 */
export const invitationAcceptances = pgTable(
  'invitation_acceptances',
  {
    id: primaryId(),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => invitations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** `ADDED` (primera vez) o `REACTIVATED` (volvió a un proyecto que había dejado). */
    outcome: text('outcome').notNull(),
    acceptedAt: timestamptz('accepted_at').notNull(),
  },
  (table) => [
    uniqueIndex('invitation_acceptances_unique').on(table.invitationId, table.userId),
    index('invitation_acceptances_user_idx').on(table.userId),
    check('invitation_acceptances_outcome', sql`${table.outcome} IN ('ADDED', 'REACTIVATED')`),
  ],
);

export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type InvitationAcceptanceRow = typeof invitationAcceptances.$inferSelect;
