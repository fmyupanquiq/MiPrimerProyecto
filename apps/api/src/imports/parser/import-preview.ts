import {
  calculateBetReturn,
  type ExcelFinancialContrastReport,
  type ImportPreview,
  type ImportPreviewBet,
  type ImportPreviewCapital,
  type ImportPreviewFile,
  type ImportPreviewSummary,
} from '@letfer/shared';
import { startOfDayInTimeZone } from '../../common/timezone.js';
import { detectWithinFileDuplicates } from './import-duplicate-detection.js';
import type {
  ImportNormalizationResult,
  PreliminaryNormalizedBet,
} from './import-normalization.js';
import type { ImportValidationReport } from './import-validation-report.js';
import type { RowClassification } from './row-classifier.js';

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

/**
 * `ImportPreviewFile`, `ImportPreviewSummary`, `ImportPreviewCapital`, `ImportPreviewBet`,
 * `ImportDuplicateReport` e `ImportPreview` viven en `@letfer/shared` (Fase 9.4, preparación
 * previa): son exactamente lo que devuelve `GET /:batchId/preview`, y tanto la API como la futura
 * web los necesitan con el mismo tipo.
 */

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
    duplicates: {
      withinFile: detectWithinFileDuplicates(normalization.bets, input.timeZone),
      againstHistory: [],
    },
  };
}

// Reexportado solo para que quien construya el informe pueda tipar sus propios contadores igual
// que `normalization.counts` sin importar `row-classifier.ts` directamente.
export type { RowClassification };
