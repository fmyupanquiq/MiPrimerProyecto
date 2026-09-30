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
import { useCallback, useState } from 'react';
import { importsApi } from '../api/imports.js';
import { describeApiError } from '../api/errors.js';
import { isReauthCancelled, useReauth } from '../auth/ReauthContext.js';
import { useLoad, type Loaded } from './useLoad.js';

// --- Consultas ------------------------------------------------------------------------------
// Mismo patrón que el resto de la aplicación (`ProjectLayout`, `BetsPage`): un `useLoad` con una
// clave textual que identifica la petición. Aquí se nombran para no repetir esa clave en cada
// pantalla de la Fase 9.4, que necesitará las tres en varios paneles a la vez.

/** Lotes de importación del proyecto (§113.9). */
export function useImportBatches(projectId: string): Loaded<ImportBatchSummaryRow[]> {
  return useLoad(`import-batches:${projectId}`, () => importsApi.list(projectId));
}

/** Detalle y estado de un lote. */
export function useImportBatch(projectId: string, batchId: string): Loaded<ImportBatchSummaryRow> {
  return useLoad(`import-batch:${projectId}:${batchId}`, () => importsApi.get(projectId, batchId));
}

/** Vista previa del lote (§113.6): la API la recalcula siempre desde el archivo conservado. */
export function useImportPreview(projectId: string, batchId: string): Loaded<ImportPreview> {
  return useLoad(`import-preview:${projectId}:${batchId}`, () =>
    importsApi.preview(projectId, batchId),
  );
}

/**
 * Si el lote puede confirmarse ahora (D-X17b, §113.7, D-X10): bloqueos, motivos que exigen
 * reconocimiento y si ya se dio, tal como los calcula la API. La web nunca los deduce.
 */
export function useImportReadiness(
  projectId: string,
  batchId: string,
): Loaded<ImportConfirmationReadiness> {
  return useLoad(`import-readiness:${projectId}:${batchId}`, () =>
    importsApi.readiness(projectId, batchId),
  );
}

// --- Mutaciones -------------------------------------------------------------------------------
// El resto de la aplicación no tiene un hook de mutación: cada formulario guarda su propio
// `submitting`/`error` con `useState` y llama a la API directamente (`BetsPage`, `StagesPage`,
// `BetFinancialPanels`). Aquí se generaliza esa misma forma (estado de carga + error ya descrito
// con `describeApiError`, igual que `useLoad`) porque son seis mutaciones con la forma idéntica;
// no cambia el criterio, solo evita repetirlo seis veces.

export interface ImportMutation<TArgs extends unknown[], TResult> {
  loading: boolean;
  /** Mensaje para la persona usuaria si la última llamada falló; `null` mientras no haya fallado. */
  error: string | null;
  run: (...args: TArgs) => Promise<TResult>;
}

/**
 * `run` también rechaza con el error original (además de guardar su descripción en `error`): quien
 * llama puede reaccionar a un código concreto si lo necesita (p. ej. un semáforo D-X17b, igual que
 * `ConfirmReturnPanel` hace hoy con `RETURN_MISMATCH`), sin que este hook decida por él. Una
 * cancelación de reautenticación (`isReauthCancelled`) no se trata como error: no se rellena
 * `error`, pero sigue rechazando para que quien llama pueda no continuar.
 */
function useImportMutation<TArgs extends unknown[], TResult>(
  mutate: (...args: TArgs) => Promise<TResult>,
): ImportMutation<TArgs, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setLoading(true);
      setError(null);
      try {
        return await mutate(...args);
      } catch (caught) {
        if (!isReauthCancelled(caught)) setError(describeApiError(caught));
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [mutate],
  );

  return { loading, error, run };
}

export interface UploadImportBatchResult {
  loading: boolean;
  error: string | null;
  upload: (file: File, origin: string) => Promise<ImportBatchSummaryRow>;
}

