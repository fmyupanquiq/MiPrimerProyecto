import type {
  AccountDeletionRequestSummary,
  AccountDeletionStatus,
  AdminUserDetail,
  AdminUserPage,
  DecideAccountDeletionInput,
  MyAccountDeletionState,
  SetUserStatusInput,
  UserStatus,
} from '@letfer/shared';
import { apiFetch } from './client.js';
import { toQueryString } from './query.js';

export interface AdminUsersQuery {
  status?: UserStatus | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export const adminUsersApi = {
  list: (query: AdminUsersQuery = {}) =>
    apiFetch<AdminUserPage>(`/admin/users${toQueryString({ ...query })}`),
  get: (userId: string) => apiFetch<AdminUserDetail>(`/admin/users/${userId}`),
  disable: (userId: string, input: SetUserStatusInput) =>
    apiFetch<AdminUserDetail>(`/admin/users/${userId}/disable`, { method: 'POST', body: input }),
  enable: (userId: string, input: SetUserStatusInput) =>
    apiFetch<AdminUserDetail>(`/admin/users/${userId}/enable`, { method: 'POST', body: input }),
};

export const accountDeletionsApi = {
  mine: () => apiFetch<MyAccountDeletionState>('/users/me/deletion-request'),
  request: (reason?: string) =>
    apiFetch<AccountDeletionRequestSummary>('/users/me/deletion-request', {
      method: 'POST',
      body: reason ? { reason } : {},
    }),
  cancel: () =>
    apiFetch<AccountDeletionRequestSummary>('/users/me/deletion-request', { method: 'DELETE' }),
  list: (status?: AccountDeletionStatus) =>
    apiFetch<AccountDeletionRequestSummary[]>(
      `/admin/account-deletions${toQueryString({ status })}`,
    ),
  approve: (requestId: string, input: DecideAccountDeletionInput) =>
    apiFetch<AccountDeletionRequestSummary>(`/admin/account-deletions/${requestId}/approve`, {
      method: 'POST',
      body: input,
    }),
  reject: (requestId: string, input: DecideAccountDeletionInput) =>
    apiFetch<AccountDeletionRequestSummary>(`/admin/account-deletions/${requestId}/reject`, {
      method: 'POST',
      body: input,
    }),
};
