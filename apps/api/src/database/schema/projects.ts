import {
  DATE_FORMATS,
  DEFAULT_CURRENCY,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIMEZONE,
  PROJECT_STATUSES,
  SUPPORTED_CURRENCIES,
} from '@letfer/shared';
import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, softDeleteColumns, timestamps, timestamptz, versionColumn } from './columns.js';
import { users } from './users.js';

export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES);
export const dateFormatEnum = pgEnum('date_format', DATE_FORMATS);

const currencies = SUPPORTED_CURRENCIES.map((currency) => `'${currency}'`).join(', ');

/**
 * Proyectos (§5, §85, §105). Aíslan equipos, banca, casas, etapas, apuestas y auditoría.
 * Nunca se eliminan físicamente: la papelera es un estado (`TRASHED`) restaurable (§9).
 */
export const projects = pgTable(
  'projects',
  {
    id: primaryId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Referencia a la imagen. La subida de archivos llega con Object Storage (Fase 7). */
    imageRef: text('image_ref'),
    /** Propietario: atributo adicional a su membresía (§87). Solo el Administrador Global lo transfiere. */
    ownerId: uuid('owner_id')
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull().default(DEFAULT_CURRENCY),
    /** Zona horaria IANA (§93). */
    timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
    dateFormat: dateFormatEnum('date_format').notNull().default(DEFAULT_DATE_FORMAT),
    status: projectStatusEnum('status').notNull().default('ACTIVE'),
    /** Estado al que vuelve el proyecto al restaurarlo de la papelera. */
    previousStatus: projectStatusEnum('previous_status'),
    /** A partir de esta fecha el proyecto es elegible para purga (papelera + 90 días, §89). */
    purgeEligibleAt: timestamptz('purge_eligible_at'),
    ...timestamps(),
    version: versionColumn(),
    ...softDeleteColumns(),
    deletedBy: uuid('deleted_by').references((): AnyPgColumn => users.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('projects_owner_idx').on(table.ownerId),
    index('projects_status_idx').on(table.status),
    check(
      'projects_trash_consistency',
      sql`(${table.status} = 'TRASHED') = (${table.deletedAt} IS NOT NULL)
        AND (${table.status} = 'TRASHED') = (${table.previousStatus} IS NOT NULL)
        AND (${table.status} = 'TRASHED') = (${table.purgeEligibleAt} IS NOT NULL)`,
    ),
    check(
      'projects_previous_status_valid',
      sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('ACTIVE', 'CLOSED')`,
    ),
    check('projects_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    check('projects_timezone_not_blank', sql`length(btrim(${table.timezone})) > 0`),
    check('projects_currency_supported', sql.raw(`"currency" IN (${currencies})`)),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
