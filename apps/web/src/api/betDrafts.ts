import type {
  BetDraftDetail,
  BetDraftSummary,
  SaveBetDraftInput,
  UpdateBetDraftInput,
} from '@letfer/shared';
import { apiFetch } from './client.js';

/** Borradores de "Añadir apuesta" (ADR 0024): solo los del propio usuario en el proyecto. */
export const betDraftsApi = {
  list: (projectId: string) => apiFetch<BetDraftSummary[]>(`/projects/${projectId}/bet-drafts`),
  get: (projectId: string, draftId: string) =>
    apiFetch<BetDraftDetail>(`/projects/${projectId}/bet-drafts/${draftId}`),
  create: (projectId: string, input: SaveBetDraftInput) =>
    apiFetch<BetDraftDetail>(`/projects/${projectId}/bet-drafts`, { method: 'POST', body: input }),
  update: (projectId: string, draftId: string, input: UpdateBetDraftInput) =>
    apiFetch<BetDraftDetail>(`/projects/${projectId}/bet-drafts/${draftId}`, {
      method: 'PUT',
      body: input,
    }),
  discard: (projectId: string, draftId: string) =>
    apiFetch<void>(`/projects/${projectId}/bet-drafts/${draftId}`, { method: 'DELETE' }),
};
