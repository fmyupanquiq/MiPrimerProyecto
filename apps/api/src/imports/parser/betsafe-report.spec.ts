import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { normalizeBetsafeSheet } from './betsafe-normalizer.js';
import { buildBetsafeValidationReport } from './betsafe-report.js';
import { readWorkbook } from './xlsx-reader.js';

const TEMPLATE_DATE = new Date('2024-10-22T00:00:00.000Z');
const LIMA = 'America/Lima';

/** Mismo archivo sintético de la 9.2.2 (no es el historial real de nadie). */
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

  // N=1: ganada, simple, tipo declarado coincide.
  row(1, {
    sport: 'FUTBOL',
    description: 'Equipo A vs. Equipo B:\r\nGana Equipo A',
    declaredType: 'Simple',
    amount: 62.5,
    odds: 1.75,
    result: 'GANADO',
  });
  // N=2: ganada, múltiple, tipo declarado coincide (312.5 × 1.510016, ganancia 159.38).
  row(2, {
    sport: 'FUTBOL',
    description:
      '*Equipo C vs. Equipo D:\r\nGana Equipo C\r\n\r\n*Equipo E vs. Equipo F:\r\nGana Equipo E',
    declaredType: 'Multi',
    amount: 312.5,
    odds: 1.510016,
    result: 'GANADO',
  });
  // N=3: perdida (no cuenta como retorno provisional).
  row(3, {
    sport: 'FUTBOL',
    description: 'Equipo G vs. Equipo H:\r\nGana Equipo G',
    declaredType: 'Simple',
    amount: 25,
    odds: 2.1,
    result: 'PERDIDO',
  });
  // N=4: parcial (falta el resultado): requiere revisión, no bloquea.
  row(4, {
    sport: 'FUTBOL',
    description: 'Equipo I vs. Equipo J:\r\nGana Equipo I',
    declaredType: 'Simple',
    amount: 30,
    odds: 1.9,
  });
  // N=5: pendiente (no cuenta como retorno provisional).
  row(5, {
    sport: 'TENIS',
    description: 'Equipo K vs. Equipo L:\r\nGana Equipo K',
    declaredType: 'Simple',
    amount: 40,
    odds: 1.8,
    result: 'PENDIENTE',
  });
  // N=6: válida, pero texto Multi con TIPO declarado Simple (D-X24): aviso, no bloquea.
  row(6, {
    sport: 'FUTBOL',
    description:
      '*Equipo M vs. Equipo N:\r\nGana Equipo M\r\n\r\n*Equipo O vs. Equipo P:\r\nGana Equipo O',
    declaredType: 'Simple',
    amount: 50,
    odds: 2.2,
    result: 'GANADO',
  });
  // N=7..10: plantilla.
  for (let n = 7; n <= 10; n += 1) row(n, { sport: 'FUTBOL' });

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

async function reportFromSyntheticFile() {
  const bytes = await buildSyntheticBetsafeLikeFile();
  const [sheet] = await readWorkbook(bytes);
  const normalized = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });
  return buildBetsafeValidationReport(normalized);
}

