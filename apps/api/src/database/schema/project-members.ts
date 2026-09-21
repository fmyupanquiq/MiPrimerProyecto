import { MEMBER_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz, versionColumn } from './columns.js';
import { projects } from './projects.js';
import { roles } from './rbac.js';
import { users } from './users.js';

export const memberStatusEnum = pgEnum('member_status', MEMBER_STATUSES);

/**
 * Membresías (§6, §47, §105.4). Una fila por (proyecto, usuario): si el usuario se va, lo
 * expulsan o vuelve, se reutiliza la misma fila y su historial permanece asociado a su identidad
 * (§2). Nunca se eliminan físicamente. Un disparador impide quitar o degradar al propietario.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: memberStatusEnum('status').notNull().default('ACTIVE'),
    /** Inicio de la incorporación vigente (se renueva si vuelve a incorporarse). */
    joinedAt: timestamptz('joined_at').notNull(),
    leftAt: timestamptz('left_at'),
    removedAt: timestamptz('removed_at'),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'restrict' }),
    removalReason: text('removal_reason'),
    ...timestamps(),
    version: versionColumn(),
  },
  (table) => [
    uniqueIndex('project_members_project_user_unique').on(table.projectId, table.userId),
    index('project_members_user_idx').on(table.userId, table.status),
    check(
      'project_members_left_consistency',
      sql`(${table.status} = 'LEFT') = (${table.leftAt} IS NOT NULL)`,
    ),
    check(
      'project_members_removed_consistency',
      sql`(${table.status} = 'REMOVED') = (${table.removedAt} IS NOT NULL)`,
    ),
  ],
);

export type ProjectMemberRow = typeof projectMembers.$inferSelect;
