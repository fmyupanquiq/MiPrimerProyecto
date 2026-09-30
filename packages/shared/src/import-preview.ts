import type { BetType, BetStatus } from './bet.js';
import type { ImportRowStatus, NormalizedImportSelection } from './import-batch.js';
import type { MoneyString } from './money.js';
import type { OddsString } from './odds.js';

/**
 * Contrato de la vista previa de importación (Fase 9.2.6/9.3, §113, ADR 0020): lo que devuelve
 * `GET /projects/:projectId/import-batches/:batchId/preview`. Se recalcula siempre desde el
 * archivo conservado; nada de esto se persiste tal cual (`import_rows`/`import_batches` solo
 * guardan la fotografía inmutable del análisis, no esta proyección). Vive en `@letfer/shared`
 * porque tanto `apps/api` (quien lo construye) como `apps/web` (quien lo consume, Fase 9.4)
 * necesitan el mismo tipo, igual que `BetSummary`/`BetDetail`.
 */

/** Categoría de una fila según D-X17b: bloquea, exige reconocimiento, o solo informa. */
export type ImportRowReportCategory = 'BLOCKING' | 'NEEDS_ACKNOWLEDGMENT' | 'INFORMATIONAL';

/** Por qué el clasificador de filas (D-X21, D-X21b) marcó una fila como incompleta o inválida. */
export interface RowClassificationFinding {
  code:
    | 'MISSING_AMOUNT'
    | 'MISSING_ODDS'
    | 'MISSING_RESULT'
    | 'MISSING_DESCRIPTION'
    | 'MISSING_DATE'
    | 'INVALID_AMOUNT'
    | 'INVALID_ODDS'
    | 'INVALID_RESULT'
    | 'INVALID_DATE';
  message: string;
}

export interface ImportRowValidationEntry {
  rowNumber: number;
  status: ImportRowStatus;
  category: ImportRowReportCategory;
  findings: RowClassificationFinding[];
  declaredType: string | null;
  derivedType: string | null;
  typeMismatch: boolean;
}

/**
 * Semáforo estructural de D-X17b: `BLOCKED` si hay algún error, si no `NEEDS_ACKNOWLEDGMENT` si
 * hay alguna fila parcial, si no `OK`. Distinto del semáforo financiero (`ImportTrafficLight`).
 */
export type ImportSemaphore = 'BLOCKED' | 'NEEDS_ACKNOWLEDGMENT' | 'OK';

/** D-X7: solo un candidato con su evidencia; ninguna etapa real se crea ni se resuelve aquí. */
export interface StageCandidate {
  label: string | null;
  labelRow: number | null;
  firstRow: number;
  lastRow: number;
  evidence: string;
}

/** Semáforo financiero por fila (§113.7): sin amarillo, una fila o coincide o no. */
export type RowFinancialSemaphore = 'GREEN' | 'RED';

/** Semáforo financiero del lote (§113.7): mismo dominio que `ImportTrafficLight`. */
export type BatchFinancialSemaphore = 'GREEN' | 'YELLOW' | 'RED';

export interface BetFinancialComparison {
  rowNumber: number;
  /** `null` si la celda del Excel está vacía (p. ej. una plantilla que igualmente se compara). */
  excelTotalReturn: MoneyString | null;
  excelProfit: MoneyString | null;
  letferTotalReturn: MoneyString;
  letferProfit: MoneyString;
  /** `excel − LetFer` (D-X17); `null` cuando no hay valor del Excel con el que restar. */
  totalReturnResidual: MoneyString | null;
  profitResidual: MoneyString | null;
  semaphore: RowFinancialSemaphore;
}

export interface HeaderConsistencyCheck {
  label: string;
  /** Valor que el propio archivo guarda en la celda de cabecera; `null` si no se configuró o está vacía. */
  excelValue: MoneyString | null;
  /** Reconstruido sumando las propias filas del archivo (nunca las de LetFer). */
  expectedFromRows: MoneyString;
  residual: MoneyString | null;
  consistent: boolean;
}

/** Contraste financiero contra las cifras propias del Excel (§113.7, D-X11): nunca ajusta nada. */
export interface ExcelFinancialContrastReport {
  /**
   * `true` cuando este informe viene de contrastar realmente contra un archivo; `false` cuando el
   * origen no tiene `financialContrast` configurado (un `GREEN` en ese caso significa "no hay
   * nada configurado que contrastar", nunca "todo coincide").
   */
  configured: boolean;
  bets: BetFinancialComparison[];
  /** Suma de los residuos de GANANCIA de las filas con valor del Excel (D-X17, "total del lote"). */
  totalProfitResidual: MoneyString;
  /** Cuántas de esas filas tienen, en el Excel, un valor con más de dos decimales (margen explicable). */
  rowsWithMoreThanTwoDecimals: number;
  semaphore: BatchFinancialSemaphore;
  headerChecks: HeaderConsistencyCheck[];
  /** El "Bank Inicial" que el propio archivo declara en su cabecera (D-X3/D-X18); `null` si no aplica. */
  initialBankAmount: MoneyString | null;
}

