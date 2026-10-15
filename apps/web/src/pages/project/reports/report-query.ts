import {
  DEFAULT_REPORT_SECTIONS,
  type BetStatus,
  type BetType,
  type ReportFilters,
  type ReportGroupBy,
  type ReportOrigin,
  type ReportSection,
  type ReportSortBy,
} from '@letfer/shared';
import { endOfDayInstant, startOfDayInstant } from '../../../date-inputs.js';
import { addCalendarDays } from '../../../time-zone.js';
import { addMonths, monthBounds } from '../dashboard/date-range.js';

/*
 * Estado del constructor de reportes (§108.11). Las fechas son días de la ZONA DEL PROYECTO; solo al
 * pedir los datos se convierten a instantes. Lo que se aplica aquí es exactamente lo que piden el
 * panel y el PDF: los dos usan `toReportFilters` del mismo estado aplicado.
 */

export interface ReportDraft {
  /** `AAAA-MM-DD` o vacío (sin límite). */
  from: string;
  to: string;
  houseId: string;
  betType: '' | BetType;
  status: '' | BetStatus;
  origin: '' | ReportOrigin;
  sport: string;
  market: string;
  stageId: string;
}

export const EMPTY_DRAFT: ReportDraft = {
  from: '',
  to: '',
  houseId: '',
  betType: '',
  status: '',
  origin: '',
  sport: '',
  market: '',
  stageId: '',
};

export interface ReportOptions {
  sections: ReportSection[];
  groupBy: ReportGroupBy;
  sortBy: ReportSortBy;
  direction: 'asc' | 'desc';
  orientation: 'portrait' | 'landscape';
  paper: 'A4' | 'LETTER';
}

export const DEFAULT_OPTIONS: ReportOptions = {
  sections: [...DEFAULT_REPORT_SECTIONS],
  groupBy: 'none',
  sortBy: 'date',
  direction: 'desc',
  orientation: 'portrait',
  paper: 'A4',
};

/** Atajos de rango (los de la referencia, más mes y año). */
export const RANGE_SHORTCUTS = [
  { key: 'ALL', label: 'Todas' },
  { key: '7D', label: 'Últimos 7 días' },
  { key: '30D', label: 'Últimos 30 días' },
  { key: '90D', label: 'Últimos 90 días' },
] as const;
export const MORE_SHORTCUTS = [
  { key: 'MONTH', label: 'Mes actual' },
  { key: 'PREV_MONTH', label: 'Mes anterior' },
  { key: 'YEAR', label: 'Año actual' },
] as const;
export type RangeShortcut =
  (typeof RANGE_SHORTCUTS)[number]['key'] | (typeof MORE_SHORTCUTS)[number]['key'];

export function shortcutRange(key: RangeShortcut, today: string): { from: string; to: string } {
  switch (key) {
    case 'ALL':
      return { from: '', to: '' };
    case '7D':
      return { from: addCalendarDays(today, -6), to: today };
    case '30D':
      return { from: addCalendarDays(today, -29), to: today };
    case '90D':
      return { from: addCalendarDays(today, -89), to: today };
    case 'MONTH':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'PREV_MONTH':
      return monthBounds(addMonths(today.slice(0, 7), -1));
    case 'YEAR':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Qué atajo coincide con un rango (para resaltarlo). */
export function activeShortcut(
  draft: Pick<ReportDraft, 'from' | 'to'>,
  today: string,
): RangeShortcut | null {
  for (const s of [...RANGE_SHORTCUTS, ...MORE_SHORTCUTS]) {
    const r = shortcutRange(s.key, today);
    if (r.from === draft.from && r.to === draft.to) return s.key;
  }
  return null;
}

/** ¿El rango es válido (o vacío)? */
export const validRange = (d: Pick<ReportDraft, 'from' | 'to'>) =>
  !d.from || !d.to || d.from <= d.to;

/** Filtros para la API: días → instantes de inicio y fin de día en la zona del proyecto. */
export function toReportFilters(d: ReportDraft): ReportFilters {
  const filters: ReportFilters = {};
  if (d.from) filters.from = startOfDayInstant(d.from);
  if (d.to) filters.to = endOfDayInstant(d.to);
  if (d.houseId) filters.houseId = d.houseId;
  if (d.betType) filters.betType = d.betType;
  if (d.status) filters.status = d.status;
  if (d.origin) filters.origin = d.origin;
  if (d.sport) filters.sport = d.sport;
  if (d.market) filters.market = d.market;
  if (d.stageId) filters.stageId = d.stageId;
  return filters;
}

const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Etiqueta del periodo: «01/10/2026 - 31/10/2026», «Desde 01/10/2026» o «Todo el historial». */
export function periodLabel(d: Pick<ReportDraft, 'from' | 'to'>): string {
  if (d.from && d.to) return `${dmy(d.from)} - ${dmy(d.to)}`;
  if (d.from) return `Desde ${dmy(d.from)}`;
  if (d.to) return `Hasta ${dmy(d.to)}`;
  return 'Todo el historial';
}

/** Nombre de archivo propuesto y saneado: `LetFer_Reporte_<proyecto>_<desde>_<hasta>.pdf`. */
export function defaultFileName(projectName: string, d: Pick<ReportDraft, 'from' | 'to'>): string {
  const period = d.from && d.to ? `_${d.from}_${d.to}` : '_historial';
  return sanitizeFileName(`LetFer_Reporte_${projectName}${period}`);
}

export function sanitizeFileName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 100);
  return `${base || 'LetFer_Reporte'}.pdf`;
}
