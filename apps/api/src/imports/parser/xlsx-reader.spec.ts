import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from './xlsx-reader.js';

/** Construye un `.xlsx` real en memoria (con `exceljs`, el mismo lector que usa `readWorkbook`). */
async function buildWorkbook(fill: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  fill(sheet);
  const array = await workbook.xlsx.writeBuffer();
  return Buffer.from(array);
}

describe('readWorkbook (§113.9, D-X12, PostgreSQL no involucrado: solo bytes de un .xlsx real)', () => {
  it('lee los valores crudos exactos: números con muchos decimales, fechas, booleanos y texto', async () => {
    const bytes = await buildWorkbook((sheet) => {
      sheet.getCell('B11').value = 1;
      sheet.getCell('C11').value = new Date('2024-10-22T00:00:00.000Z');
      sheet.getCell('H11').value = 62.5;
      sheet.getCell('I11').value = 1.510016;
      sheet.getCell('J11').value = 'GANADO';
      sheet.getCell('K11').value = true;
    });
    const [sheet] = await readWorkbook(bytes);
    expect(sheet!.name).toBe('Rondas');
    const row = sheet!.rows.find((r) => r.rowNumber === 11)!;
    expect(row.cells.B).toBe(1);
    expect(row.cells.C).toEqual(new Date('2024-10-22T00:00:00.000Z'));
    expect(row.cells.H).toBe(62.5);
    expect(row.cells.I).toBe(1.510016); // los seis decimales de una cuota múltiple, exactos.
    expect(row.cells.J).toBe('GANADO');
    expect(row.cells.K).toBe(true);
  });

  it('lee el resultado calculado de una fórmula, nunca la fórmula en sí', async () => {
    const bytes = await buildWorkbook((sheet) => {
      sheet.getCell('H11').value = 62.5;
      sheet.getCell('I11').value = 1.75;
      // La misma fórmula que Betsafe usa para "A+G", con su resultado ya calculado por Excel.
      sheet.getCell('K11').value = { formula: 'H11*I11', result: 109.375 };
    });
    const [sheet] = await readWorkbook(bytes);
    const row = sheet!.rows.find((r) => r.rowNumber === 11)!;
    expect(row.cells.K).toBe(109.375);
  });

  it('lee texto enriquecido (varias líneas) como una sola cadena concatenada', async () => {
    const bytes = await buildWorkbook((sheet) => {
      sheet.getCell('F11').value = {
        richText: [
          { text: '*Manchester City vs Southampton:\r\n' },
          { text: 'Gana Manchester City' },
        ],
      };
    });
    const [sheet] = await readWorkbook(bytes);
    const row = sheet!.rows.find((r) => r.rowNumber === 11)!;
    // Un `.xlsx` real es XML: al leerlo, un salto de línea `\r\n` se normaliza a `\n` (regla del
    // propio estándar XML para el contenido de texto), a diferencia de lo que se ve leyendo los
    // bytes crudos sin pasar por un analizador XML conforme (como en el análisis de la 9.2.0).
    expect(row.cells.F).toBe('*Manchester City vs Southampton:\nGana Manchester City');
  });

  it('ignora las celdas vacías y no crea filas para las que no tienen ningún valor', async () => {
    const bytes = await buildWorkbook((sheet) => {
      sheet.getCell('B11').value = 1;
      sheet.getCell('B12').value = null;
      sheet.getRow(13); // fila tocada (con estilo, p. ej.) pero sin ningún valor.
    });
    const [sheet] = await readWorkbook(bytes);
    expect(sheet!.rows.map((r) => r.rowNumber)).toEqual([11]);
    expect(sheet!.usedRange).toEqual({ firstRow: 11, lastRow: 11 });
  });

  it('una hoja totalmente vacía no tiene rango usado', async () => {
    const bytes = await buildWorkbook(() => {});
    const [sheet] = await readWorkbook(bytes);
    expect(sheet!.rows).toEqual([]);
    expect(sheet!.usedRange).toBeNull();
  });

  it('lee varias hojas del mismo libro, cada una con sus propias filas', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Rondas').getCell('B11').value = 1;
    workbook.addWorksheet('Balances').getCell('B2').value = 'Total';
    workbook.addWorksheet('No Modificar').getCell('E4').value = 'GANADO';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const sheets = await readWorkbook(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Rondas', 'Balances', 'No Modificar']);
    expect(sheets[2]!.rows[0]!.cells.E).toBe('GANADO');
  });

  it('rechaza con un error de validación un archivo que no es un .xlsx', async () => {
    await expect(readWorkbook(Buffer.from('esto no es un xlsx'))).rejects.toMatchObject({
      status: 400,
    });
  });
});
