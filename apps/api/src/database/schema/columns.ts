import { integer, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

/**
 * Cifra de dinero: `NUMERIC(18,2)` (ADR 0004, §94). Se lee y escribe como cadena
 * (`MoneyString` en `@letfer/shared`), nunca como `number`: el módulo único de dinero
 * es la única parte del código que hace aritmética con estos valores.
 */
export const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

/**
 * Cuota decimal: `NUMERIC(12,6)` (ADR 0004, §22, §94; regla crítica 5). Nunca se redondea
 * destructivamente en almacenamiento: se guarda tal como la escribió quien registra la apuesta.
 */
export const odds = (name: string) => numeric(name, { precision: 12, scale: 6 });

/** Stake: multiplicador numérico, nunca un porcentaje (regla crítica 1, §12). `NUMERIC(10,4)`. */
export const stake = (name: string) => numeric(name, { precision: 10, scale: 4 });
