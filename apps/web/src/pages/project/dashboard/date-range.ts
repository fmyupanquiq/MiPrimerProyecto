import { endOfDayInstant, startOfDayInstant } from '../../../date-inputs.js';
import { addCalendarDays } from '../../../time-zone.js';

/*
 * Rango de fechas del Dashboard (rediseño 2026-10-15, §108.10). Las fechas son días calendario
 * (`AAAA-MM-DD`) de la ZONA DEL PROYECTO; solo al pedir el análisis se convierten a instantes
 * (`startOfDayInstant`/`endOfDayInstant`, que leen la zona del proyecto). Nada aquí es dinero: solo
 * elige qué periodo se pide a la API.
 */

export const RANGE_PRESETS = [
  { key: '7D', label: 'Últimos 7 días' },
  { key: '30D', label: 'Últimos 30 días' },
  { key: 'MONTH', label: 'Este mes' },
  { key: 'PREV_MONTH', label: 'Mes anterior' },
  { key: '3M', label: 'Últimos 3 meses' },
  { key: 'YEAR', label: 'Este año' },
  { key: 'ALL', label: 'Todo el proyecto' },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]['key'] | 'CUSTOM';

export const DEFAULT_PRESET: RangePreset = '30D';

export interface DateRange {
  preset: RangePreset;
  /** Primer día incluido; `null` en "Todo el proyecto". */
  from: string | null;
  /** Último día incluido; `null` en "Todo el proyecto". */
  to: string | null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, '0');

/** ¿Es un día calendario real (`AAAA-MM-DD`)? */
export function isCalendarDate(value: string | null): value is string {
  const match = value ? DATE.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** Último día del mes `AAAA-MM`. */
function lastDayOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(new Date(Date.UTC(year, m, 0)).getUTCDate())}`;
}

/** Suma `months` meses a un mes `AAAA-MM`. */
export function addMonths(month: string, months: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(year, m - 1 + months, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
}

/** Primer y último día de un mes `AAAA-MM`. */
export const monthBounds = (month: string) => ({
  from: `${month}-01`,
  to: lastDayOfMonth(month),
});

/** Días que cubre cada atajo, contados hasta `today` (incluido). */
export function presetRange(preset: RangePreset, today: string): DateRange {
  const month = today.slice(0, 7);
  switch (preset) {
    case '7D':
      return { preset, from: addCalendarDays(today, -6), to: today };
    case '30D':
      return { preset, from: addCalendarDays(today, -29), to: today };
    case 'MONTH':
      return { preset, from: `${month}-01`, to: today };
    case 'PREV_MONTH':
      return { preset, ...monthBounds(addMonths(month, -1)) };
    case '3M': {
      // El mismo día de hace tres meses (o el último de ese mes, si no existe), más uno.
      const target = addMonths(month, -3);
      const day = Math.min(Number(today.slice(8)), Number(lastDayOfMonth(target).slice(8)));
      return { preset, from: addCalendarDays(`${target}-${pad(day)}`, 1), to: today };
    }
    case 'YEAR':
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'ALL':
      return { preset, from: null, to: null };
    case 'CUSTOM':
      return { preset, from: today, to: today };
  }
}

/**
 * Rango a partir de la URL: `?rango=todo` es todo el proyecto; `?desde&hasta` válidos, el atajo que
 * coincida (o uno personalizado); cualquier otra cosa, el rango por defecto (últimos 30 días).
 */
export function rangeFromSearch(params: URLSearchParams, today: string): DateRange {
  if (params.get('rango') === 'todo') return presetRange('ALL', today);
  const from = params.get('desde');
  const to = params.get('hasta');
  if (isCalendarDate(from) && isCalendarDate(to) && from <= to) {
    const match = RANGE_PRESETS.find((p) => {
      const range = presetRange(p.key, today);
      return range.from === from && range.to === to;
    });
    return { preset: match?.key ?? 'CUSTOM', from, to };
  }
  return presetRange(DEFAULT_PRESET, today);
}

/** Parámetros de la URL de un rango (el rango por defecto no deja ninguno). */
export function rangeToSearch(range: DateRange, today: string): Record<string, string> {
  if (range.preset === 'ALL') return { rango: 'todo' };
  const fallback = presetRange(DEFAULT_PRESET, today);
  if (range.from === fallback.from && range.to === fallback.to) return {};
  return range.from && range.to ? { desde: range.from, hasta: range.to } : {};
}

/** `from`/`to` del análisis: instantes de inicio y fin de día en la zona del proyecto. */
export function rangeFilters(range: DateRange): { from?: string; to?: string } {
  return {
    from: range.from ? startOfDayInstant(range.from) : undefined,
    to: range.to ? endOfDayInstant(range.to) : undefined,
  };
}

/** Un día calendario como `20 set. 2024` (sin pasar por la zona del navegador). */
export function formatCalendarDate(date: string, withYear = true): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** Texto del botón del selector: `20 set. 2024 - 12 oct. 2024` o «Todo el proyecto». */
export function rangeLabel(range: DateRange): string {
  if (!range.from || !range.to) return 'Todo el proyecto';
  return `${formatCalendarDate(range.from)} - ${formatCalendarDate(range.to)}`;
}

/** `Octubre 2024` para un mes `AAAA-MM`. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const name = new Date(Date.UTC(year, m - 1, 15)).toLocaleDateString('es-PE', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** Meses desde `first` hasta `last` (ambos `AAAA-MM`), del más reciente al más antiguo. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = last; month >= first && months.length < 600; month = addMonths(month, -1)) {
    months.push(month);
  }
  return months;
}
