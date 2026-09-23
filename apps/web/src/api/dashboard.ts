import type {
  BankrollChart,
  BetStatus,
  BetType,
  DashboardAnalysis,
  DashboardPeriod,
  DashboardStatus,
  PerformanceChart,
} from '@letfer/shared';
import { apiFetch } from './client.js';

/** Filtros del tablero de análisis (§33, §108), tal como los elige la persona usuaria en la web. */
export interface DashboardAnalysisFilters {
  stageId?: string;
  houseId?: string;
  from?: string;
  to?: string;
  sport?: string;
  market?: string;
  betType?: BetType;
  userId?: string;
  status?: BetStatus;
  period?: DashboardPeriod;
}

function queryOf(filters: DashboardAnalysisFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters) as [string, string | undefined][]) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const dashboardApi = {
  status: (projectId: string) =>
    apiFetch<DashboardStatus>(`/projects/${projectId}/dashboard/status`),
  analysis: (projectId: string, filters: DashboardAnalysisFilters = {}) =>
    apiFetch<DashboardAnalysis>(`/projects/${projectId}/dashboard/analysis${queryOf(filters)}`),
  bankrollChart: (projectId: string) =>
    apiFetch<BankrollChart>(`/projects/${projectId}/dashboard/bankroll-chart`),
  performanceChart: (projectId: string) =>
    apiFetch<PerformanceChart>(`/projects/${projectId}/dashboard/performance-chart`),
};
