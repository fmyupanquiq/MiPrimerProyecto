import type {
  ConfirmReconciliationInput,
  ReconciliationCheckpointSummary,
  ReconciliationHouseStatus,
  ReconciliationReview,
} from '@letfer/shared';
import { apiFetch } from './client.js';

export const reconciliationsApi = {
  list: (projectId: string, houseId: string) =>
    apiFetch<ReconciliationCheckpointSummary[]>(
      `/projects/${projectId}/houses/${houseId}/reconciliations`,
    ),
  status: (projectId: string, houseId: string) =>
    apiFetch<ReconciliationHouseStatus>(
      `/projects/${projectId}/houses/${houseId}/reconciliations/status`,
    ),
  review: (projectId: string, houseId: string) =>
    apiFetch<ReconciliationReview>(
      `/projects/${projectId}/houses/${houseId}/reconciliations/review`,
    ),
  confirm: (projectId: string, houseId: string, input: ConfirmReconciliationInput) =>
    apiFetch<ReconciliationCheckpointSummary>(
      `/projects/${projectId}/houses/${houseId}/reconciliations`,
      { method: 'POST', body: input },
    ),
};
