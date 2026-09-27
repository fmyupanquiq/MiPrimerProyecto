import type { BetType } from '@letfer/shared';
import type { ExcelFinancialContrastConfig } from './excel-financial-contrast.js';
import type { ImportOriginAdapter } from './import-normalization.js';
import { parseBetsafeSelections } from './betsafe-selections.js';
import { BETSAFE_TEMPLATE } from './spreadsheet-template.js';

/**
 * Adaptador de Betsafe (Fase 9.2.4, ADR 0020): lo único que `normalizeImportSheet` necesita para
 * entender este origen. Es el ejemplo y la plantilla para un futuro adaptador de Betano (o de
 * cualquier otro origen): la misma estructura, con su propia plantilla de columnas, su propia
 * gramática de selecciones y su propio vocabulario de tipos — nunca compartiendo estos tres con
 * otro origen sin confirmarlo primero (§113.5, D-X24).
 */

/** Tipo declarado (columna TIPO de Betsafe) → tipo de LetFer, para comparar contra el derivado. */
export const BETSAFE_DECLARED_TYPE_VOCABULARY: Readonly<Record<string, BetType>> = {
  Simple: 'SIMPLE',
  Multi: 'MULTIPLE',
  Creada: 'CREATED',
};

export const BETSAFE_ADAPTER: ImportOriginAdapter = {
  name: 'Betsafe',
  template: BETSAFE_TEMPLATE,
  parseSelections: parseBetsafeSelections,
  declaredTypeVocabulary: BETSAFE_DECLARED_TYPE_VOCABULARY,
};

/**
 * Columnas y celdas de cabecera donde Betsafe guarda sus propios cálculos (confirmadas en la
 * 9.2.0 con las fórmulas reales del archivo): A+G y GANANCIA por fila (K, L); Bank Inicial (E3),
 * Bank Actual (E4, `=E3+I4`) y el total de Ganancia de la cabecera (I4, `=SUM(L11:L10003)`).
 * Deliberadamente separado de `BETSAFE_ADAPTER` (D-X17b es una validación distinta de esta, §113.7,
 * Fase 9.2.5): nunca se usa para construir la apuesta, solo para contrastarla.
 */
export const BETSAFE_FINANCIAL_CONTRAST_CONFIG: ExcelFinancialContrastConfig = {
  firstDataRow: BETSAFE_TEMPLATE.firstDataRow,
  computedColumns: { totalReturn: 'K', profit: 'L' },
  headerCells: {
    initialBank: { row: 3, column: 'E' },
    currentBank: { row: 4, column: 'E' },
    profitTotal: { row: 4, column: 'I' },
  },
};
