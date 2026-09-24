import type { TicketAnalysisSummary, TicketSummary } from '@letfer/shared';
import { apiFetch, apiUpload } from './client.js';

export const ticketsApi = {
  upload: (projectId: string, file: File) =>
    apiUpload<TicketSummary>(`/projects/${projectId}/tickets`, file),
  /** D-T4: acción explícita, nunca automática al subir. */
  analyze: (projectId: string, ticketId: string) =>
    apiFetch<TicketAnalysisSummary>(`/projects/${projectId}/tickets/${ticketId}/analyze`, {
      method: 'POST',
    }),
  analyses: (projectId: string, ticketId: string) =>
    apiFetch<TicketAnalysisSummary[]>(`/projects/${projectId}/tickets/${ticketId}/analyses`),
};
