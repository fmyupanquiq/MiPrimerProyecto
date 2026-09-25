import type { MaintenanceRunSummary } from '@letfer/shared';
import { apiFetch } from './client.js';

export const maintenanceApi = {
  runs: () => apiFetch<MaintenanceRunSummary[]>('/admin/maintenance/runs'),
  purge: () => apiFetch<MaintenanceRunSummary>('/admin/maintenance/purge', { method: 'POST' }),
};
