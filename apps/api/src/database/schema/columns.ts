import { integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** Genera un identificador UUIDv7 (ordenado en el tiempo, ADR 0005). */
export const newId = (): string => uuidv7();

/** Clave primaria UUIDv7 generada en la aplicación. */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => newId());

/** Instante con zona horaria; siempre se almacena en UTC (§93). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * `created_at` y `updated_at` (§55, §102). `updated_at` lo mantiene el disparador
 * `set_updated_at` de la base de datos, no la aplicación.
 */
export const timestamps = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Versión para control de concurrencia optimista (§96). */
export const versionColumn = () => integer('version').notNull().default(1);

/**
 * Columnas de borrado lógico (§81). `deleted_by` se declara en cada tabla porque su
 * clave foránea apunta a `users`.
 */
export const softDeleteColumns = () => ({
  deletedAt: timestamptz('deleted_at'),
  deletionReason: text('deletion_reason'),
});
