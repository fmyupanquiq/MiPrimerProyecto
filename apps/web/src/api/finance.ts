import type {
  CorrectStageUnitInput,
  CreateDepositInput,
  CreateExtraordinaryMovementInput,
  CreateHouseInput,
  CreateStageInput,
  CreateTransferInput,
  DecideWithdrawalInput,
  HouseSummary,
  MovementSummary,
  ProjectDetail,
  ProjectSetupInput,
  RequestWithdrawalInput,
  StageStatus,
  StageSummary,
  StageUnitCorrectionPreview,
  WithdrawalRequestSummary,
} from '@letfer/shared';
import { apiFetch } from './client.js';

export const projectSetupApi = {
  complete: (projectId: string, input: ProjectSetupInput) =>
    apiFetch<ProjectDetail>(`/projects/${projectId}/setup`, { method: 'POST', body: input }),
};

export const stagesApi = {
  list: (projectId: string, status?: StageStatus) =>
    apiFetch<StageSummary[]>(`/projects/${projectId}/stages${status ? `?status=${status}` : ''}`),
  create: (projectId: string, input: CreateStageInput) =>
    apiFetch<StageSummary>(`/projects/${projectId}/stages`, { method: 'POST', body: input }),
  correctUnit: (projectId: string, stageId: string, input: CorrectStageUnitInput) =>
    apiFetch<StageSummary | StageUnitCorrectionPreview>(
      `/projects/${projectId}/stages/${stageId}/unit`,
      { method: 'POST', body: input },
    ),
  trash: (projectId: string, stageId: string) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/stages/${stageId}/trash`, { method: 'POST' }),
  restore: (projectId: string, stageId: string) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/stages/${stageId}/restore`, {
      method: 'POST',
    }),
};

export const housesApi = {
  list: (projectId: string) => apiFetch<HouseSummary[]>(`/projects/${projectId}/houses`),
  create: (projectId: string, input: CreateHouseInput) =>
    apiFetch<HouseSummary>(`/projects/${projectId}/houses`, { method: 'POST', body: input }),
  deactivate: (projectId: string, houseId: string) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/houses/${houseId}/deactivate`, {
      method: 'POST',
    }),
  activate: (projectId: string, houseId: string) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/houses/${houseId}/activate`, {
      method: 'POST',
    }),
};

export const movementsApi = {
  list: (projectId: string) => apiFetch<MovementSummary[]>(`/projects/${projectId}/movements`),
  deposit: (projectId: string, input: CreateDepositInput) =>
    apiFetch<MovementSummary>(`/projects/${projectId}/movements/deposits`, {
      method: 'POST',
      body: input,
    }),
  transfer: (projectId: string, input: CreateTransferInput) =>
    apiFetch<MovementSummary>(`/projects/${projectId}/movements/transfers`, {
      method: 'POST',
      body: input,
    }),
  extraordinary: (projectId: string, input: CreateExtraordinaryMovementInput) =>
    apiFetch<MovementSummary>(`/projects/${projectId}/movements/extraordinary`, {
      method: 'POST',
      body: input,
    }),
};

export const withdrawalsApi = {
  list: (projectId: string) =>
    apiFetch<WithdrawalRequestSummary[]>(`/projects/${projectId}/withdrawals`),
  request: (projectId: string, input: RequestWithdrawalInput) =>
    apiFetch<WithdrawalRequestSummary>(`/projects/${projectId}/withdrawals`, {
      method: 'POST',
      body: input,
    }),
  approve: (projectId: string, withdrawalId: string, input: DecideWithdrawalInput) =>
    apiFetch<WithdrawalRequestSummary>(
      `/projects/${projectId}/withdrawals/${withdrawalId}/approve`,
      { method: 'POST', body: input },
    ),
  reject: (projectId: string, withdrawalId: string, input: DecideWithdrawalInput) =>
    apiFetch<WithdrawalRequestSummary>(
      `/projects/${projectId}/withdrawals/${withdrawalId}/reject`,
      {
        method: 'POST',
        body: input,
      },
    ),
  cancel: (projectId: string, withdrawalId: string, input: DecideWithdrawalInput) =>
    apiFetch<WithdrawalRequestSummary>(
      `/projects/${projectId}/withdrawals/${withdrawalId}/cancel`,
      {
        method: 'POST',
        body: input,
      },
    ),
};