/** Sube el archivo y corre el pipeline (D-X8: la casa candidata sale del nombre del archivo). */
export function useUploadImportBatch(projectId: string): UploadImportBatchResult {
  const mutate = useCallback(
    (file: File, origin: string) => importsApi.upload(projectId, file, origin),
    [projectId],
  );
  const { run, loading, error } = useImportMutation(mutate);
  return { upload: run, loading, error };
}

export interface ConfirmImportHouseResult {
  loading: boolean;
  error: string | null;
  confirmHouse: (input: ConfirmImportHouseInput) => Promise<ImportBatchSummaryRow>;
}

/** D-X8: confirma o corrige la casa candidata; sin reautenticación (no está en el controlador). */
export function useConfirmImportHouse(
  projectId: string,
  batchId: string,
): ConfirmImportHouseResult {
  const mutate = useCallback(
    (input: ConfirmImportHouseInput) => importsApi.confirmHouse(projectId, batchId, input),
    [projectId, batchId],
  );
  const { run, loading, error } = useImportMutation(mutate);
  return { confirmHouse: run, loading, error };
}

export interface SaveImportStagePlanResult {
  loading: boolean;
  error: string | null;
  saveStagePlan: (input: SaveImportStagePlanInput) => Promise<ImportBatchSummaryRow>;
}

/** D-X7: guarda o revisa el plan de etapas; repetible mientras el lote siga `VALIDATED`. */
export function useSaveImportStagePlan(
  projectId: string,
  batchId: string,
): SaveImportStagePlanResult {
  const mutate = useCallback(
    (input: SaveImportStagePlanInput) => importsApi.saveStagePlan(projectId, batchId, input),
    [projectId, batchId],
  );
  const { run, loading, error } = useImportMutation(mutate);
  return { saveStagePlan: run, loading, error };
}

export interface AcknowledgeImportResult {
  loading: boolean;
  error: string | null;
  acknowledge: (input: AcknowledgeImportBatchInput) => Promise<ImportBatchSummaryRow>;
}

/** D-X17b: reconocimiento explícito con motivo; exige reautenticación reciente (§113.6). */
export function useAcknowledgeImport(projectId: string, batchId: string): AcknowledgeImportResult {
  const runWithReauth = useReauth();
  const mutate = useCallback(
    (input: AcknowledgeImportBatchInput) =>
      runWithReauth(() => importsApi.acknowledge(projectId, batchId, input)),
    [projectId, batchId, runWithReauth],
  );
  const { run, loading, error } = useImportMutation(mutate);
  return { acknowledge: run, loading, error };
}

export interface ConfirmImportResult {
  loading: boolean;
  error: string | null;
  confirm: (input: ConfirmImportBatchInput) => Promise<ImportBatchWriteResult>;
}

/** `VALIDATED → IMPORTED`, atómico; exige reautenticación reciente (§113.6, §113.9). */
export function useConfirmImport(projectId: string, batchId: string): ConfirmImportResult {
  const runWithReauth = useReauth();
  const mutate = useCallback(
    (input: ConfirmImportBatchInput) =>
      runWithReauth(() => importsApi.confirm(projectId, batchId, input)),
    [projectId, batchId, runWithReauth],
  );
  const { run, loading, error } = useImportMutation(mutate);
  return { confirm: run, loading, error };
}

export interface AnnulImportResult {
  loading: boolean;
  error: string | null;
  annul: (input: AnnulImportBatchInput) => Promise<ImportBatchAnnulResult>;
}

/** `IMPORTED → ANNULLED`; exige reautenticación reciente (§113.8). */
export function useAnnulImport(projectId: string, batchId: string): AnnulImportResult {
  const runWithReauth = useReauth();
  const mutate = useCallback(
    (input: AnnulImportBatchInput) =>
      runWithReauth(() => importsApi.annul(projectId, batchId, input)),
    [projectId, batchId, runWithReauth],
  );
  const { run, loading, error } = useImportMutation(mutate);
  return { annul: run, loading, error };
}
