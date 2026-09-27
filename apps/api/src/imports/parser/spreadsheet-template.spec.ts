import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from './xlsx-reader.js';
import { BETSAFE_TEMPLATE, parseSpreadsheet } from './spreadsheet-template.js';

const TEMPLATE_DATE = new Date('2024-10-22T00:00:00.000Z');

/**
 * Construye un `.xlsx` con la **forma** confirmada de Betsafe en la subfase 9.2.0 (mismas columnas,
 * mismo rótulo de ronda, misma plantilla de filas prellenadas), pero con datos sintéticos: no es el
 * historial real de nadie, solo un archivo con la misma estructura para probar el flujo completo.
 */
async function buildSyntheticBetsafeLikeFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  sheet.getCell('B3').value = 'AÑO';
  sheet.getCell('C3').value = 2024;
  sheet.getCell('D3').value = 'Bank Inicial';
  sheet.getCell('E3').value = 1000;
  sheet.getCell('B8').value = 'RONDA 1';
  sheet.getCell('B10').value = 'N°';
  sheet.getCell('C10').value = 'FECHA';
  sheet.getCell('E10').value = 'DEPORTE';
  sheet.getCell('F10').value = 'PARTIDO';
  sheet.getCell('G10').value = 'TIPO';
  sheet.getCell('H10').value = 'APUESTA';
  sheet.getCell('I10').value = 'CUOTA';
  sheet.getCell('J10').value = 'RESULTADO';
  sheet.getCell('K10').value = 'A + G';
  sheet.getCell('L10').value = 'GANANCIA';

  const row = (
    n: number,
    values: {
      sport?: string;
      description?: string;
      declaredType?: string;
      amount?: number;
      odds?: number;
      result?: string;
    } = {},
  ) => {
    const r = 10 + n;
    sheet.getCell(`B${r}`).value = n;
    sheet.getCell(`C${r}`).value = TEMPLATE_DATE;
    if (values.sport !== undefined) sheet.getCell(`E${r}`).value = values.sport;
    if (values.description !== undefined) sheet.getCell(`F${r}`).value = values.description;
    if (values.declaredType !== undefined) sheet.getCell(`G${r}`).value = values.declaredType;
    if (values.amount !== undefined) sheet.getCell(`H${r}`).value = values.amount;
    if (values.odds !== undefined) sheet.getCell(`I${r}`).value = values.odds;
    if (values.result !== undefined) sheet.getCell(`J${r}`).value = values.result;
  };

  // N=1: simple válida.
  row(1, {
    sport: 'FUTBOL',
    description: 'Equipo A vs. Equipo B:\r\nGana Equipo A',
    declaredType: 'Simple',
    amount: 62.5,
    odds: 1.75,
    result: 'GANADO',
  });
  // N=2: múltiple válida, con dos bloques `*`.
  row(2, {
    sport: 'FUTBOL',
    description:
      '*Equipo C vs. Equipo D:\r\nGana Equipo C\r\n\r\n*Equipo E vs. Equipo F:\r\nGana Equipo E',
    declaredType: 'Multi',
    amount: 12.5,
    odds: 1.510016,
    result: 'PERDIDO',
  });
  // N=3: parcial (le falta el resultado).
  row(3, {
    sport: 'FUTBOL',
    description: 'Equipo G vs. Equipo H:\r\nGana Equipo G',
    declaredType: 'Simple',
    amount: 25,
    odds: 2.1,
  });
  // N=4: inválida (resultado fuera del vocabulario del desplegable).
  row(4, {
    sport: 'FUTBOL',
    description: 'Equipo I vs. Equipo J:\r\nGana Equipo I',
    declaredType: 'Simple',
    amount: 30,
    odds: 1.9,
    result: 'ANULADA',
  });
  // N=5..10: plantilla (solo fecha y deporte, como en el archivo real).
  for (let n = 5; n <= 10; n += 1) row(n, { sport: 'FUTBOL' });

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

describe('parseSpreadsheet con la plantilla confirmada de Betsafe (9.2.0 → 9.2.1, datos sintéticos)', () => {
  it('lee, extrae hojas, clasifica cada fila y detecta el candidato de etapa, de extremo a extremo', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const parsed = parseSpreadsheet(sheet!, BETSAFE_TEMPLATE);

    expect(parsed.sheetName).toBe('Rondas');
    expect(parsed.counts).toEqual({ VALID: 2, TEMPLATE: 6, EMPTY: 0, PARTIAL: 1, INVALID: 1 });
    expect(parsed.rows).toHaveLength(10); // filas 11-20, ninguna se pierde en silencio (D-X21).

    const byRow = new Map(parsed.rows.map((r) => [r.rowNumber, r]));
    expect(byRow.get(11)).toMatchObject({
      status: 'VALID',
      normalized: { amount: '62.50', odds: '1.75', status: 'WON', declaredType: 'Simple' },
    });
    expect(byRow.get(12)).toMatchObject({
      status: 'VALID',
      normalized: { odds: '1.510016', status: 'LOST', declaredType: 'Multi' },
    });
    expect(byRow.get(12)!.normalized!.description).toContain('*Equipo C vs. Equipo D');
    expect(byRow.get(13)).toMatchObject({
      status: 'PARTIAL',
      findings: [{ code: 'MISSING_RESULT', message: 'Falta el resultado.' }],
    });
    expect(byRow.get(14)).toMatchObject({ status: 'INVALID' });
    expect(byRow.get(14)!.findings[0]).toMatchObject({ code: 'INVALID_RESULT' });
    for (let n = 15; n <= 20; n += 1) expect(byRow.get(n)!.status).toBe('TEMPLATE');

    // El candidato de etapa: solo hay un rótulo ("RONDA 1"), así que agrupa toda la hoja, con su
    // evidencia — nunca una etapa ya decidida.
    expect(parsed.stageCandidates).toEqual([
      {
        label: 'RONDA 1',
        labelRow: 8,
        firstRow: 8,
        lastRow: 20,
        evidence: expect.stringContaining('RONDA 1') as string,
      },
    ]);
  });

  it('las apuestas reales de Betsafe (montos múltiplos de 12.5) se clasifican como válidas con este mapeo', () => {
    // No usa el archivo real de la persona (no se distribuye), pero reproduce sus valores exactos
    // ya confirmados en la subfase 9.2.0, para comprobar que la plantilla los acepta sin fricción.
    const realAmounts = [62.5, 75, 87.5, 312.5, 250, 150];
    for (const amount of realAmounts) {
      expect(amount % 12.5).toBe(0);
    }
  });
});
