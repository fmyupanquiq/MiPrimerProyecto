import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from './xlsx-reader.js';
import { normalizeBetsafeSheet } from './betsafe-normalizer.js';

const TEMPLATE_DATE = new Date('2024-10-22T00:00:00.000Z');
const LIMA = 'America/Lima'; // UTC-5, sin horario de verano.

/** Mismo archivo sintético de la 9.2.1, con datos que no son el historial real de nadie. */
async function buildSyntheticBetsafeLikeFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  sheet.getCell('B8').value = 'RONDA 1';
  sheet.getCell('B10').value = 'N°';
  sheet.getCell('C10').value = 'FECHA';
  sheet.getCell('E10').value = 'DEPORTE';
  sheet.getCell('F10').value = 'PARTIDO';
  sheet.getCell('G10').value = 'TIPO';
  sheet.getCell('H10').value = 'APUESTA';
  sheet.getCell('I10').value = 'CUOTA';
  sheet.getCell('J10').value = 'RESULTADO';

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

  // N=1: simple válida, tipo declarado coincide con el derivado.
  row(1, {
    sport: 'FUTBOL',
    description: 'Equipo A vs. Equipo B:\r\nGana Equipo A',
    declaredType: 'Simple',
    amount: 62.5,
    odds: 1.75,
    result: 'GANADO',
  });
  // N=2: múltiple válida (dos bloques "*"), tipo declarado coincide.
  row(2, {
    sport: 'FUTBOL',
    description:
      '*Equipo C vs. Equipo D:\r\nGana Equipo C\r\n\r\n*Equipo E vs. Equipo F:\r\nGana Equipo E',
    declaredType: 'Multi',
    amount: 12.5,
    odds: 1.510016,
    result: 'PERDIDO',
  });
  // N=3: parcial (falta el resultado).
  row(3, {
    sport: 'FUTBOL',
    description: 'Equipo G vs. Equipo H:\r\nGana Equipo G',
    declaredType: 'Simple',
    amount: 25,
    odds: 2.1,
  });
  // N=4: inválida (resultado fuera del vocabulario).
  row(4, {
    sport: 'FUTBOL',
    description: 'Equipo I vs. Equipo J:\r\nGana Equipo I',
    declaredType: 'Simple',
    amount: 30,
    odds: 1.9,
    result: 'ANULADA',
  });
  // N=5: válida, PENDIENTE.
  row(5, {
    sport: 'TENIS',
    description: 'Equipo K vs. Equipo L:\r\nGana Equipo K',
    declaredType: 'Simple',
    amount: 40,
    odds: 1.8,
    result: 'PENDIENTE',
  });
  // N=6: válida, pero el texto es Multi (dos bloques) y el tipo declarado dice "Simple" (D-X24).
  row(6, {
    sport: 'FUTBOL',
    description:
      '*Equipo M vs. Equipo N:\r\nGana Equipo M\r\n\r\n*Equipo O vs. Equipo P:\r\nGana Equipo O',
    declaredType: 'Simple',
    amount: 50,
    odds: 2.2,
    result: 'GANADO',
  });
  // N=7..10: plantilla (solo fecha y deporte).
  for (let n = 7; n <= 10; n += 1) row(n, { sport: 'FUTBOL' });

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