/** Un grupo de duplicados por contenido (D-X10): nunca descarta ni fusiona nada, solo informa. */
export interface ImportDuplicateMatch {
  /** Filas del archivo actual involucradas en este grupo (2 o más). */
  rowNumbers: number[];
  /** Apuestas ya importadas con las que coincide, si el solapamiento es contra el histórico. */
  existingBetIds: string[];
  date: string;
  amount: MoneyString;
  odds: OddsString;
}

/**
 * Duplicados por contenido (D-X10, §113.6). `withinFile` es siempre calculado; `againstHistory`
 * solo cuando la casa del lote ya está confirmada (necesita base de datos).
 */
export interface ImportDuplicateReport {
  withinFile: ImportDuplicateMatch[];
  againstHistory: ImportDuplicateMatch[];
}

export interface ImportPreviewFile {
  originalName: string;
  sizeBytes: number;
  sha256: string;
}

export interface ImportPreviewSummary {
  totalRows: number;
  valid: number;
  template: number;
  empty: number;
  partial: number;
  invalid: number;
  /** Igual a `valid`: cuántas apuestas se crearían (una apuesta preliminar por fila válida). */
  preliminaryBets: number;
}

export interface ImportPreviewCapital {
  /** `false` si no hay ninguna apuesta que fechar o no se detectó un monto de capital en el archivo. */
  detected: boolean;
  amount: MoneyString | null;
  /** D-X8: candidato sin confirmar, derivado del nombre del archivo; se confirma en la vista previa. */
  houseCandidate: string;
  /** ISO 8601. D-X3/D-X18/D-X23: medianoche (zona del proyecto) del día de la primera apuesta. */
  occurredAt: string | null;
  /** Siempre `false` (D-X29): la fecha del capital histórico importado nunca se presenta como conocida. */
  occurredAtKnown: false;
}

export interface ImportPreviewBet {
  rowNumber: number;
  amount: MoneyString;
  visibleTotalOdds: OddsString;
  status: Extract<BetStatus, 'WON' | 'LOST' | 'PENDING'>;
  /** ISO 8601 (D-X23: instante técnico, no una hora real). */
  placedAt: string;
  declaredType: string | null;
  derivedType: BetType | null;
  /** D-X24: aviso, nunca bloquea. */
  typeMismatch: boolean;
  selections: NormalizedImportSelection[];
  /** Retorno calculado no confirmado (D-X4); `null` salvo en una ganada. */
  provisionalReturn: MoneyString | null;
}

export interface ImportPreview {
  file: ImportPreviewFile;
  /** Nombre del adaptador de origen usado (p. ej. `"Betsafe"`); nunca un tipo, solo un texto. */
  origin: string;
  summary: ImportPreviewSummary;
  /** Semáforo estructural de D-X17b (bloqueante/requiere reconocimiento/informativo). */
  semaphore: ImportSemaphore;
  rows: ImportRowValidationEntry[];
  capital: ImportPreviewCapital;
  /** D-X7: solo candidatos, con su evidencia; ninguna etapa real se crea ni se resuelve aquí. */
  stages: { candidates: StageCandidate[] };
  bets: ImportPreviewBet[];
  /** Resultado íntegro del contraste financiero (§113.7): contra las cifras propias del archivo. */
  financialContrast: ExcelFinancialContrastReport;
  duplicates: ImportDuplicateReport;
}

/**
 * Si un lote puede confirmarse ahora mismo (Fase 9.3.6, D-X17b, §113.7, D-X10): lo que devuelve
 * `GET /projects/:projectId/import-batches/:batchId/readiness` (Fase 9.4.7), calculado por
 * `ImportAcknowledgmentService.canConfirmImport`, la misma comprobación que aplica `confirm`. La web
 * solo lo muestra; nunca lo deduce de la vista previa.
 */
export interface ImportConfirmationReadiness {
  /** D-X17b: filas `INVALID`. Bloquea sin excepción — ningún reconocimiento lo levanta (§113.6). */
  blocked: boolean;
  blockingReasons: string[];
  /**
   * Exige un reconocimiento explícito antes de confirmar (§113.7): filas `PARTIAL` (D-X17b) o
   * semáforo financiero `RED`. El amarillo **no** lo exige — "amarillo solo informa" (§113.7); se
   * expone igualmente en `financialSemaphore` para que quien confirme lo vea, pero no bloquea.
   */
  needsAcknowledgment: boolean;
  acknowledgmentReasons: string[];
  /** El lote ya tiene un reconocimiento guardado (`acknowledged_at` no nulo). */
  acknowledged: boolean;
  financialSemaphore: BatchFinancialSemaphore;
  /** `true` solo si no está bloqueado y, si hacía falta reconocimiento, ya se dio. */
  canConfirm: boolean;
}