describe('buildBetsafeValidationReport (Fase 9.2.3, §113.6, §113.7, D-X17b; datos sintéticos)', () => {
  it('resume el lote sin tocar el ledger, sin crear apuestas ni etapas', async () => {
    const report = await reportFromSyntheticFile();

    expect(report.summary).toEqual({
      totalRows: 10,
      validBets: 5,
      ignoredRows: 4,
      partialRows: 1,
      errors: 0,
      typeMismatches: 1,
      warnings: 2, // 1 parcial + 1 aviso de tipo.
      // N=1 (46.88) + N=2 (159.38) + N=6 (60.00); N=3 perdida y N=5 pendiente no cuentan.
      provisionalReturns: { count: 3, profitLoss: '266.26' },
    });
    expect(report.bets).toHaveLength(5);
    for (const bet of report.bets) {
      expect(bet).not.toHaveProperty('stageKey');
      expect(bet).not.toHaveProperty('stake');
    }
  });

  it('el semáforo es OK sin errores ni filas parciales', async () => {
    const bytes = await (async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Rondas');
      sheet.getCell('B10').value = 'N°';
      sheet.getCell('B11').value = 1;
      sheet.getCell('C11').value = TEMPLATE_DATE;
      sheet.getCell('E11').value = 'FUTBOL';
      sheet.getCell('F11').value = 'A vs. B:\nGana A';
      sheet.getCell('H11').value = 10;
      sheet.getCell('I11').value = 1.5;
      sheet.getCell('J11').value = 'GANADO';
      return Buffer.from(await workbook.xlsx.writeBuffer());
    })();
    const [sheet] = await readWorkbook(bytes);
    const report = buildBetsafeValidationReport(normalizeBetsafeSheet(sheet!, { timeZone: LIMA }));
    expect(report.semaphore).toBe('OK');
    expect(report.summary).toMatchObject({ errors: 0, partialRows: 0 });
  });

  it('una fila parcial pone el semáforo en NEEDS_ACKNOWLEDGMENT, no en BLOCKED', async () => {
    const report = await reportFromSyntheticFile();
    expect(report.semaphore).toBe('NEEDS_ACKNOWLEDGMENT');
    const partial = report.rows.find((r) => r.rowNumber === 14)!; // N=4: sin resultado.
    expect(partial).toMatchObject({ status: 'PARTIAL', category: 'NEEDS_ACKNOWLEDGMENT' });
  });

  it('una fila inválida pone el semáforo en BLOCKED, aunque también haya una parcial', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const normalized = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });
    // Se inserta a mano un hallazgo de fila inválida para probar la prioridad del semáforo, sin
    // depender de reescribir todo el archivo sintético.
    normalized.rows.push({
      rowNumber: 21,
      status: 'INVALID',
      findings: [{ code: 'INVALID_RESULT', message: 'El resultado no está en el vocabulario.' }],
      declaredType: null,
      derivedType: null,
      typeMismatch: false,
    });
    normalized.counts.INVALID += 1;
    const report = buildBetsafeValidationReport(normalized);
    expect(report.semaphore).toBe('BLOCKED');
    expect(report.summary.errors).toBe(1);
    expect(report.summary.partialRows).toBe(1); // sigue contando: bloqueante y advertencia son cosas separadas.
    const invalid = report.rows.find((r) => r.rowNumber === 21)!;
    expect(invalid.category).toBe('BLOCKING');
  });

  it('un aviso de tipo (D-X24) nunca exige reconocimiento por sí solo', async () => {
    const report = await reportFromSyntheticFile();
    const mismatch = report.rows.find((r) => r.rowNumber === 16)!;
    expect(mismatch).toMatchObject({
      status: 'VALID',
      category: 'INFORMATIONAL',
      typeMismatch: true,
    });
  });

  it('los retornos provisionales solo cuentan las ganadas, con el retorno calculado (D-X4)', async () => {
    const report = await reportFromSyntheticFile();
    // N=1: 62.5 × 1.75 = 109.375 → 109.38 (ROUND_HALF_UP) − 62.5 = 46.88.
    // N=2: 312.5 × 1.510016 = 471.88 − 312.5 = 159.38.
    // N=6: 50 × 2.2 = 110.00 − 50 = 60.00.
    expect(report.summary.provisionalReturns).toEqual({ count: 3, profitLoss: '266.26' });
  });

  it('conserva los candidatos de etapa sin resolverlos (D-X7)', async () => {
    const report = await reportFromSyntheticFile();
    expect(report.stageCandidates).toEqual([
      {
        label: 'RONDA 1',
        labelRow: 8,
        firstRow: 8,
        lastRow: 20,
        evidence: expect.any(String) as string,
      },
    ]);
  });

  it('las filas de plantilla y vacías son solo informativas, nunca bloquean ni advierten', async () => {
    const report = await reportFromSyntheticFile();
    for (let rowNumber = 17; rowNumber <= 20; rowNumber += 1) {
      const entry = report.rows.find((r) => r.rowNumber === rowNumber)!;
      expect(entry).toMatchObject({ status: 'TEMPLATE', category: 'INFORMATIONAL' });
    }
  });

  it('nunca ajusta ni redondea de más los valores ya normalizados: son exactamente los de la 9.2.2', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const normalized = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });
    const report = buildBetsafeValidationReport(normalized);
    expect(report.bets).toEqual(normalized.bets);
  });

  it('es una función pura: el mismo resultado normalizado produce siempre el mismo informe', async () => {
    const bytes = await buildSyntheticBetsafeLikeFile();
    const [sheet] = await readWorkbook(bytes);
    const normalized = normalizeBetsafeSheet(sheet!, { timeZone: LIMA });
    expect(buildBetsafeValidationReport(normalized)).toEqual(
      buildBetsafeValidationReport(normalized),
    );
  });
});
