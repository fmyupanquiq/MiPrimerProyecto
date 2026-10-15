import type { ReportData, ReportFilters, ReportPdfQuery } from '@letfer/shared';
import { apiBlob, apiFetch } from './client.js';

/** Parámetros de consulta sin vacíos (los arrays se envían separados por comas). */
function queryOf(params: Record<string, string | readonly string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, typeof value === 'string' ? value : value.join(','));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** Opciones del PDF tal como las envía la web (las secciones como lista). */
export type ReportPdfParams = ReportFilters &
  Omit<Partial<ReportPdfQuery>, keyof ReportFilters | 'sections'> & {
    sections: readonly string[];
  };

/** Reportes e informes PDF (§108.11). */
export const reportsApi = {
  data: (projectId: string, filters: ReportFilters) =>
    apiFetch<ReportData>(`/projects/${projectId}/reports/data${queryOf({ ...filters })}`),
  pdf: (projectId: string, params: ReportPdfParams) =>
    apiBlob(`/projects/${projectId}/reports/pdf${queryOf({ ...params })}`, 'application/pdf'),
};
