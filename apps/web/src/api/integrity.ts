import type { IntegrityCheckRunSummary } from '@letfer/shared';
import { apiFetch } from './client.js';

export const integrityApi = {
  list: (projectId: string) =>
    apiFetch<IntegrityCheckRunSummary[]>(`/projects/${projectId}/integrity-checks`),
  run: (projectId: string) =>
    apiFetch<IntegrityCheckRunSummary>(`/projects/${projectId}/integrity-checks`, {
      method: 'POST',
    }),
};

export const adminIntegrityApi = {
  list: () => apiFetch<IntegrityCheckRunSummary[]>('/admin/integrity-checks'),
  run: () => apiFetch<IntegrityCheckRunSummary>('/admin/integrity-checks', { method: 'POST' }),
};
