import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Módulo único de dinero (§94, ADR 0004). Nadie más redondea ni hace aritmética financiera:
 * toda cifra de dinero pasa por aquí. En TypeScript nunca se usa `number` para dinero; los
 * valores viajan como cadenas decimales exactas (`"195.48"`), tal como se guardan en
 * `NUMERIC(18,2)` en PostgreSQL.
 */

/** Decimales de una cifra de dinero en soles (céntimos, §94). */
export const MONEY_SCALE = 2;

/** Cadena decimal de dinero: como viaja por la API y se guarda en `NUMERIC(18,2)`. */
export type MoneyString = string;

/** `0.00`, el punto de partida de cualquier saldo. */
export const ZERO_MONEY: MoneyString = '0.00';

/**
 * decimal.js con precisión amplia (para sumar muchas filas sin perder dígitos antes de
 * redondear al final) y `ROUND_HALF_UP`: la política de redondeo aprobada para valores
 * *calculados* por LetFer (ADR 0004). Los valores oficiales de la casa nunca pasan por aquí:
 * se guardan tal como llegan.
 */
const MoneyDecimal = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP, precision: 40 });

// Entero opcional de hasta 16 dígitos y hasta 2 decimales; sin notación científica ni espacios.
const MONEY_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;

/** ¿Es una cadena de dinero bien formada (signo opcional, hasta 2 decimales)? */
export function isMoneyString(value: string): value is MoneyString {
  return MONEY_PATTERN.test(value);
}

/**
 * Analiza un valor decimal para la aritmética interna: acepta cualquier número finito, sin
 * limitar los decimales (a diferencia de `isMoneyString`, que es la validación *estricta* de
 * entrada/salida a 2 decimales). Así `roundMoney` puede redondear un valor con más precisión
 * en vez de exigir que ya venga redondeado.
 */
function toDecimal(value: MoneyString | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  try {
    const decimal = new MoneyDecimal(value.trim());
    if (!decimal.isFinite()) throw new Error('no finito');
    return decimal;
  } catch {
    throw new Error(`"${value}" no es una cifra de dinero válida (se esperaba p. ej. "195.48").`);
  }
}

/** Redondea a 2 decimales (`ROUND_HALF_UP`) y devuelve la forma canónica, p. ej. `"195.50"`. */
export function roundMoney(value: MoneyString | Decimal): MoneyString {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE).toFixed(MONEY_SCALE);
}

/** Suma cualquier cantidad de cifras de dinero (vacío = `ZERO_MONEY`). */
export function addMoney(...values: (MoneyString | Decimal)[]): MoneyString {
  return roundMoney(
    values.reduce((total: Decimal, value) => total.plus(toDecimal(value)), new MoneyDecimal(0)),
  );
}

/** Suma una lista de cifras de dinero (equivalente a `addMoney(...values)`, para `values` dinámicos). */
export function sumMoney(values: readonly (MoneyString | Decimal)[]): MoneyString {
  return addMoney(...values);
}

/** `a - b`. Puede dar negativo: quien llama decide si eso es un error de negocio. */
export function subtractMoney(a: MoneyString | Decimal, b: MoneyString | Decimal): MoneyString {
  return roundMoney(toDecimal(a).minus(toDecimal(b)));
}

/** Compara dos cifras de dinero: -1 si `a < b`, 0 si son iguales, 1 si `a > b`. */
export function compareMoney(a: MoneyString | Decimal, b: MoneyString | Decimal): -1 | 0 | 1 {
  const result = toDecimal(a).comparedTo(toDecimal(b));
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

export const isZeroMoney = (value: MoneyString | Decimal): boolean => toDecimal(value).isZero();
export const isPositiveMoney = (value: MoneyString | Decimal): boolean =>
  toDecimal(value).isPositive() && !isZeroMoney(value);
export const isNegativeMoney = (value: MoneyString | Decimal): boolean =>
  toDecimal(value).isNegative();

/**
 * Cifra de dinero recibida del usuario: exactamente como la escribió, sin redondear en
 * silencio (si trae más de 2 decimales, se rechaza en vez de recortarla). `nonNegative`
 * (por defecto) exige `>= 0`; con `positive: true` exige `> 0` (p. ej. un depósito o la
 * unidad de una etapa no pueden ser cero).
 */
export function moneyInputSchema(options: { positive?: boolean } = {}) {
  return (
    z
      .string()
      .trim()
      .refine(isMoneyString, { message: 'Ingresa un monto válido, con hasta 2 decimales.' })
      // Las siguientes comprobaciones solo tienen sentido si ya es una cifra de dinero válida;
      // si no, se dejan pasar para no ocultar el mensaje del refine anterior con la excepción.
      .refine((value) => !isMoneyString(value) || !isNegativeMoney(value), {
        message: 'El monto no puede ser negativo.',
      })
      .refine((value) => !isMoneyString(value) || !options.positive || isPositiveMoney(value), {
        message: 'El monto debe ser mayor que cero.',
      })
      .transform((value) => roundMoney(value))
  );
}

/** Formato de presentación en soles, p. ej. `"S/ 1,234.50"`. Solo para mostrar; nunca para calcular. */
export function formatPEN(value: MoneyString): string {
  const decimal = toDecimal(value);
  const formatted = new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: MONEY_SCALE,
    maximumFractionDigits: MONEY_SCALE,
  }).format(decimal.toNumber());
  return `S/ ${formatted}`;
}
