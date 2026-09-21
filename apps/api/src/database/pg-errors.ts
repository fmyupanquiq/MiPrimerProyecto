/** Códigos SQLSTATE de PostgreSQL que la aplicación reconoce. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
/** Devuelto por los disparadores que impiden borrar o modificar (`restrict_violation`). */
export const PG_RESTRICT_VIOLATION = '23001';

interface WithCode {
  code?: unknown;
  cause?: unknown;
}

/**
 * Extrae el SQLSTATE de un error de `pg`, que Drizzle envuelve en `cause`.
 * Devuelve `undefined` si el error no proviene de PostgreSQL.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const { code, cause } = current as WithCode;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}

/** Nombre de la restricción violada, si PostgreSQL lo informa. */
export function pgConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const { constraint, cause } = current as { constraint?: unknown; cause?: unknown };
    if (typeof constraint === 'string') return constraint;
    current = cause;
  }
  return undefined;
}
