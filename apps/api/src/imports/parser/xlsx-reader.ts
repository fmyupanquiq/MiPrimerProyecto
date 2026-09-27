import ExcelJS from 'exceljs';
import { AppError } from '../../common/app-error.js';
import { ErrorCode } from '@letfer/shared';
import { columnLetter, type RawCellValue, type RawRow, type RawSheet } from './sheet-model.js';

/**
 * Lector de `.xlsx` (Fase 9.2.1, §113.9, D-X12, D-X26). Envuelve `exceljs`, elegido en vez de `xlsx`
 * (SheetJS): la última versión de `xlsx` publicada en npm (0.18.5) no incorpora las correcciones de
 * varios avisos de seguridad conocidos (SheetJS solo los publica en su propio registro); `exceljs`
 * no tiene ese problema. `exceljs` sí depende de una versión antigua de `uuid` (aviso moderado,
 * solo en el generador aleatorio `v4`, que ni siquiera es la función afectada por ese aviso, y solo
 * se usa al **escribir** un libro, algo que este lector nunca hace).
 *
 * Expone únicamente el **valor crudo** de cada celda (D-X12): nunca el texto formateado por Excel
 * (una fecha con formato o una cuota con menos decimales de los que tiene el número real). Nada
 * aquí conoce el significado de una columna concreta: solo lee filas y celdas.
 */

/** Límite defensivo de filas por hoja (§97: archivo no confiable). Muy por encima de cualquier caso real. */
export const XLSX_READER_MAX_ROWS_PER_SHEET = 200_000;

function invalidFile(message: string): AppError {
  return new AppError(400, ErrorCode.VALIDATION_FAILED, message);
}

/** Valor de una celda de `exceljs`, reducido al valor crudo (nunca el texto mostrado). */
function rawCellValue(value: ExcelJS.CellValue): RawCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text).join('');
    }
    if ('result' in value) {
      // Celda con fórmula (o fórmula compartida): el valor que interesa es su resultado calculado,
      // nunca la fórmula. Si Excel no llegó a calcularla, no hay valor fiable que leer.
      return rawCellValue(value.result);
    }
    if ('text' in value) {
      // Hipervínculo con texto visible (`{ text, hyperlink }`).
      return rawCellValue(value.text);
    }
    if ('error' in value) return null;
  }
  return null;
}

/** Lee todas las hojas de un libro `.xlsx` desde sus bytes. Nunca escribe nada. */
export async function readWorkbook(source: Buffer): Promise<RawSheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // El `index.d.ts` de `exceljs` declara él mismo `interface Buffer extends ArrayBuffer {}`
    // (una fusión ambiental global, defecto conocido del paquete): dentro de ese archivo, `Buffer`
    // deja de ser el `Buffer<T>` genérico de Node. `Parameters<...>` toma el tipo exacto que
    // `load` espera, sea cual sea, así que la conversión funciona sin nombrar «Buffer» a ciegas.
    await workbook.xlsx.load(source as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (error) {
    throw invalidFile(
      `El archivo no es un ".xlsx" válido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return workbook.worksheets.map(readSheet);
}

function readSheet(worksheet: ExcelJS.Worksheet): RawSheet {
  if (worksheet.rowCount > XLSX_READER_MAX_ROWS_PER_SHEET) {
    throw invalidFile(
      `La hoja "${worksheet.name}" tiene más de ${XLSX_READER_MAX_ROWS_PER_SHEET} filas: no se procesa.`,
    );
  }
  const rows: RawRow[] = [];
  let firstRow: number | null = null;
  let lastRow: number | null = null;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: Record<string, RawCellValue> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = rawCellValue(cell.value);
      if (value === null) return;
      // `cell.col` es en tiempo de ejecución el índice numérico de la columna (1 = A), aunque los
      // tipos de `exceljs` digan `string`: por eso el `as unknown as number` de abajo.
      cells[columnLetter(cell.col as unknown as number)] = value;
      hasValue = true;
    });
    if (!hasValue) return; // una fila con estilo pero sin ninguna celda con valor no cuenta.
    rows.push({ rowNumber, cells });
    firstRow = firstRow === null ? rowNumber : Math.min(firstRow, rowNumber);
    lastRow = lastRow === null ? rowNumber : Math.max(lastRow, rowNumber);
  });
  return {
    name: worksheet.name,
    rows,
    usedRange: firstRow !== null && lastRow !== null ? { firstRow, lastRow } : null,
  };
}
