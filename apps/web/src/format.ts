import { formatPEN } from '@letfer/shared';

/*
 * Presentación de cifras (Fase 10.3). Solo dan formato a valores que llegan de la API o del
 * cálculo compartido: no calculan nada.
 */

/** Importe con signo explícito: `+S/ 19.00`, `-S/ 20.00`, `S/ 0.00`. El signo no depende del color. */
export function signedPEN(value: string): string {
  if (value.startsWith('-')) return `-${formatPEN(value.slice(1))}`;
  if (/^0+(\.0+)?$/.test(value)) return formatPEN(value);
  return `+${formatPEN(value)}`;
}

/** Color semántico de un resultado: verde si suma, rojo si resta, neutro si es cero. */
export function moneyTone(value: string | null): string {
  if (value === null || /^-?0+(\.0+)?$/.test(value)) return 'text-slate-700';
  return value.startsWith('-') ? 'text-red-700' : 'text-green-700';
}

/** Stake sin ceros de relleno: `2.0000` → `2`, `1.5000` → `1.5`. */
export function formatStake(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * Porcentaje de la API (dos decimales, p. ej. `"12.85"`) con UN decimal y signo explícito:
 * `+12.9%`, `-3.4%`, `0.0%`. Redondeo half-up sobre la cadena (sin pasar por coma flotante).
 */
export function formatPercent(value: string, { signed = true } = {}): string {
  const negative = value.startsWith('-');
  const [integer = '0', fraction = ''] = value.replace(/^[-+]/, '').split('.');
  const hundredths = BigInt(integer) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  const tenths = (hundredths + 5n) / 10n;
  const text = `${tenths / 10n}.${tenths % 10n}`;
  if (tenths === 0n) return `${text}%`;
  if (negative) return `-${text}%`;
  return `${signed ? '+' : ''}${text}%`;
}

/** Tono de un porcentaje o importe con signo: verde, rojo o neutro (`null` = sin dato). */
export function signTone(value: string | null): 'positive' | 'negative' | 'neutral' {
  if (value === null || /^-?0+(\.0+)?$/.test(value)) return 'neutral';
  return value.startsWith('-') ? 'negative' : 'positive';
}
