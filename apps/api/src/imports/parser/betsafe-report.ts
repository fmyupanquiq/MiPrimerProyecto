import type { ImportRowValidationEntry, ImportSemaphore } from '@letfer/shared';
import {
  buildImportValidationReport,
  type ImportBatchSummary,
  type ImportValidationReport,
} from './import-validation-report.js';

/**
 * Alias con nombre de Betsafe del informe agnóstico (Fase 9.2.3, generalizado en la 9.2.4). El
 * informe nunca tuvo, en realidad, ninguna regla propia de Betsafe (a diferencia del normalizador,
 * que sí la tenía en su separador de selecciones): por eso aquí no hace falta un adaptador, solo
 * este alias, para que nada de lo ya aprobado en la 9.2.3 tenga que cambiar de nombre.
 */
export type BetsafeRowValidationEntry = ImportRowValidationEntry;
export type BetsafeBatchSummary = ImportBatchSummary;
export type BatchSemaphore = ImportSemaphore;
export type BetsafeValidationReport = ImportValidationReport;

export const buildBetsafeValidationReport = buildImportValidationReport;
