import { HOUSE_STATUSES } from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns.js';
import { projects } from './projects.js';

export const houseStatusEnum = pgEnum('house_status', HOUSE_STATUSES);

/**
 * Casas de apuestas (§13). Cuentas financieras por proyecto; catálogo libre, sin catálogo
 * global (D7). Nunca se eliminan físicamente (integridad financiera): solo se desactivan
 * (y pueden reactivarse). El saldo no se guarda aquí (D3): se reconstruye desde
 * `financial_movements` en cada consulta.
 */
export const houses = pgTable(
  'houses',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: houseStatusEnum('status').notNull().default('ACTIVE'),
    ...timestamps(),
  },
  (table) => [
    index('houses_project_idx').on(table.projectId, table.status),
    check('houses_name_not_blank', sql`length(btrim(${table.name})) > 0`),
  ],
);

export type HouseRow = typeof houses.$inferSelect;
export type NewHouse = typeof houses.$inferInsert;
