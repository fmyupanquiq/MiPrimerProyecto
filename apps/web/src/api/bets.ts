import type {
  BetDetail,
  BetLedgerHistory,
  BetListStatus,
  BetSummary,
  ConfirmBetReturnInput,
  CorrectSettlementInput,
  CorrectionPreview,
  CreateBetInput,
  MoveBetStageInput,
  ReopenBetInput,
  RestoreBetInput,
  ReturnDifferencesReport,
  SettleBetInput,
  TrashBetInput,
  UnconfirmedReturnItem,
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
  restore: (projectId: string, betId: string, input: RestoreBetInput = {}) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/bets/${betId}/restore`, {
      method: 'POST',
      body: input,
    }),
  /** Confirma el retorno oficial de una ganada provisional (§77, §112.2). */
  confirmReturn: (projectId: string, betId: string, input: ConfirmBetReturnInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}/confirm-return`, {
      method: 'POST',
      body: input,
    }),
  /** Corrección de una liquidada (§112.3): la vista previa no escribe nada ni exige reautenticación. */
  previewCorrection: (projectId: string, betId: string, input: CorrectSettlementInput) =>
    apiFetch<CorrectionPreview>(`/projects/${projectId}/bets/${betId}/correct-settlement/preview`, {
      method: 'POST',
      body: input,
    }),
  correct: (projectId: string, betId: string, input: CorrectSettlementInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}/correct-settlement`, {
      method: 'POST',
      body: input,
    }),
  previewReopen: (projectId: string, betId: string, input: ReopenBetInput) =>
    apiFetch<CorrectionPreview>(`/projects/${projectId}/bets/${betId}/reopen/preview`, {
      method: 'POST',
      body: input,
    }),
  reopen: (projectId: string, betId: string, input: ReopenBetInput) =>
    apiFetch<BetDetail>(`/projects/${projectId}/bets/${betId}/reopen`, {
      method: 'POST',
      body: input,
    }),
  ledger: (projectId: string, betId: string) =>
    apiFetch<BetLedgerHistory>(`/projects/${projectId}/bets/${betId}/ledger`),
  unconfirmedReturns: (projectId: string) =>
    apiFetch<UnconfirmedReturnItem[]>(`/projects/${projectId}/bets/unconfirmed-returns`),
  returnDifferences: (projectId: string) =>
    apiFetch<ReturnDifferencesReport>(`/projects/${projectId}/bets/return-differences`),
};
