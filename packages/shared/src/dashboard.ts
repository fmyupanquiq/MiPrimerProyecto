import { z } from 'zod';
import { BET_STATUSES, BET_TYPES } from './bet.js';
import type { MoneyString } from './money.js';

/**
 * Dashboard y métricas (§33, §34, §59 a §60, §91, §92, §108). Nada se guarda: todo se calcula en
 * consulta (D-M10) a partir de `bets`, `bet_selections`, `financial_movements`, `stages` y
 * `houses`, ya existentes desde las Fases 3 y 4.
 */

/** Granularidad de "rendimiento temporal" (§108.7); agrupa por `settledAt`, no por `placedAt`. */
export const DASHBOARD_PERIODS = ['day', 'week', 'month'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Filtros del §33: ninguno modifica la realidad financiera (regla crítica 13). */
export const dashboardFiltersSchema = z.object({
  stageId: z.uuid().optional(),
  houseId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sport: z.string().trim().min(1).optional(),
  market: z.string().trim().min(1).optional(),
  betType: z.enum(BET_TYPES).optional(),
  userId: z.uuid().optional(),
  status: z.enum(BET_STATUSES).optional(),
  period: z.enum(DASHBOARD_PERIODS).default('month'),
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

/** Conteo de apuestas por estado; Cash Out es un bucket propio (D-M5, §108.6). */
export interface BetStatusCounts {
  total: number;
  pending: number;
  won: number;
  lost: number;
  void: number;
  cashout: number;
}

export interface DashboardHouseBalance {
  houseId: string;
  houseName: string;
  balance: MoneyString;
  committed: MoneyString;
  available: MoneyString;
}

/** `GET /dashboard/status` (§33 "Estado financiero actual"): sin filtros, la foto de ahora mismo. */
export interface DashboardStatus {
  capitalActual: MoneyString;
  disponible: MoneyString;
  comprometido: MoneyString;
  porCasa: DashboardHouseBalance[];
  conteoApuestas: BetStatusCounts;
}

/**
 * Un grupo de un desglose (por casa/etapa/deporte/mercado/periodo). `key` es el nombre a mostrar;
 * `'Mixto'` cuando una apuesta múltiple no comparte deporte/mercado entre sus selecciones
 * (D-M4, §108.5): nunca se cuenta su P/L en más de un grupo.
 */
export interface DashboardBreakdownItem {
  key: string;
  profitLoss: MoneyString;
  /** P/L ÷ monto apostado × 100; `null` si no hay monto apostado en el grupo (D-M1, §108.1). */
  yield: MoneyString | null;
  totalStaked: MoneyString;
  count: number;
}

/** `GET /dashboard/analysis` (§33 "Análisis filtrado"): P/L, Yield, ROI, conteos y desgloses. */
export interface DashboardAnalysis {
  profitLoss: MoneyString;
  /** P/L ÷ total apostado × 100 (D-M1). */
  yield: MoneyString | null;
  /** P/L ÷ capital invertido × 100 (D-M1): banca inicial + depósitos netos del periodo. */
  roi: MoneyString | null;
  totalStaked: MoneyString;
  capitalInvested: MoneyString;
  deposits: MoneyString;
  withdrawals: MoneyString;
  extraordinary: MoneyString;
  counts: BetStatusCounts;
  byHouse: DashboardBreakdownItem[];
  byStage: DashboardBreakdownItem[];
  bySport: DashboardBreakdownItem[];
  byMarket: DashboardBreakdownItem[];
  /** Ordenado cronológicamente; `key` es la etiqueta del periodo (p. ej. `"2026-06"`). */
  byPeriod: DashboardBreakdownItem[];
}

export interface BankrollPoint {
  occurredAt: string;
  /** Saldo acumulado real de banca en ese instante (§34; nunca reinicia al cambiar de etapa). */
  balance: MoneyString;
  /** Solo presente en el punto donde empezó una etapa nueva (§34: marcador de cambio de etapa). */
  stageStarted: { id: string; name: string } | null;
}

/** `GET /dashboard/bankroll-chart`: evolución de banca real, con todo incluido (§108.3). */
export interface BankrollChart {
  points: BankrollPoint[];
}

export interface PerformancePoint {
  occurredAt: string;
  /** Acumulado exclusivo de liquidaciones de apuestas (§91, §108.3): sin depósitos/retiros/etc. */
  cumulativeProfitLoss: MoneyString;
  /** Pico histórico hasta este punto menos el valor en este punto (§108.4). */
  drawdown: MoneyString;
  /** `drawdown ÷ pico × 100`; `null` si el pico todavía es cero. */
  drawdownPercent: MoneyString | null;
}

/** `GET /dashboard/performance-chart`: curva de rendimiento y drawdown (D-M3, D-M6, §108.3-4). */
export interface PerformanceChart {
  points: PerformancePoint[];
  maxDrawdown: MoneyString;
  maxDrawdownPercent: MoneyString | null;
}
