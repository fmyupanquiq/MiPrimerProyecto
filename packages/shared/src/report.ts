import { z } from 'zod';
import {
  BET_STATUSES,
  BET_TYPES,
  type BetStatus,
  type BetType,
  type TotalOddsSource,
} from './bet.js';
import { BET_ORIGINS, type BetOrigin, type DashboardAnalysis } from './dashboard.js';
import type { MoneyString } from './money.js';
import type { OddsString } from './odds.js';

/*
 * Reportes e informes PDF (§108.11). Un reporte es una LECTURA: reutiliza el análisis del dashboard
 * (`GET /dashboard/analysis`, mismas definiciones de P/L, Yield, ROI, win rate y cuota media) y la
 * misma selección de apuestas (mismos filtros y semántica de fechas). Nunca escribe nada.
 */

/** Secciones del PDF que se pueden incluir o quitar. */
export const REPORT_SECTIONS = [
  'summary',
  'metrics',
  'table',
  'selections',
  'tickets',
  'charts',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const DEFAULT_REPORT_SECTIONS: readonly ReportSection[] = [
  'summary',
  'metrics',
  'table',
  'selections',
  'charts',
];

export const REPORT_GROUP_BY = ['none', 'date', 'house', 'status', 'betType'] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];
export const REPORT_SORT_BY = ['date', 'amount', 'odds', 'profit'] as const;
export type ReportSortBy = (typeof REPORT_SORT_BY)[number];
export const REPORT_ORIGINS = BET_ORIGINS;
export type ReportOrigin = BetOrigin;

/** Máximo de apuestas de un reporte: por encima se pide acotar el periodo (memoria y tiempo). */
export const REPORT_MAX_BETS = 5000;

/**
 * Filtros de un reporte: los del análisis del dashboard (§33) más el origen del registro. El rango
 * `from`/`to` se aplica, como en el dashboard, a la fecha de liquidación o, si la apuesta sigue
 * pendiente, a la de colocación.
 */
export const reportFiltersSchema = z.object({
  stageId: z.uuid().optional(),
  houseId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sport: z.string().trim().min(1).optional(),
  market: z.string().trim().min(1).optional(),
  betType: z.enum(BET_TYPES).optional(),
  status: z.enum(BET_STATUSES).optional(),
  origin: z.enum(REPORT_ORIGINS).optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

/** Opciones del documento (además de los filtros). */
export const reportPdfQuerySchema = reportFiltersSchema.extend({
  sections: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return [...DEFAULT_REPORT_SECTIONS];
      const list = value.split(',').filter(Boolean);
      for (const item of list) {
        if (!(REPORT_SECTIONS as readonly string[]).includes(item)) {
          ctx.addIssue({ code: 'custom', message: `Sección desconocida: ${item}` });
        }
      }
      return [...new Set(list)] as ReportSection[];
    }),
  groupBy: z.enum(REPORT_GROUP_BY).default('none'),
  sortBy: z.enum(REPORT_SORT_BY).default('date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  paper: z.enum(['A4', 'LETTER']).default('A4'),
  /** Etiqueta del periodo tal como la ve la persona (p. ej. «01/10/2026 - 31/10/2026»). */
  periodLabel: z.string().trim().max(80).optional(),
});
export type ReportPdfQuery = z.infer<typeof reportPdfQuerySchema>;

/** Un leg de la apuesta: su cuota (una sola vez) y sus condiciones (varias si es una Creada). */
export interface ReportLeg {
  event: string;
  sport: string | null;
  /** Cuota del leg (fila `position = 0`); `null` si no se registró (p. ej. importadas). */
  odds: OddsString | null;
  conditions: { market: string | null; selection: string }[];
}

export interface ReportBet {
  id: string;
  placedAt: string;
  placedTimeKnown: boolean;
  settledAt: string | null;
  houseName: string;
  stageName: string;
  betType: BetType;
  status: BetStatus;
  origin: ReportOrigin;
  stake: string;
  /** Monto efectivo de la apuesta (oficial o `stake × unidad`, §76). */
  amount: MoneyString;
  visibleTotalOdds: OddsString;
  totalOddsSource: TotalOddsSource;
  /**
   * Ganancia/pérdida según el LEDGER (§112.6), la misma que suma el análisis; `null` si está
   * pendiente. `provisional` si el retorno es calculado y aún no se confirmó.
   */
  profitLoss: MoneyString | null;
  provisional: boolean;
  legs: ReportLeg[];
  ticketCount: number;
}

/** Totales de la tabla del reporte (salen de las mismas filas que el análisis). */
export interface ReportTotals {
  bets: number;
  /** Monto apostado de las liquidadas (= `analysis.totalStaked`). */
  stakedSettled: MoneyString;
  /** Monto comprometido por las pendientes (suma de sus montos efectivos). */
  stakedPending: MoneyString;
  /** Retornos realizados de las liquidadas (monto apostado + ganancia neta). */
  returns: MoneyString;
  profitLoss: MoneyString;
}

export interface ReportBetTypeRow {
  betType: BetType;
  bets: number;
  winRate: MoneyString | null;
  roi: MoneyString | null;
  yield: MoneyString | null;
}

/** `GET /reports/data`: todo lo que pinta el panel y el PDF, con el mismo alcance. */
export interface ReportData {
  generatedAt: string;
  analysis: DashboardAnalysis;
  totals: ReportTotals;
  byBetType: ReportBetTypeRow[];
  /** Ganancia/pérdida acumulada de las liquidadas, en orden de liquidación. */
  cumulative: { index: number; settledAt: string; cumulative: MoneyString }[];
  bets: ReportBet[];
}

/**
 * Orden de presentación de las apuestas de un reporte, el MISMO en el panel y en el PDF. Solo
 * ordena (las cifras se comparan como números únicamente para decidir la posición); empates, por
 * fecha de colocación.
 */
export function sortReportBets(
  bets: readonly ReportBet[],
  sortBy: ReportSortBy,
  direction: 'asc' | 'desc',
): ReportBet[] {
  const factor = direction === 'asc' ? 1 : -1;
  const num = (v: string | null) => (v === null ? Number.NEGATIVE_INFINITY : Number(v));
  const key = (b: ReportBet): number =>
    sortBy === 'amount'
      ? num(b.amount)
      : sortBy === 'odds'
        ? num(b.visibleTotalOdds)
        : sortBy === 'profit'
          ? num(b.profitLoss)
          : new Date(b.placedAt).getTime();
  return [...bets].sort(
    (a, b) => (key(a) - key(b)) * factor || a.placedAt.localeCompare(b.placedAt) * factor,
  );
}
