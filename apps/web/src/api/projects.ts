import type {
  AcceptInvitationResult,
  AssignableRole,
  CreatedInvitation,
  CreateInvitationInput,
  DateFormat,
  InvitationPreview,
  InvitationSummary,
  MemberListFilter,
  MemberSummary,
  ProjectDetail,
  ProjectSummary,
} from '@letfer/shared';
import { apiFetch } from './client.js';

export interface NewProject {
  name: string;
  description?: string;
  timezone?: string;
  dateFormat?: DateFormat;
}

export interface ProjectChanges {
  name?: string;
  description?: string;
  timezone?: string;
  dateFormat?: DateFormat;
  version: number;
}

export const projectsApi = {
  list: (scope: 'mine' | 'all' = 'mine') =>
    apiFetch<ProjectSummary[]>(scope === 'all' ? '/projects?scope=all' : '/projects'),
  trash: () => apiFetch<ProjectSummary[]>('/projects/trash'),
  get: (id: string) => apiFetch<ProjectDetail>(`/projects/${id}`),
  create: (input: NewProject) =>
    apiFetch<ProjectDetail>('/projects', { method: 'POST', body: input }),
  update: (id: string, input: ProjectChanges) =>
    apiFetch<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: input }),
  close: (id: string) => apiFetch<ProjectDetail>(`/projects/${id}/close`, { method: 'POST' }),
  reopen: (id: string) => apiFetch<ProjectDetail>(`/projects/${id}/reopen`, { method: 'POST' }),
  sendToTrash: (id: string, reason?: string) =>
    apiFetch<{ id: string; status: 'TRASHED' }>(`/projects/${id}/trash`, {
      method: 'POST',
      body: reason ? { reason } : {},
    }),
  restore: (id: string) => apiFetch<ProjectDetail>(`/projects/${id}/restore`, { method: 'POST' }),
  transferOwnership: (id: string, newOwnerId: string) =>
    apiFetch<ProjectDetail>(`/projects/${id}/transfer-ownership`, {
      method: 'POST',
      body: { newOwnerId },
    }),
};

export const membersApi = {
  list: (projectId: string, status: MemberListFilter = 'ACTIVE') =>
    apiFetch<MemberSummary[]>(`/projects/${projectId}/members?status=${status}`),
  assignableRoles: (projectId: string) =>
    apiFetch<AssignableRole[]>(`/projects/${projectId}/assignable-roles`),
  changeRole: (projectId: string, userId: string, input: { roleId: string; version: number }) =>
    apiFetch<MemberSummary>(`/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: input,
    }),
  remove: (projectId: string, userId: string, reason?: string) =>
    apiFetch<void>(`/projects/${projectId}/members/${userId}`, {
      method: 'DELETE',
      body: reason ? { reason } : {},
    }),
  leave: (projectId: string) => apiFetch<void>(`/projects/${projectId}/leave`, { method: 'POST' }),
};

export const invitationsApi = {
  list: (projectId: string) => apiFetch<InvitationSummary[]>(`/projects/${projectId}/invitations`),
  create: (projectId: string, input: CreateInvitationInput) =>
    apiFetch<CreatedInvitation>(`/projects/${projectId}/invitations`, {
      method: 'POST',
      body: input,
    }),
  disable: (projectId: string, invitationId: string) =>
    apiFetch<InvitationSummary>(`/projects/${projectId}/invitations/${invitationId}/disable`, {
      method: 'POST',
    }),
  preview: (token: string) =>
    apiFetch<InvitationPreview>('/invitations/preview', { method: 'POST', body: { token } }),
  accept: (token: string) =>
    apiFetch<AcceptInvitationResult>('/invitations/accept', { method: 'POST', body: { token } }),
  reject: (token: string) =>
    apiFetch<void>('/invitations/reject', { method: 'POST', body: { token } }),
};
