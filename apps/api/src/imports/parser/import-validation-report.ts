import {
  addMoney,
  calculateBetReturn,
  subtractMoney,
  ZERO_MONEY,
  type ImportRowReportCategory,
  type ImportRowValidationEntry,
  type ImportSemaphore,
  type MoneyString,
  type StageCandidate,
} from '@letfer/shared';
import type {
  ImportNormalizationResult,
  PreliminaryNormalizedBet,
} from './import-normalization.js';
import type { RowClassification } from './row-classifier.js';

/**
 * Informe de validación y vista previa del lote (Fase 9.2.3, generalizado en la 9.2.4; §113.6,
 * §113.7, D-X17b, ADR 0020). Agnóstico de origen: toma un `ImportNormalizationResult` (de
 * cualquier adaptador) y solo lo **agrupa y clasifica**; nada aquí escribe al ledger, crea una
 * apuesta, resuelve una etapa ni ajusta un valor. El contraste numérico contra las cifras propias
 * del archivo de origen (A+G, GANANCIA; §113.7) es de la 9.3: aquí el semáforo es el de D-X17b,
 * sobre errores y filas, no todavía el de residuos contra el archivo.
 *
 * Categoría de cada fila (D-X17b):
 * - `BLOCKING`: una fila `INVALID` (resultado desconocido, monto/cuota no numéricos o no positivos,
 *   fecha inválida). Mientras exista una, el lote no puede confirmarse.
 * - `NEEDS_ACKNOWLEDGMENT`: una fila `PARTIAL` ("requiere revisión", D-X21b). No bloquea, pero exige
 *   un reconocimiento explícito (con motivo y reautenticación) antes de confirmar — eso lo hace la
 *   capa de confirmación, no este informe.
 * - `INFORMATIONAL`: el resto (`VALID`, `TEMPLATE`, `EMPTY`), incluido un aviso de tipo (D-X24): un
 *   aviso nunca exige reconocimiento por sí solo.
 */

export interface ImportBatchSummary {
  /** Filas de la tabla recorridas (D-X21: ninguna se pierde en silencio). */
  totalRows: number;
  /** Apuestas preliminares que se crearían (una por fila `VALID`; D-X7: sin etapa ni stake todavía). */
  validBets: number;
  /** Plantilla o vacía (D-X21): ni se importan ni se reportan como problema. */
  ignoredRows: number;
  /** `PARTIAL`: no se importan, requieren revisión (D-X21b). */
  partialRows: number;
  /** `INVALID`: bloquean la confirmación del lote (D-X17b). */
  errors: number;
  /** Tipo declarado y derivado no coinciden (D-X24); nunca bloquea. */
  typeMismatches: number;
  /** `partialRows + typeMismatches`: todo lo que pide atención sin bloquear. */
  warnings: number;
  /** Ganadas provisionales que este lote añadiría (retorno calculado, todavía sin oficial, D-X4). */
  provisionalReturns: { count: number; profitLoss: MoneyString };
}

export interface ImportValidationReport {
  /**
   * `BLOCKED` si hay algún error; si no, `NEEDS_ACKNOWLEDGMENT` si hay alguna fila parcial; si no,
   * `OK`. Los dos primeros son excluyentes por diseño (D-X17b): un error nunca queda enmascarado
   * por una advertencia.
   */
  semaphore: ImportSemaphore;
  summary: ImportBatchSummary;
  rows: ImportRowValidationEntry[];
  /** Sin resolver: cada uno sigue siendo solo un candidato, con su evidencia (D-X7). */
  stageCandidates: StageCandidate[];
  /** Igual que las recibió la normalización: sin `stageKey` ni `stake` (D-X7, D-X19 diferidos). */
  bets: PreliminaryNormalizedBet[];
}

function categoryOf(status: RowClassification): ImportRowReportCategory {
  if (status === 'INVALID') return 'BLOCKING';
  if (status === 'PARTIAL') return 'NEEDS_ACKNOWLEDGMENT';
  return 'INFORMATIONAL';
}

function provisionalReturnsOf(bets: readonly PreliminaryNormalizedBet[]): {
  count: number;
  profitLoss: MoneyString;
} {
  let count = 0;
  let profitLoss: MoneyString = ZERO_MONEY;
  for (const bet of bets) {
    if (bet.status !== 'WON') continue;
    const realized = calculateBetReturn(bet.amount, bet.visibleTotalOdds);
    count += 1;
    profitLoss = addMoney(profitLoss, subtractMoney(realized, bet.amount));
  }
  return { count, profitLoss };
}

/**
 * Construye el informe a partir del resultado ya normalizado (cualquier origen). Función pura: el
 * mismo `ImportNormalizationResult` produce siempre el mismo informe, sin leer ni escribir nada.
 */
export function buildImportValidationReport(
  result: ImportNormalizationResult,
): ImportValidationReport {
  const rows: ImportRowValidationEntry[] = result.rows.map((row) => ({
    rowNumber: row.rowNumber,
    status: row.status,
    category: categoryOf(row.status),
    findings: row.findings,
    declaredType: row.declaredType,
    derivedType: row.derivedType,
    typeMismatch: row.typeMismatch,
  }));

  const summary: ImportBatchSummary = {
    totalRows: rows.length,
    validBets: result.counts.VALID,
    ignoredRows: result.counts.TEMPLATE + result.counts.EMPTY,
    partialRows: result.counts.PARTIAL,
    errors: result.counts.INVALID,
    typeMismatches: rows.filter((row) => row.typeMismatch).length,
    warnings: result.counts.PARTIAL + rows.filter((row) => row.typeMismatch).length,
    provisionalReturns: provisionalReturnsOf(result.bets),
  };

  const semaphore: ImportSemaphore =
    summary.errors > 0 ? 'BLOCKED' : summary.partialRows > 0 ? 'NEEDS_ACKNOWLEDGMENT' : 'OK';

  return {
    semaphore,
    summary,
    rows,
    stageCandidates: result.stageCandidates,
    bets: result.bets,
  };
}