describe('normalizeBetsafeSheet (Fase 9.2.2, §113, D-X15, D-X24, D-X7; datos sintéticos)', () => {
  it('convierte cada fila según su clasificación, sin escribir nada al ledger', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    expect(result.counts).toEqual({ VALID: 4, TEMPLATE: 4, EMPTY: 0, PARTIAL: 1, INVALID: 1 });
    expect(result.rows).toHaveLength(10); // filas 11-20, ninguna se pierde en silencio (D-X21).
    expect(result.bets).toHaveLength(4); // solo las VALID.

    // Ningún campo ni indicio de escritura: ni ledger, ni base de datos, ni id de nada creado.
    for (const bet of result.bets) {
      expect(bet).not.toHaveProperty('stageKey');
      expect(bet).not.toHaveProperty('stake');
    }
  });

  it('una apuesta simple (N=1): monto, cuota, hora del instante técnico y fecha de liquidación', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    const bet = result.bets.find((b) => b.rowNumber === 11)!;
    expect(bet).toMatchObject({
      amount: '62.50',
      visibleTotalOdds: '1.75',
      status: 'WON',
      placedTimeKnown: false,
      settledTimeKnown: false,
    });
    // D-X23: 12:00 en América/Lima (UTC-5) del 22 de octubre = 17:00 UTC.
    expect(bet.placedAt.toISOString()).toBe('2024-10-22T17:00:00.000Z');
    // D-X20: sin fecha de liquidación propia, la misma que la de colocación.
    expect(bet.settledAt!.toISOString()).toBe(bet.placedAt.toISOString());
    expect(bet.selections).toEqual([
      {
        eventGroup: 0,
        position: 0,
        sport: 'FUTBOL',
        event: 'Equipo A vs. Equipo B',
        market: null,
        selection: 'Gana Equipo A',
        visibleOdds: null,
      },
    ]);

    const report = result.rows.find((r) => r.rowNumber === 11)!;
    expect(report).toMatchObject({
      status: 'VALID',
      findings: [],
      declaredType: 'Simple',
      derivedType: 'SIMPLE',
      typeMismatch: false,
    });
  });

  it('una apuesta múltiple (N=2): dos selecciones sin cuota individual, cuota total intacta', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    const bet = result.bets.find((b) => b.rowNumber === 12)!;
    expect(bet.visibleTotalOdds).toBe('1.510016'); // los seis decimales, exactos (D-X15).
    expect(bet.status).toBe('LOST');
    expect(bet.settledAt).toEqual(bet.placedAt); // liquidada: misma fecha (D-X20).
    expect(bet.selections).toHaveLength(2);
    expect(bet.selections.every((s) => s.visibleOdds === null)).toBe(true);
    expect(bet.selections.map((s) => s.event)).toEqual([
      'Equipo C vs. Equipo D',
      'Equipo E vs. Equipo F',
    ]);

    const report = result.rows.find((r) => r.rowNumber === 12)!;
    expect(report).toMatchObject({
      declaredType: 'Multi',
      derivedType: 'MULTIPLE',
      typeMismatch: false,
    });
  });

  it('una apuesta pendiente (N=5): sin fecha de liquidación', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    const bet = result.bets.find((b) => b.rowNumber === 15)!;
    expect(bet).toMatchObject({ status: 'PENDING', settledAt: null, settledTimeKnown: true });
  });

  it('D-X24: cuando el tipo declarado y el derivado del texto no coinciden, se avisa sin bloquear', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    // N=6: el texto tiene dos bloques "*" (multi), pero la columna TIPO dice "Simple".
    const report = result.rows.find((r) => r.rowNumber === 16)!;
    expect(report).toMatchObject({
      status: 'VALID',
      declaredType: 'Simple',
      derivedType: 'MULTIPLE',
      typeMismatch: true,
    });
    // No bloquea: la apuesta se sigue creando con normalidad.
    expect(result.bets.find((b) => b.rowNumber === 16)).toBeDefined();
  });

  it('una fila PARTIAL (N=3) y una INVALID (N=4) se reportan, sin generar apuesta', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    const partial = result.rows.find((r) => r.rowNumber === 13)!;
    expect(partial).toMatchObject({
      status: 'PARTIAL',
      declaredType: 'Simple',
      derivedType: null,
      typeMismatch: false,
    });
    expect(partial.findings).toEqual([{ code: 'MISSING_RESULT', message: 'Falta el resultado.' }]);

    const invalid = result.rows.find((r) => r.rowNumber === 14)!;
    expect(invalid.status).toBe('INVALID');
    expect(invalid.findings[0]).toMatchObject({ code: 'INVALID_RESULT' });

    expect(result.bets.some((b) => b.rowNumber === 13 || b.rowNumber === 14)).toBe(false);
  });

  it('las filas de plantilla (N=7..10) se reportan como TEMPLATE, sin tipo ni hallazgos', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    for (let rowNumber = 17; rowNumber <= 20; rowNumber += 1) {
      const report = result.rows.find((r) => r.rowNumber === rowNumber)!;
      expect(report).toMatchObject({
        status: 'TEMPLATE',
        findings: [],
        declaredType: null,
        derivedType: null,
        typeMismatch: false,
      });
    }
  });

  it('D-X7: genera un candidato de etapa con evidencia, sin crear ninguna etapa real', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });

    expect(result.stageCandidates).toEqual([
      {
        label: 'RONDA 1',
        labelRow: 8,
        firstRow: 8,
        lastRow: 20,
        evidence: expect.stringContaining('RONDA 1') as string,
      },
    ]);
    for (const candidate of result.stageCandidates) {
      expect(candidate).not.toHaveProperty('stageId');
    }
  });
});
