/**
 * Modelo genérico de una hoja de cálculo ya leída (Fase 9.2.1, §113.6, ADR 0020, D-X12). No conoce
 * nada de Betsafe ni de Betano: solo representa lo que hay en el archivo, celda por celda, con sus
 * valores exactos (D-X12: nunca el texto formateado, siempre el valor crudo).
 */

/** Valor crudo de una celda, tal como lo expone el lector (sin formatear). */
export type RawCellValue = string | number | boolean | Date | null;

/** Una fila con datos: solo las columnas que tienen algún valor. */
export interface RawRow {
  rowNumber: number;
  /** Clave: letra de columna (`A`, `B`, …, `AA`, …). */
  cells: Readonly<Record<string, RawCellValue>>;
}

/** Una hoja completa, con sus filas no vacías en orden. */
export interface RawSheet {
  name: string;
  rows: readonly RawRow[];
  /** Fila con datos más baja y más alta (informativo; una hoja vacía no tiene rango). */
  usedRange: { firstRow: number; lastRow: number } | null;
}

/** `1` → `A`, `26` → `Z`, `27` → `AA` (1-indexado, como las columnas de Excel). */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`Índice de columna no válido: ${index}`);
  }
  let n = index;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** `A` → `1`, `AA` → `27`. Inversa de {@link columnLetter}. */
export function columnIndex(letter: string): number {
  let n = 0;
  for (const char of letter.toUpperCase()) {
    if (char < 'A' || char > 'Z') throw new Error(`Letra de columna no válida: "${letter}"`);
    n = n * 26 + (char.charCodeAt(0) - 64);
  }
  return n;
}

/** Valor de una celda como texto, tal como lo pide D-X12 (para volcarlo a `import_rows.raw_values`). */
export function cellValueToJson(value: RawCellValue): string | number | boolean | null {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** `true` si la celda está realmente vacía (ni siquiera una cadena en blanco). */
export function isBlankCell(value: RawCellValue): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}
