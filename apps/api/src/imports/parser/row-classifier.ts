import {
  moneyInputSchema,
  oddsInputSchema,
  type BetStatus,
  type RowClassificationFinding,
} from '@letfer/shared';
import { isBlankCell, type RawCellValue, type RawRow } from './sheet-model.js';

/**
 * Clasificador genérico de filas (Fase 9.2.1, §113.6, D-X21, D-X21b). No conoce ninguna regla de
 * Betsafe ni de Betano: recibe una fila ya reducida a sus campos con sentido (fecha, monto, cuota,
 * resultado, descripción) a través de un `SpreadsheetColumnMap` que aporta quien llama, y clasifica
 * según esos cinco campos, sin mirar nunca el resto de columnas de la hoja.
 */

/** Qué columna (letra) de la hoja aporta cada campo con sentido de una fila de apuesta. */
export interface SpreadsheetColumnMap {
  date: string;
  sport?: string;
  description: string;
  declaredType?: string;
  amount: string;
  odds: string;
  result: string;
}

/** Vocabulario de la columna RESULTADO de este archivo: su texto exacto → estado de LetFer. */
export type ResultVocabulary = Readonly<
  Record<string, Extract<BetStatus, 'WON' | 'LOST' | 'PENDING'>>
>;

/** Una fila ya reducida a sus campos con sentido (antes de validar nada). */
export interface SemanticBetRow {
  rowNumber: number;
  date: RawCellValue;
  sport: RawCellValue;
  description: RawCellValue;
  declaredType: RawCellValue;
  amount: RawCellValue;
  odds: RawCellValue;
  result: RawCellValue;
}

/** Lee los campos con sentido de una fila cruda según el mapa de columnas. Nunca valida nada. */
export function extractSemanticRow(row: RawRow, map: SpreadsheetColumnMap): SemanticBetRow {
  const at = (letter: string | undefined): RawCellValue =>
    letter ? (row.cells[letter] ?? null) : null;
  return {
    rowNumber: row.rowNumber,
    date: at(map.date),
    sport: at(map.sport),
    description: at(map.description),
    declaredType: at(map.declaredType),
    amount: at(map.amount),
    odds: at(map.odds),
    result: at(map.result),
  };
}

export type RowClassification = 'VALID' | 'TEMPLATE' | 'EMPTY' | 'PARTIAL' | 'INVALID';

export interface ClassifiedRow {
  rowNumber: number;
  status: RowClassification;
  findings: RowClassificationFinding[];
  /**
   * Presente solo en una fila `VALID`: los valores ya interpretados (sin volcarlos todavía al
   * modelo final del escritor, que además necesita la etapa confirmada, D-X7).
   */
  normalized: {
    date: Date;
    sport: string | null;
    description: string;
    declaredType: string | null;
    amount: string;
    odds: string;
    status: Extract<BetStatus, 'WON' | 'LOST' | 'PENDING'>;
  } | null;
}

const numberToText = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(2) : String(value);

function toMoneyString(value: RawCellValue): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return numberToText(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

function toOddsString(value: RawCellValue): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

function toDate(value: RawCellValue): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Cualquier valor crudo, como texto (recortado); `null` si está vacío. Útil fuera del clasificador. */
export function toText(value: RawCellValue): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Clasifica una fila (D-X21, D-X21b). Los cuatro campos "con señal" son monto, cuota, resultado y
 * descripción: una fila sin ninguno de ellos es plantilla o vacía, tenga o no fecha/deporte
 * prellenados (la fecha nunca por sí sola dice que la fila tiene una apuesta real). El vocabulario
 * de RESULTADO lo aporta quien llama (§113: propio de cada plantilla de archivo, no una regla fija).
 */
export function classifyRow(
  row: SemanticBetRow,
  options: { resultVocabulary: ResultVocabulary },
): ClassifiedRow {
  const hasAmount = !isBlankCell(row.amount);
  const hasOdds = !isBlankCell(row.odds);
  const hasResult = !isBlankCell(row.result);
  const hasDescription = !isBlankCell(row.description);
  const hasDate = !isBlankCell(row.date);
  const signalCount = [hasAmount, hasOdds, hasResult, hasDescription].filter(Boolean).length;

  if (signalCount === 0) {
    return {
      rowNumber: row.rowNumber,
      status: hasDate || !isBlankCell(row.sport) ? 'TEMPLATE' : 'EMPTY',
      findings: [],
      normalized: null,
    };
  }

  const findings: RowClassificationFinding[] = [];
  if (!hasDate) findings.push({ code: 'MISSING_DATE', message: 'Falta la fecha.' });
  if (!hasAmount) findings.push({ code: 'MISSING_AMOUNT', message: 'Falta el monto.' });
  if (!hasOdds) findings.push({ code: 'MISSING_ODDS', message: 'Falta la cuota.' });
  if (!hasResult) findings.push({ code: 'MISSING_RESULT', message: 'Falta el resultado.' });
  if (!hasDescription)
    findings.push({ code: 'MISSING_DESCRIPTION', message: 'Falta la descripción.' });

  if (signalCount < 4 || !hasDate) {
    return { rowNumber: row.rowNumber, status: 'PARTIAL', findings, normalized: null };
  }

  // Las cuatro señales y la fecha están presentes: falta validar que cada valor tenga sentido.
  const date = toDate(row.date);
  if (!date) findings.push({ code: 'INVALID_DATE', message: 'La fecha no es válida.' });

  const amountText = toMoneyString(row.amount);
  const amountCheck = amountText
    ? moneyInputSchema({ positive: true }).safeParse(amountText)
    : null;
  const amount = amountCheck?.success ? amountCheck.data : null;
  if (!amount) {
    findings.push({ code: 'INVALID_AMOUNT', message: 'El monto no es un número positivo válido.' });
  }

  const oddsText = toOddsString(row.odds);
  const oddsCheck = oddsText ? oddsInputSchema().safeParse(oddsText) : null;
  const odds = oddsCheck?.success ? oddsCheck.data : null;
  if (!odds) {
    findings.push({ code: 'INVALID_ODDS', message: 'La cuota no es un número positivo válido.' });
  }

  const resultText = toText(row.result);
  const status = resultText ? options.resultVocabulary[resultText] : undefined;
  if (!status) {
    findings.push({
      code: 'INVALID_RESULT',
      message: `El resultado "${String(row.result)}" no está en el vocabulario esperado.`,
    });
  }

  if (findings.length > 0) {
    return { rowNumber: row.rowNumber, status: 'INVALID', findings, normalized: null };
  }

  return {
    rowNumber: row.rowNumber,
    status: 'VALID',
    findings: [],
    normalized: {
      date: date!,
      sport: toText(row.sport),
      description: toText(row.description)!,
      declaredType: toText(row.declaredType),
      amount: amount!,
      odds: odds!,
      status: status!,
    },
  };
}
