import { PERMISSION_SCOPES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, softDeleteColumns, timestamps, versionColumn } from './columns.js';

export const permissionScopeEnum = pgEnum('permission_scope', PERMISSION_SCOPES);

/**
 * Catálogo de permisos (§47). Los códigos los define `@letfer/shared` y se sincronizan al
 * arrancar; aquí solo se guardan para poder relacionarlos con los roles.
 */
export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  scope: permissionScopeEnum('scope').notNull(),
  description: text('description').notNull(),
});

/**
 * Roles (§4.5, §47). Los roles de sistema tienen `key` y `is_system`; los roles personalizados
 * (sin interfaz en la Fase 2) no tienen clave y, si son de proyecto, llevan `project_id`.
 */
export const roles = pgTable(
  'roles',
  {
    id: primaryId(),
    key: text('key'),
    scope: permissionScopeEnum('scope').notNull(),
    /** Solo en roles personalizados de un proyecto. La clave foránea se declara con `projects`. */
    projectId: uuid('project_id'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
    version: versionColumn(),
    ...softDeleteColumns(),
  },
  (table) => [
    uniqueIndex('roles_system_key_unique')
      .on(table.key)
      .where(sql`${table.key} IS NOT NULL`),
    uniqueIndex('roles_project_name_unique')
      .on(table.projectId, table.name)
      .where(sql`${table.projectId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    check(
      'roles_system_shape',
      sql`(${table.isSystem} = (${table.key} IS NOT NULL)) AND (NOT ${table.isSystem} OR ${table.projectId} IS NULL)`,
    ),
    check('roles_project_scope', sql`${table.projectId} IS NULL OR ${table.scope} = 'PROJECT'`),
  ],
);

/** Permisos que otorga cada rol. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })],
);

export type RoleRow = typeof roles.$inferSelect;
