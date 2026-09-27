import type { RawSheet } from './sheet-model.js';
import {
  classifyRow,
  extractSemanticRow,
  type ClassifiedRow,
  type ResultVocabulary,
  type SpreadsheetColumnMap,
} from './row-classifier.js';
import { detectStageCandidates, type StageCandidate } from './stage-candidates.js';

/**
 * Configuración de una plantilla de archivo (Fase 9.2.1, ADR 0020). Reúne lo que la 9.2.0 confirmó
 * sobre un archivo concreto (sus columnas, su vocabulario de RESULTADO, dónde empieza la tabla y
 * cómo reconocer un rótulo de etapa) para que los detectores genéricos de este módulo puedan
 * recorrer una hoja real. Ninguna regla vive fuera de este objeto de datos: el código que lo usa
 * (`parseSpreadsheet`) es el mismo para cualquier plantilla.
 */
export interface SpreadsheetTemplateConfig {
  name: string;
  /** Primera fila de la tabla de apuestas (después de la cabecera). */
  firstDataRow: number;
  columns: SpreadsheetColumnMap;
  resultVocabulary: ResultVocabulary;
  stageLabel: { column: string; pattern: RegExp };
}

/**
 * Plantilla confirmada por el análisis de la subfase 9.2.0 sobre `Betsafe.xlsx` (fórmulas y
 * validaciones de datos reales, no una suposición): columnas B/C/E/F/G/H/I/J de la hoja `Rondas`,
 * vocabulario de RESULTADO tomado de `'No Modificar'!$E$4:$E$6`, tabla desde la fila 11 y rótulo de
 * ronda con el patrón `RONDA <número>`.
 *
 * **Se asume, sin confirmar todavía, que Betano usa la misma plantilla** (mismas columnas, según lo
 * que la persona responsable indicó en la Fase 9.0): en cuanto llegue ese archivo hay que
 * contrastarlo contra esta configuración, no asumirlo en silencio.
 */
export const BETSAFE_TEMPLATE: SpreadsheetTemplateConfig = {
  name: 'Betsafe (confirmada 9.2.0)',
  firstDataRow: 11,
  columns: {
    date: 'C',
    sport: 'E',
    description: 'F',
    declaredType: 'G',
    amount: 'H',
    odds: 'I',
    result: 'J',
  },
  resultVocabulary: { GANADO: 'WON', PERDIDO: 'LOST', PENDIENTE: 'PENDING' },
  stageLabel: { column: 'B', pattern: /^RONDA\s+\d+/i },
};

export interface ParsedSpreadsheet {
  sheetName: string;
  rows: ClassifiedRow[];
  stageCandidates: StageCandidate[];
  counts: Record<ClassifiedRow['status'], number>;
}

/**
 * Recorre una hoja ya leída con una plantilla concreta: clasifica cada fila de la tabla (desde
 * `firstDataRow`) y detecta los candidatos de etapa de toda la hoja (el rótulo puede estar antes de
 * `firstDataRow`, como en Betsafe). No escribe nada ni decide ninguna etapa definitiva.
 */
export function parseSpreadsheet(
  sheet: RawSheet,
  template: SpreadsheetTemplateConfig,
): ParsedSpreadsheet {
  const dataRows = sheet.rows.filter((row) => row.rowNumber >= template.firstDataRow);
  const rows = dataRows.map((row) =>
    classifyRow(extractSemanticRow(row, template.columns), {
      resultVocabulary: template.resultVocabulary,
    }),
  );
  const stageCandidates = detectStageCandidates(sheet.rows, {
    labelColumn: template.stageLabel.column,
    labelPattern: template.stageLabel.pattern,
  });
  const counts: Record<ClassifiedRow['status'], number> = {
    VALID: 0,
    TEMPLATE: 0,
    EMPTY: 0,
    PARTIAL: 0,
    INVALID: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return { sheetName: sheet.name, rows, stageCandidates, counts };
}
