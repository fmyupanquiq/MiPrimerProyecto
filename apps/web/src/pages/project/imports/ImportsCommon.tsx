import type {
  BatchFinancialSemaphore,
  ImportBatchStatus,
  ImportBatchSummaryRow,
  PermissionCode,
} from '@letfer/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../../api/client.js';
import { IMPORT_BATCH_STATUS_LABELS, IMPORT_FINANCIAL_SEMAPHORE_LABELS } from '../../../labels.js';
import { Badge, Notice } from '../../../ui.js';
import { useProject } from '../ProjectContext.js';

/** Rutas de la importación del historial (Fase 9.4), todas bajo el proyecto. */
export const importsPath = (projectId: string) => `/projects/${projectId}/imports`;
export const importUploadPath = (projectId: string) => `${importsPath(projectId)}/new`;
export const importBatchPath = (projectId: string, batchId: string) =>
  `${importsPath(projectId)}/${batchId}`;

/**
 * Orígenes que la interfaz ofrece al subir (§113.9). La lista real la decide la API
 * (`IMPORT_ORIGIN_ADAPTERS`, hoy solo "Betsafe") y rechaza cualquier otro con 400; esta solo evita
 * escribir el nombre a mano. Si la API registra un origen nuevo, se añade aquí también.
 */
export const IMPORT_ORIGIN_OPTIONS = ['Betsafe'] as const;

/**
 * Estado de navegación con el que la subida abre el detalle del lote recién creado, para que este
 * confirme la subida. Solo es un aviso: el detalle siempre se carga desde la API.
 */
export interface ImportBatchLocationState {
  uploaded?: boolean;
}

const STATUS_TONES: Record<ImportBatchStatus, 'slate' | 'amber' | 'green' | 'red'> = {
  UPLOADED: 'slate',
  VALIDATED: 'amber',
  IMPORTED: 'green',
  ANNULLED: 'red',
};

export const ImportBatchStatusBadge = ({ status }: { status: ImportBatchStatus }) => (
  <Badge tone={STATUS_TONES[status]}>{IMPORT_BATCH_STATUS_LABELS[status]}</Badge>
);

const FINANCIAL_TONES: Record<BatchFinancialSemaphore, 'green' | 'amber' | 'red'> = {
  GREEN: 'green',
  YELLOW: 'amber',
  RED: 'red',
};

/** Semáforo financiero del lote frente al archivo (§113.7), tal como lo da la API. */
export const FinancialSemaphoreBadge = ({ semaphore }: { semaphore: BatchFinancialSemaphore }) => (
  <Badge tone={FINANCIAL_TONES[semaphore]}>{IMPORT_FINANCIAL_SEMAPHORE_LABELS[semaphore]}</Badge>
);

/**
 * Mientras la API admite cambiar el lote: casa, plan, reconocimiento y confirmación (UPLOADED o
 * VALIDATED). `IMPORTED` y `ANNULLED` son terminales para todo eso (solo `IMPORTED` se anula). Solo
 * decide qué controles se ofrecen; la API vuelve a comprobarlo (409 `INVALID_STATE`).
 */
export const isBatchOpen = (batch: ImportBatchSummaryRow) =>
  batch.status === 'UPLOADED' || batch.status === 'VALIDATED';

/** Detalle que la API adjunta a un rechazo (`details.issues`): motivos, filas sin cubrir, etc. */
export function apiIssues(caught: unknown): string[] {
  if (!(caught instanceof ApiError)) return [];
  const issues = (caught.body.details as { issues?: unknown } | undefined)?.issues;
  return Array.isArray(issues) ? issues.map(String) : [];
}

/** El error de una acción con, si los hay, los motivos concretos que dio la API. */
export function ImportActionError({ error, issues }: { error: string | null; issues: string[] }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <p>{error}</p>
      {issues.length > 0 && (
        <ul className="list-disc pl-5">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `ImportBatchSummaryRow` declara sus fechas como `Date` (reflejo de las columnas de Drizzle), pero
 * por el JSON de la API llegan como cadenas ISO; esto acepta ambas sin suponer cuál llega.
 */
export const toIso = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

/**
 * Condiciones comunes de las pantallas de importación: el proyecto debe tener su setup completo
 * (la API rechaza importar sin él, ADR 0020 "proyecto apto") y la persona, el permiso pedido. Solo
 * mejora la interfaz: la API vuelve a comprobar ambas cosas. Los hijos se montan únicamente si se
 * cumplen, para que sus cargas no lleguen a pedirse.
 */
export function ImportsGate({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const { project, can } = useProject();

  if (!project.setupComplete) {
    return (
      <Notice tone="info">
        Completa primero la{' '}
        <Link to={`/projects/${project.id}/setup`} className="underline">
          configuración inicial del proyecto
        </Link>
        .
      </Notice>
    );
  }
  if (!can(permission)) {
    return <Notice tone="info">No tienes permiso para esta sección de importaciones.</Notice>;
  }
  return children;
}
