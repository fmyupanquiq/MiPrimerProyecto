import type { AuditLogPage } from '@letfer/shared';
import { apiFetch } from './client.js';
import { toQueryString } from './query.js';

/** Filtros del visor de auditoría (§111.1). Todos opcionales. */
export interface AuditQuery {
  cursor?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
}

export const auditApi = {
  list: (projectId: string, query: AuditQuery = {}) =>
    apiFetch<AuditLogPage>(`/projects/${projectId}/audit-logs${toQueryString({ ...query })}`),
};

export const adminAuditApi = {
  list: (query: AuditQuery & { system?: boolean | undefined } = {}) =>
    apiFetch<AuditLogPage>(`/admin/audit-logs${toQueryString({ ...query })}`),
};
