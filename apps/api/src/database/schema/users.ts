import { SYSTEM_ROLES, USER_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, softDeleteColumns, timestamps, timestamptz, versionColumn } from './columns.js';

export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const systemRoleEnum = pgEnum('system_role', SYSTEM_ROLES);

/**
 * Usuarios (§2). El `id` es la identidad canónica y permanente: cambiar nombre o correo no
 * rompe la atribución histórica. Nunca se eliminan físicamente (disparador `prevent_delete`);
 * el borrado es lógico (`status = 'DELETED'` con `deleted_at`, §8 y §104.6).
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    /** Correo en su forma canónica (sin espacios y en minúsculas); es único sin distinguir mayúsculas. */
    email: text('email').notNull(),
    /** Hash argon2id en formato PHC. Nunca se expone ni se audita. */
    passwordHash: text('password_hash').notNull(),
    /** Referencia al avatar. La subida de archivos llega con Object Storage (Fase 7). */
    avatarRef: text('avatar_ref'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    systemRole: systemRoleEnum('system_role').notNull().default('USER'),
    lastLoginAt: timestamptz('last_login_at'),
    passwordChangedAt: timestamptz('password_changed_at').notNull().defaultNow(),
    ...timestamps(),
    version: versionColumn(),
    ...softDeleteColumns(),
    deletedBy: uuid('deleted_by').references((): AnyPgColumn => users.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    check(
      'users_deleted_consistency',
      sql`(${table.status} = 'DELETED') = (${table.deletedAt} IS NOT NULL)`,
    ),
    check(
      'users_names_not_blank',
      sql`length(btrim(${table.firstName})) > 0 AND length(btrim(${table.lastName})) > 0`,
    ),
    check(
      'users_email_format',
      sql`${table.email} = btrim(${table.email}) AND length(${table.email}) BETWEEN 3 AND 254`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
