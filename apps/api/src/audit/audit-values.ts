import { isDeepStrictEqual } from 'node:util';

export type AuditValues = Record<string, unknown>;

export interface AuditDiff {
  oldValues: AuditValues;
  newValues: AuditValues;
}

/** Claves que nunca deben acabar en la auditoría, ni siquiera por error. */
const SENSITIVE_KEY = /password|secret|token|hash|pepper/i;
export const REDACTED = '[REDACTED]';

/** Normaliza un valor para compararlo y guardarlo como JSON (las fechas pasan a ISO 8601). */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

/** Sustituye por `[REDACTED]` los valores de claves sensibles (recursivo). */
export function redactSensitive(values: AuditValues): AuditValues {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? REDACTED : walk(item),
        ]),
      );
    }
    return value;
  };
  return walk(normalize(values)) as AuditValues;
}

/**
 * Diferencias campo por campo entre dos estados (§24, §35). Solo incluye los campos que
 * cambiaron (dentro de `fields`, si se indica). Devuelve `null` si no hay cambios.
 */
export function diffFields(
  before: AuditValues,
  after: AuditValues,
  fields?: readonly string[],
): AuditDiff | null {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  for (const key of keys) {
    const previous = normalize(before[key]);
    const next = normalize(after[key]);
    if (!isDeepStrictEqual(previous, next)) {
      oldValues[key] = previous ?? null;
      newValues[key] = next ?? null;
    }
  }
  return Object.keys(newValues).length === 0 ? null : { oldValues, newValues };
}
