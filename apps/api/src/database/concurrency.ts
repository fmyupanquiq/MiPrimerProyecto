import { isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** La fila fue modificada por otra operación desde que se leyó (§96). */
export class ConcurrencyConflictError extends Error {
  constructor(readonly entity: string) {
    super(`El registro de "${entity}" cambió mientras se editaba; recarga e inténtalo de nuevo.`);
    this.name = 'ConcurrencyConflictError';
  }
}

/**
 * Valor para `.set({ version: nextVersion(table.version) })`.
 * Se usa junto con `eq(table.version, versionEsperada)` en el `WHERE`.
 */
export const nextVersion = (column: AnyPgColumn): SQL => sql`${column} + 1`;

/**
 * Comprueba el resultado de un `UPDATE ... WHERE id = ? AND version = ? RETURNING *`:
 * si no se actualizó ninguna fila, otra operación modificó el registro (o no existe).
 */
export function expectUpdated<T>(rows: T[], entity: string): T {
  const [row] = rows;
  if (!row) throw new ConcurrencyConflictError(entity);
  return row;
}

/** Filtro de registros no eliminados lógicamente. */
export const notDeleted = (deletedAt: AnyPgColumn): SQL => isNull(deletedAt);

/** Valores para marcar un registro como eliminado lógicamente. */
export function softDeleteValues(input: { now: Date; reason?: string | undefined }) {
  return { deletedAt: input.now, deletionReason: input.reason ?? null };
}

/** Valores para restaurar un registro eliminado lógicamente. */
export function restoreValues() {
  return { deletedAt: null, deletionReason: null };
}
