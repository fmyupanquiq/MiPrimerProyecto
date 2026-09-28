import { ErrorCode, ZERO_MONEY } from '@letfer/shared';
import { AppError } from '../../common/app-error.js';
import {
  buildExcelFinancialContrast,
  type ExcelFinancialContrastReport,
} from './excel-financial-contrast.js';
import {
  normalizeImportSheet,
  type ImportNormalizationResult,
  type ImportOriginAdapter,
} from './import-normalization.js';
import {
  buildImportPreview,
  type ImportPreview,
  type ImportPreviewFile,
} from './import-preview.js';
import { buildImportValidationReport } from './import-validation-report.js';
import type { RawSheet } from './sheet-model.js';
import { readWorkbook } from './xlsx-reader.js';

/**
 * Orquestador puro del pipeline completo (Fase 9.3.2, §113, ADR 0020): encadena, en una sola
 * llamada, todo lo que la 9.2 ya construyó por separado —
 *
 * ```
 * Buffer → xlsx-reader → ImportOriginAdapter → normalizeImportSheet
 *        → buildImportValidationReport → buildExcelFinancialContrast → buildImportPreview
 * ```
 *
 * — sin duplicar ninguna de esas funciones ni una sola línea de su lógica: este archivo solo las
 * llama en orden. No toca PostgreSQL, no crea `import_batches` ni `import_rows`, no calcula
 * permisos, no valida backup, no llama a `ImportWriterService`, no resuelve `house_id` ni
 * `stageKey`/`stake`, no guarda ningún reconocimiento y no añade ninguna regla propia de Betsafe ni
 * de Betano: todo lo específico de un origen vive en su `ImportOriginAdapter`, nunca aquí.
 */

export interface ImportPreviewPipelineInput {
  /** Los bytes exactos del archivo `.xlsx` (D-X12); nunca se modifican. */
  file: Buffer;
  adapter: ImportOriginAdapter;
  /** Ya calculada por quien llama (p. ej. al subir el archivo): nombre, tamaño y huella. */
  fileMeta: ImportPreviewFile;
  /** La zona horaria del proyecto (D-X23); sin ella no hay instante técnico que calcular. */
  timeZone: string;
}

/**
 * Contraste financiero cuando el origen no configuró `financialContrast`: `configured: false` deja
 * explícito que nada se contrastó (no es que todo coincidiera). El semáforo `GREEN` que trae es
 * literal ("nada que contrastar"), nunca "todo coincide": quien lo consuma debe mirar `configured`
 * antes de leer nada más de este objeto.
 */
const UNCONFIGURED_FINANCIAL_CONTRAST: ExcelFinancialContrastReport = {
  configured: false,
  bets: [],
  totalProfitResidual: ZERO_MONEY,
  rowsWithMoreThanTwoDecimals: 0,
  semaphore: 'GREEN',
  headerChecks: [],
  initialBankAmount: null,
};

function pickSheet(sheets: readonly RawSheet[], adapter: ImportOriginAdapter): RawSheet {
  const sheet = adapter.sheetName
    ? sheets.find((candidate) => candidate.name === adapter.sheetName)
    : sheets[0];
  if (!sheet) {
    throw new AppError(
      400,
      ErrorCode.VALIDATION_FAILED,
      adapter.sheetName
        ? `El archivo no tiene ninguna hoja llamada "${adapter.sheetName}", que es la que espera el origen "${adapter.name}".`
        : 'El archivo no tiene ninguna hoja.',
    );
  }
  return sheet;
}

/**
 * Todo lo que el pipeline calcula, no solo la vista previa final: la hoja ya leída y el resultado
 * íntegro de la normalización (Fase 9.3.3). `runImportPreviewPipeline` (abajo) sigue siendo la
 * función que basta para recalcular una vista previa (`GET /preview`, sin base de datos); esto es
 * lo que además necesita quien tiene que **persistir** el staging (`import_rows`, 9.3.3): los
 * valores crudos de cada fila (D-X12) y la apuesta preliminar completa (con los campos que
 * `ImportPreview.bets` no expone, como `placedTimeKnown`), no solo su proyección para mostrar.
 */
export interface ImportPipelineAnalysis {
  sheet: RawSheet;
  normalization: ImportNormalizationResult;
  preview: ImportPreview;
}

/**
 * Ejecuta el pipeline completo sobre los bytes de un archivo ya leído en memoria (nunca los lee de
 * disco ni de ningún otro sitio) y devuelve, además de la vista previa, sus artefactos intermedios.
 * Función pura además de asíncrona (solo por `readWorkbook`, que descomprime el `.xlsx`): la misma
 * entrada produce siempre la misma salida, sin ningún efecto secundario.
 */
export async function runImportAnalysisPipeline(
  input: ImportPreviewPipelineInput,
): Promise<ImportPipelineAnalysis> {
  const sheets = await readWorkbook(input.file);
  const sheet = pickSheet(sheets, input.adapter);

  const normalization = normalizeImportSheet(sheet, input.adapter, { timeZone: input.timeZone });
  const validation = buildImportValidationReport(normalization);
  const financialContrast = input.adapter.financialContrast
    ? buildExcelFinancialContrast(sheet, normalization.bets, input.adapter.financialContrast)
    : UNCONFIGURED_FINANCIAL_CONTRAST;

  const preview = buildImportPreview({
    file: input.fileMeta,
    originName: input.adapter.name,
    normalization,
    validation,
    financialContrast,
    timeZone: input.timeZone,
  });
  return { sheet, normalization, preview };
}

/** Igual que {@link runImportAnalysisPipeline}, pero solo con la vista previa que casi todo el mundo necesita. */
export async function runImportPreviewPipeline(
  input: ImportPreviewPipelineInput,
): Promise<ImportPreview> {
  return (await runImportAnalysisPipeline(input)).preview;
}
