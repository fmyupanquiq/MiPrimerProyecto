import { z } from 'zod';
import { moneyInputSchema, type MoneyString } from './money.js';
import type { OddsString } from './odds.js';

/**
 * Lotes de importación del historial (Fase 9, §113, ADR 0020). Un lote corresponde a un archivo de
 * origen de una casa; sus filas de staging no tocan el ledger hasta confirmarlo.
 */

/** Estados de un lote (§113.2). Un lote anulado conserva su archivo, su informe y sus filas. */
export const IMPORT_BATCH_STATUSES = ['UPLOADED', 'VALIDATED', 'IMPORTED', 'ANNULLED'] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/** Clasificación de cada fila del archivo (§113.6, D-X21, D-X21b). */
export const IMPORT_ROW_STATUSES = ['VALID', 'TEMPLATE', 'EMPTY', 'PARTIAL', 'INVALID'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/** Semáforo de la diferencia entre el archivo y LetFer (§113.7, D-X17). */
export const IMPORT_TRAFFIC_LIGHTS = ['GREEN', 'YELLOW', 'RED'] as const;
export type ImportTrafficLight = (typeof IMPORT_TRAFFIC_LIGHTS)[number];

/** Tamaño máximo del archivo original (§113.9): un archivo mayor se rechaza antes del staging. */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Acciones de auditoría de un lote (§113.9): una por lote y paso, nunca una por fila. El detalle por
 * fila vive en `import_rows`. La huella del archivo se registra con la clave `sha256`, no `hash`:
 * la redacción de la auditoría oculta cualquier clave que contenga `hash`.
 */
export const IMPORT_AUDIT_ACTIONS = {
  uploaded: 'import.batch_uploaded',
  validated: 'import.batch_validated',
  imported: 'import.batch_imported',
  annulled: 'import.batch_annulled',
} as const;
export type ImportAuditAction = (typeof IMPORT_AUDIT_ACTIONS)[keyof typeof IMPORT_AUDIT_ACTIONS];

const IMPORT_REASON_MAX_LENGTH = 500;

/**
 * Esquemas de los endpoints de importación (Fase 9.3.8, §113.6, §113.9). Solo validan la forma
 * (tipos, longitudes): las reglas de negocio (claves únicas del plan, rangos sin solaparse, estado
 * del lote, disposición a confirmar) las comprueban los servicios, nunca aquí.
 */

/** `origin` identifica el adaptador de origen (hoy solo `"Betsafe"`); el backend decide cuál es. */
export const uploadImportBatchSchema = z.object({
  origin: z.string().trim().min(1),
});
export type UploadImportBatchInput = z.infer<typeof uploadImportBatchSchema>;

/** D-X8: confirma o corrige la casa candidata. */
export const confirmImportHouseSchema = z.object({
  houseId: z.uuid(),
});
export type ConfirmImportHouseInput = z.infer<typeof confirmImportHouseSchema>;

/** D-X7: una etapa del plan propuesto, con el rango de filas del staging que le corresponde. */
const importStagePlanEntrySchema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  unitStake: moneyInputSchema({ positive: true }),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.enum(['CLOSED', 'ACTIVE']),
  firstRow: z.number().int().positive(),
  lastRow: z.number().int().positive(),
});
export const saveImportStagePlanSchema = z.object({
  stages: z.array(importStagePlanEntrySchema).min(1),
});
export type SaveImportStagePlanInput = z.infer<typeof saveImportStagePlanSchema>;

/** D-X17b: reconocimiento explícito con motivo. */
export const acknowledgeImportBatchSchema = z.object({
  reason: z.string().trim().min(1).max(IMPORT_REASON_MAX_LENGTH),
});
export type AcknowledgeImportBatchInput = z.infer<typeof acknowledgeImportBatchSchema>;

/**
 * §113.6, §113.9: motivo obligatorio; `isRehearsal` exime del backup reciente (D-X26). Sin `origin`:
 * desde la 9.3.9 la API lo lee del propio lote (fijado al subir); si un cliente lo envía, se
 * descarta como cualquier otra clave desconocida.
 */
