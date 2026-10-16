import { formatPEN } from '@letfer/shared';
import type { Tone } from './theme.js';

/*
 * Formatos de presentación del PDF. Solo dan forma a cifras que ya llegan calculadas: no calculan.
 */

const isZero = (value: string) => /^-?0+(\.0+)?$/.test(value);

/** `+S/ 19.00`, `-S/ 20.00`, `S/ 0.00`. */
export function signedPEN(value: string): string {
  if (value.startsWith('-')) return `-${formatPEN(value.slice(1))}`;
  if (isZero(value)) return formatPEN(value);
  return `+${formatPEN(value)}`;
}

/** Porcentaje de la API con signo: `+13.70 %`; `—` si no está definido. */
export function percent(value: string | null, signed = true): string {
  if (value === null) return '—';
  const sign = signed && !value.startsWith('-') && !isZero(value) ? '+' : '';
  return `${sign}${value} %`;
}

/** Porcentaje con UN decimal (redondeo sobre la cadena, sin coma flotante). */
export function pct1(value: string | null, signed = true): string {
  if (value === null) return '—';
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace(/^[-+]/, '').split('.');
  const hundredths = BigInt(int) * 100n + BigInt(`${frac}00`.slice(0, 2));
  const tenths = (hundredths + 5n) / 10n;
  const text = `${tenths / 10n}.${tenths % 10n}`;
  if (tenths === 0n) return `${text} %`;
  return `${negative ? '-' : signed ? '+' : ''}${text} %`;
}

export function toneOf(value: string | null): Tone {
  if (value === null || isZero(value)) return 'neutral';
  return value.startsWith('-') ? 'negative' : 'positive';
}

/** Fecha (`dd/mm/aaaa`) y hora (`HH:mm`) de un instante en la zona del proyecto. */
export function dateParts(
  iso: string,
  timeZone: string,
): { date: string; time: string; short: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts['day']}/${parts['month']}/${parts['year']}`,
    time: `${parts['hour']}:${parts['minute']}`,
    short: `${parts['day']}/${parts['month']}`,
  };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
/** «6 oct» (eje de fechas). */
export function axisDate(iso: string, timeZone: string): string {
  const { date } = dateParts(iso, timeZone);
  const [d, m] = date.split('/');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** Recorta un texto a un ancho con «…» (una línea). */
export function fit(doc: PDFKit.PDFDocument, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Parte un texto en líneas que caben en `width` con la fuente activa (por palabras; una palabra más
 * larga que la línea se corta). Como mucho `max` líneas: la última lleva «…» solo si sobra texto.
 */
export function wrap(doc: PDFKit.PDFDocument, text: string, width: number, max = 99): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (doc.widthOfString(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    while (doc.widthOfString(current) > width && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && doc.widthOfString(current.slice(0, cut)) > width) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) return [''];
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fit(doc, `${kept[max - 1]} ${lines.slice(max).join(' ')}`, width);
  return kept;
}
