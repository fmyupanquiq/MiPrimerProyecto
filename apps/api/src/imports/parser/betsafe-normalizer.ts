import { BETSAFE_ADAPTER } from './betsafe-adapter.js';
import {
  normalizeImportSheet,
  type ImportNormalizationResult,
  type ImportRowReport,
  type PreliminaryNormalizedBet,
} from './import-normalization.js';
import type { RawSheet } from './sheet-model.js';

/**
 * Punto de entrada de Betsafe (Fase 9.2.2, adaptado a la capa agnóstica en la 9.2.4; §113, ADR
 * 0020). Toda la lógica que antes vivía aquí (recorrer la tabla, clasificar, separar selecciones,
 * comparar tipos, D-X23) es ahora `normalizeImportSheet` (`import-normalization.ts`), la misma para
 * cualquier origen: esta función solo le pasa el adaptador de Betsafe (`betsafe-adapter.ts`). Se
 * mantiene con su nombre y su forma exactas para no romper nada de lo ya aprobado en la 9.2.2/9.2.3.
 */
export type PreliminaryBetsafeBet = PreliminaryNormalizedBet;
export type BetsafeRowReport = ImportRowReport;
export type BetsafeNormalizationResult = ImportNormalizationResult;

export function normalizeBetsafeSheet(
  sheet: RawSheet,
  options: { timeZone: string },
): BetsafeNormalizationResult {
  return normalizeImportSheet(sheet, BETSAFE_ADAPTER, options);
}
