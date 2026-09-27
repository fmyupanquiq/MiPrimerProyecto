import type { BetStatus, MoneyString, OddsString } from '@letfer/shared';
import type { ImportBatchRow } from '../database/schema/index.js';

/** Un lote sin su archivo original (hasta 10 MB), que el escritor no necesita leer. */
export type ImportBatchSummaryRow = Omit<ImportBatchRow, 'sourceFile'>;

/**
 * Datos ya normalizados que recibe el escritor de importación (Fase 9.1.5, §113, ADR 0020). Ningún
 * parser ni lector de archivos participa todavía: quien llame (la 9.2 en adelante) entrega esto.
 * Todo es de **una casa** (`batch.houseId`): un lote es un archivo de una casa.
 */

/** Etapa (ronda) histórica que crea el lote (D-X28). */
export interface NormalizedImportStage {
  /** Identificador dentro del lote; las apuestas y el capital refieren la etapa por esta clave. */
  key: string;
  name: string;
  unitStake: MoneyString;
  /** Inicio de la etapa, si se conoce (`stages.starts_at`). */
  startsAt: Date | null;
  /**
   * `CLOSED` para una ronda ya terminada; `ACTIVE` solo para la última y solo si el proyecto no
   * tiene ya una etapa activa (como máximo hay una, §86).
   */
  status: 'CLOSED' | 'ACTIVE';
}

/** Capital inicial histórico de la casa (D-X3, D-X18, D-X23, D-X29). */
export interface NormalizedInitialCapital {
  amount: MoneyString;
  /** Fecha histórica del movimiento: nunca la hora del servidor. Debe ser anterior a la primera apuesta. */
  occurredAt: Date;
  /** `false` cuando la fecha se desconoce y `occurredAt` es un instante técnico. */
  occurredAtKnown: boolean;
  /** Etapa a la que pertenece el movimiento (la de la primera ronda). */
  stageKey: string;
}

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

/** Apuesta histórica. Los estados admitidos son los del Excel: ganada, perdida y pendiente. */
export interface NormalizedImportBet {
  /** Fila del archivo (`import_rows.row_number`); si existe, la fila enlaza la apuesta creada. */
  rowNumber?: number;
  stageKey: string;
  /** Stake informativo `monto / unidad` (D-X19); solo debe ser positivo. */
  stake: string;
  /** Monto del archivo: monto oficial **no confirmado** de la apuesta (D-X19). */
  amount: MoneyString;
  /** Cuota total visible: obligatoria. */
  visibleTotalOdds: OddsString;
  status: Extract<BetStatus, 'WON' | 'LOST' | 'PENDING'>;
  placedAt: Date;
  placedTimeKnown: boolean;
  /** Fecha de liquidación; en el historial sin ella, la misma que `placedAt` (D-X20). */
  settledAt: Date | null;
  settledTimeKnown: boolean;
  reason?: string | null;
  selections: NormalizedImportSelection[];
}

export interface ImportBatchWriteInput {
  projectId: string;
  batchId: string;
  /** Quien confirma la importación (el permiso, la reautenticación y el backup los validó la capa que llama). */
  actorUserId: string;
  /** Motivo de la confirmación (§113.6). */
  reason: string;
  isRehearsal?: boolean;
  stages: NormalizedImportStage[];
  initialCapital: NormalizedInitialCapital | null;
  bets: NormalizedImportBet[];
}

/** Aviso del informe final (no bloquea). */
export interface ImportWarning {
  code: 'WORST_ORDER_NEGATIVE_BALANCE';
  houseId: string;
  occurredAt: string;
  balance: MoneyString;
  message: string;
}

/** Informe final del lote (`import_batches.report`). */
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

export interface ImportBatchWriteResult {
  batch: ImportBatchSummaryRow;
  stageIds: string[];
  initialCapitalMovementId: string | null;
  betIds: string[];
  report: ImportBatchReport;
}

export interface ImportBatchAnnulInput {
  projectId: string;
  batchId: string;
  actorUserId: string;
  /** Motivo que da quien anula el lote (queda en el lote y en la auditoría). */
  reason: string;
}

export interface ImportBatchAnnulResult {
  batch: ImportBatchSummaryRow;
  annulledBetIds: string[];
  reversedMovementIds: string[];
  annulledStageIds: string[];
  /** Etapas del lote que se conservaron porque ya tienen actividad ajena al lote. */
  keptStageIds: string[];
}

/** Motivo fijo con el que la anulación elimina las apuestas y etapas del lote y revierte el ledger (D-X25). */
export const IMPORT_ANNULMENT_FIXED_REASON = 'Lote anulado';