export const confirmImportBatchSchema = z.object({
  reason: z.string().trim().min(1).max(IMPORT_REASON_MAX_LENGTH),
  isRehearsal: z.boolean().optional(),
});
export type ConfirmImportBatchInput = z.infer<typeof confirmImportBatchSchema>;

/** §113.8: motivo obligatorio. */
export const annulImportBatchSchema = z.object({
  reason: z.string().trim().min(1).max(IMPORT_REASON_MAX_LENGTH),
});
export type AnnulImportBatchInput = z.infer<typeof annulImportBatchSchema>;

/**
 * Contratos de respuesta de un lote (Fase 9.4, preparación previa): lo que devuelven los
 * endpoints de `/import-batches`. Viven aquí (y no solo en `apps/api`) porque tanto la API como
 * la web (Fase 9.4) necesitan el mismo tipo, igual que `BetSummary`/`BetDetail`.
 */

/** Una selección ya interpretada de una apuesta importada (D-X15); sin cuota individual (D-X15). */
export interface NormalizedImportSelection {
  eventGroup: number;
  position: number;
  sport?: string | null;
  event: string;
  market?: string | null;
  selection: string;
  /** `null` en el historial importado: la cuota total de la apuesta es la autoridad (D-X15). */
  visibleOdds: OddsString | null;
}

/**
 * Un lote sin su archivo original (hasta 10 MB, §113.9): lo que devuelven todos los endpoints que
 * no sirven el archivo (`POST /`, `GET /`, `GET /:id`, `POST /:id/house`, `POST /:id/stage-plan`,
 * `POST /:id/acknowledge`). Refleja exactamente las columnas de `import_batches` en `apps/api`
 * (Drizzle, ADR 0003): no se redefine su forma aquí, solo se declara sin acoplarse a la base de
 * datos, que es lo que ya viaja hoy en el JSON de la API.
 */
export interface ImportBatchSummaryRow {
  id: string;
  projectId: string;
  houseId: string | null;
  status: ImportBatchStatus;
  origin: string;
  originalName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  isRehearsal: boolean;
  stagePlan: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  rowsTotal: number;
  rowsValid: number;
  rowsTemplate: number;
  rowsEmpty: number;
  rowsPartial: number;
  rowsInvalid: number;
  createdBy: string;
  validatedAt: Date | null;
  validatedBy: string | null;
  importedAt: Date | null;
  importedBy: string | null;
  importReason: string | null;
  annulledAt: Date | null;
  annulledBy: string | null;
  annulmentReason: string | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgmentReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Aviso del informe final (no bloquea). */
export interface ImportWarning {
  code: 'WORST_ORDER_NEGATIVE_BALANCE';
  houseId: string;
  occurredAt: string;
  balance: MoneyString;
  message: string;
}

/** Informe final del lote (`import_batches.report`), fijado al importar. */
export interface ImportBatchReport extends Record<string, unknown> {
  houseId: string;
  stages: number;
  initialCapital: MoneyString | null;
  bets: { total: number; won: number; lost: number; pending: number };
  ledgerRows: number;
  /** Ganancia/pérdida de las apuestas liquidadas, con las cifras de LetFer. */
  profitLoss: MoneyString;
  /** Saldo bruto de la casa antes y después de escribir el lote. */
  balanceBefore: MoneyString;
  balanceAfter: MoneyString;
  warnings: ImportWarning[];
}

/** Respuesta de `POST /:id/confirm`. */
export interface ImportBatchWriteResult {
  batch: ImportBatchSummaryRow;
  stageIds: string[];
  initialCapitalMovementId: string | null;
  betIds: string[];
  report: ImportBatchReport;
}

/** Respuesta de `POST /:id/annul`. */
export interface ImportBatchAnnulResult {
  batch: ImportBatchSummaryRow;
  annulledBetIds: string[];
  reversedMovementIds: string[];
  annulledStageIds: string[];
  /** Etapas del lote que se conservaron porque ya tienen actividad ajena al lote. */
  keptStageIds: string[];
}
