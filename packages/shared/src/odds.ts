import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Cuotas decimales de una apuesta (§22, §23, §94; regla crítica 5). A diferencia del dinero
 * (`money.ts`), una cuota **nunca se redondea destructivamente** en el almacenamiento: se
 * conserva tal como la escribió quien registra la apuesta, hasta 6 decimales de precisión
 * (`NUMERIC(12,6)`).
 */

/** Decimales de precisión de una cuota (ADR 0004). */
export const ODDS_SCALE = 6;

/** Cadena decimal de una cuota, p. ej. `"1.9548"`; como se guarda en `NUMERIC(12,6)`. */
export type OddsString = string;

// Entero opcional de hasta 6 dígitos y hasta 6 decimales; sin notación científica ni espacios.
const ODDS_PATTERN = /^\d{1,6}(\.\d{1,6})?$/;

const OddsDecimal = Decimal.clone({ precision: 40 });

/** ¿Es una cadena de cuota bien formada (positiva, hasta 6 decimales)? */
export function isOddsString(value: string): value is OddsString {
  return ODDS_PATTERN.test(value);
}

function toOddsDecimal(value: OddsString): Decimal {
  try {
    const decimal = new OddsDecimal(value.trim());
    if (!decimal.isFinite()) throw new Error('no finito');
    return decimal;
  } catch {
    throw new Error(`"${value}" no es una cuota válida (se esperaba p. ej. "1.95").`);
  }
}

// `Decimal.isPositive()` de decimal.js es en realidad "no negativo": devuelve `true` para 0.
// Hay que descartar el cero explícitamente para una positividad estricta (mismo cuidado que
// `isPositiveMoney` en `money.ts`).
export const isPositiveOdds = (value: OddsString): boolean => {
  const decimal = toOddsDecimal(value);
  return decimal.isPositive() && !decimal.isZero();
};

/**
 * Cuota recibida del usuario: exactamente como la escribió, sin redondear ni recortar en
 * silencio (regla crítica 5). Rechaza más de 6 decimales en vez de truncarlos.
 */
export function oddsInputSchema() {
  return z
    .string()
    .trim()
    .refine(isOddsString, { message: 'Ingresa una cuota válida, con hasta 6 decimales.' })
    .refine((value) => !isOddsString(value) || isPositiveOdds(value), {
      message: 'La cuota debe ser mayor que cero.',
    });
}

/** Formato de presentación de una cuota, p. ej. `"1.95"`. Solo para mostrar; nunca para calcular. */
export function formatOdds(value: OddsString, decimals = 2): string {
  return toOddsDecimal(value).toDecimalPlaces(decimals).toFixed(decimals);
}

/**
 * Cuota efectiva derivada = `retorno oficial ÷ monto efectivo` (§22, §77): diagnóstica, nunca
 * sustituye a `visible_total_odds` (regla crítica 6). `null` cuando no hay un retorno positivo
 * conocido que dividir (apuesta pendiente, perdida, o un monto efectivo de cero).
 */
export function deriveEffectiveOdds(
  realizedReturn: string,
  effectiveAmount: string,
): OddsString | null {
  if (!isPositiveOdds(effectiveAmount) || !isPositiveOdds(realizedReturn)) return null;
  return toOddsDecimal(realizedReturn)
    .dividedBy(toOddsDecimal(effectiveAmount))
    .toDecimalPlaces(ODDS_SCALE)
    .toString();
}
