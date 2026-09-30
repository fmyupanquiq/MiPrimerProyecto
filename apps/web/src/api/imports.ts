import type {
  AcknowledgeImportBatchInput,
  AnnulImportBatchInput,
  ConfirmImportBatchInput,
  ConfirmImportHouseInput,
  ImportBatchAnnulResult,
  ImportBatchSummaryRow,
  ImportBatchWriteResult,
  ImportConfirmationReadiness,
  ImportPreview,
  SaveImportStagePlanInput,
} from '@letfer/shared';
import { apiFetch, apiUpload } from './client.js';

export const importsApi = {
  list: (projectId: string) =>
    apiFetch<ImportBatchSummaryRow[]>(`/projects/${projectId}/import-batches`),
  get: (projectId: string, batchId: string) =>
    apiFetch<ImportBatchSummaryRow>(`/projects/${projectId}/import-batches/${batchId}`),
  /** `origin` identifica el adaptador de origen (hoy solo "Betsafe", §113.9); viaja como campo
   *  del formulario, junto al archivo, no como JSON. */
  upload: (projectId: string, file: File, origin: string) =>
    apiUpload<ImportBatchSummaryRow>(`/projects/${projectId}/import-batches`, file, { origin }),
  /** Recalcula siempre desde el archivo conservado (§113.6): nunca lee una copia persistida. */
  preview: (projectId: string, batchId: string) =>
    apiFetch<ImportPreview>(`/projects/${projectId}/import-batches/${batchId}/preview`),
  /** Si el lote puede confirmarse ahora (D-X17b, §113.7, D-X10), según la API; solo lectura. */
  readiness: (projectId: string, batchId: string) =>
    apiFetch<ImportConfirmationReadiness>(
      `/projects/${projectId}/import-batches/${batchId}/readiness`,
    ),
  /** D-X8: confirma o corrige la casa candidata. */
  confirmHouse: (projectId: string, batchId: string, input: ConfirmImportHouseInput) =>
    apiFetch<ImportBatchSummaryRow>(`/projects/${projectId}/import-batches/${batchId}/house`, {
      method: 'POST',
      body: input,
    }),
  /** D-X7: guarda o revisa el plan de etapas; repetible mientras el lote siga `VALIDATED`. */
  saveStagePlan: (projectId: string, batchId: string, input: SaveImportStagePlanInput) =>
    apiFetch<ImportBatchSummaryRow>(`/projects/${projectId}/import-batches/${batchId}/stage-plan`, {
      method: 'POST',
      body: input,
    }),
  /** D-X17b: reconocimiento explícito con motivo (semáforo rojo o fila parcial). */
  acknowledge: (projectId: string, batchId: string, input: AcknowledgeImportBatchInput) =>
    apiFetch<ImportBatchSummaryRow>(
      `/projects/${projectId}/import-batches/${batchId}/acknowledge`,
      { method: 'POST', body: input },
    ),
  confirm: (projectId: string, batchId: string, input: ConfirmImportBatchInput) =>
    apiFetch<ImportBatchWriteResult>(`/projects/${projectId}/import-batches/${batchId}/confirm`, {
      method: 'POST',
      body: input,
    }),
  annul: (projectId: string, batchId: string, input: AnnulImportBatchInput) =>
    apiFetch<ImportBatchAnnulResult>(`/projects/${projectId}/import-batches/${batchId}/annul`, {
      method: 'POST',
      body: input,
    }),
  /** URL del archivo original conservado (§113.9): siempre autenticada, nunca pública. */
  fileUrl: (projectId: string, batchId: string) =>
    `/api/projects/${projectId}/import-batches/${batchId}/file`,
};
