import {
  calculateBetReturn,
  type BetType,
  type MoneyString,
  type OddsString,
} from '@letfer/shared';
import { startOfDayInTimeZone } from '../../common/timezone.js';
import type { NormalizedImportSelection } from '../import-types.js';
import type { ExcelFinancialContrastReport } from './excel-financial-contrast.js';
import type {
  ImportNormalizationResult,
  PreliminaryNormalizedBet,
} from './import-normalization.js';
import type {
  ImportRowValidationEntry,
  ImportSemaphore,
  ImportValidationReport,
} from './import-validation-report.js';
import type { RowClassification } from './row-classifier.js';
import type { StageCandidate } from './stage-candidates.js';

/**
 * Vista previa completa de una importación (Fase 9.2.6, §113, ADR 0020): une lo que ya calcularon
 * el lector, el adaptador de origen, la normalización (9.2.2/9.2.4), la validación estructural
 * (9.2.3/9.2.4, D-X17b) y el contraste financiero (9.2.5) en una sola representación de "qué
 * ocurriría si se importa este archivo" — sin ningún efecto: **no lee el Excel** (recibe los
 * resultados ya calculados de esos pasos, nunca la hoja ni el adaptador), no escribe nada en la
 * base de datos, no crea `import_batches`, no llama al escritor de la 9.1.5, no toca el ledger y no
 * valida ningún permiso. Es agnóstica de origen: nada aquí se llama ni depende de Betsafe.
 *
 * Quien orquesta (una fase posterior, con endpoints) es responsable de leer el archivo, llamar al
 * adaptador correspondiente y pasar aquí sus tres resultados; esta función solo los combina.
 */

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
  /** Igual a `valid` en este pipeline (una apuesta preliminar por fila válida); se expone aparte
   *  porque conceptualmente responde una pregunta distinta ("¿cuántas apuestas se crearían?"). */
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
  status: PreliminaryNormalizedBet['status'];
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
  /** Resultado íntegro de la 9.2.5 (§113.7): contraste contra las cifras propias del archivo. */
  financialContrast: ExcelFinancialContrastReport;
}

/** D-X8: la casa candidata sale del nombre del archivo (sin la extensión); se confirma en la vista previa. */
export function deriveCandidateHouseName(originalName: string): string {
  return originalName.replace(/\.[^./\\]+$/, '').trim();
}

export interface BuildImportPreviewInput {
  file: ImportPreviewFile;
  /** `adapter.name`: se pasa el texto, no el adaptador, para no acoplar la vista previa a su forma. */
  originName: string;
  normalization: ImportNormalizationResult;
  validation: ImportValidationReport;
  financialContrast: ExcelFinancialContrastReport;
  /** La misma zona horaria con la que se normalizaron las apuestas (D-X23): para fechar el capital. */
  timeZone: string;
}

/**
 * Combina los resultados ya calculados en la vista previa completa. Función pura: no lee ningún
 * archivo, no escribe nada y el mismo conjunto de resultados produce siempre la misma vista previa.
 */
export function buildImportPreview(input: BuildImportPreviewInput): ImportPreview {
  const { normalization, validation, financialContrast } = input;
  const rowsByNumber = new Map(normalization.rows.map((row) => [row.rowNumber, row]));

  const summary: ImportPreviewSummary = {
    totalRows: normalization.rows.length,
    valid: normalization.counts.VALID,
    template: normalization.counts.TEMPLATE,
    empty: normalization.counts.EMPTY,
    partial: normalization.counts.PARTIAL,
    invalid: normalization.counts.INVALID,
    preliminaryBets: normalization.bets.length,
  };

  const betsWithRow = normalization.bets.filter(
    (bet): bet is PreliminaryNormalizedBet & { rowNumber: number } => bet.rowNumber !== undefined,
  );

  const bets: ImportPreviewBet[] = betsWithRow.map((bet) => {
    const row = rowsByNumber.get(bet.rowNumber);
    return {
      rowNumber: bet.rowNumber,
      amount: bet.amount,
      visibleTotalOdds: bet.visibleTotalOdds,
      status: bet.status,
      placedAt: bet.placedAt.toISOString(),
      declaredType: row?.declaredType ?? null,
      derivedType: row?.derivedType ?? null,
      typeMismatch: row?.typeMismatch ?? false,
      selections: bet.selections,
      provisionalReturn:
        bet.status === 'WON' ? calculateBetReturn(bet.amount, bet.visibleTotalOdds) : null,
    };
  });

  const earliestBet = betsWithRow.reduce<PreliminaryNormalizedBet | null>(
    (earliest, bet) =>
      !earliest || bet.placedAt.getTime() < earliest.placedAt.getTime() ? bet : earliest,
    null,
  );

  const capital: ImportPreviewCapital = {
    detected: financialContrast.initialBankAmount !== null && earliestBet !== null,
    amount: financialContrast.initialBankAmount,
    houseCandidate: deriveCandidateHouseName(input.file.originalName),
    // D-X3/D-X18/D-X23: medianoche (zona del proyecto) del día de la primera apuesta, siempre
    // anterior a su instante (mediodía). Sin ninguna apuesta, no hay fecha que anclar.
    occurredAt: earliestBet
      ? startOfDayInTimeZone(earliestBet.placedAt, input.timeZone).toISOString()
      : null,
    occurredAtKnown: false,
  };

  return {
    file: input.file,
    origin: input.originName,
    summary,
    semaphore: validation.semaphore,
    rows: validation.rows,
    capital,
    stages: { candidates: normalization.stageCandidates },
    bets,
    financialContrast,
  };
}

// Reexportado solo para que quien construya el informe pueda tipar sus propios contadores igual
// que `normalization.counts` sin importar `row-classifier.ts` directamente.
export type { RowClassification };
