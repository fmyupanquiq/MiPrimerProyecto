import type {
  BetDetail,
  BetListStatus,
  BetSummary,
  CreateBetInput,
  MoveBetStageInput,
  SettleBetInput,
  TrashBetInput,
  UpdateBetInput,
} from '@letfer/shared';
import { apiFetch } from './client.js';

export const betsApi = {
  list: (projectId: string, status?: BetListStatus) =>
    apiFetch<BetSummary[]>(`/projects/${projectId}/bets${status ? `?status=${status}` : ''}`),
  detail: (projectId: string, betId: string) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}`),
  create: (projectId: string, input: CreateBetInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets`, { method: 'POST', body: input }),
  update: (projectId: string, betId: string, input: UpdateBetInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}`, { method: 'PATCH', body: input }),
  settle: (projectId: string, betId: string, input: SettleBetInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}/settle`, {
      method: 'POST',
      body: input,
    }),
  moveStage: (projectId: string, betId: string, input: MoveBetStageInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}/move-stage`, {
      method: 'POST',
      body: input,
    }),
  trash: (projectId: string, betId: string, input: TrashBetInput) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/bets/${betId}/trash`, {
      method: 'POST',
      body: input,
    }),
  restore: (projectId: string, betId: string) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/bets/${betId}/restore`, { method: 'POST' }),
};
