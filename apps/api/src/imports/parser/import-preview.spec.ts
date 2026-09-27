import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG } from './betsafe-adapter.js';
import { buildExcelFinancialContrast } from './excel-financial-contrast.js';
import { normalizeImportSheet, type ImportOriginAdapter } from './import-normalization.js';
import { buildImportValidationReport } from './import-validation-report.js';
import {
  buildImportPreview,
  deriveCandidateHouseName,
  type ImportPreviewFile,
} from './import-preview.js';
import type { RawSheet } from './sheet-model.js';
import { readWorkbook } from './xlsx-reader.js';

const TIME_ZONE = 'America/Lima';

/**
 * Ejecuta el pipeline completo (Fase 9.2.6) sobre una hoja ya leída, con el adaptador y la
 * configuración de contraste financiero indicados. Ninguno de estos datos es el historial real de
 * nadie: son archivos sintéticos construidos solo para la prueba.
 */
function runPipeline(
  sheet: RawSheet,
  adapter: ImportOriginAdapter,
  financialConfig: Parameters<typeof buildExcelFinancialContrast>[2],
  file: ImportPreviewFile = {
    originalName: 'Betsafe.xlsx',
    sizeBytes: 1234,
    sha256: 'a'.repeat(64),
  },
) {
  const normalization = normalizeImportSheet(sheet, adapter, { timeZone: TIME_ZONE });
  const validation = buildImportValidationReport(normalization);
  const financialContrast = buildExcelFinancialContrast(sheet, normalization.bets, financialConfig);
  return buildImportPreview({
    file,
    originName: adapter.name,
    normalization,
    validation,
    financialContrast,
    timeZone: TIME_ZONE,
  });
}

/** Construye una hoja con la forma confirmada de Betsafe (§113, 9.2.0), con filas configurables. */
async function buildBetsafeSheet(options: {
  initialBank?: number;
  rows: {
    row: number;
    sport?: string;
    description?: string;
    declaredType?: string;
    amount?: number;
    odds?: number;
    result?: string;
    totalReturn?: number; // A+G del Excel (columna K)
    profit?: number; // GANANCIA del Excel (columna L)
  }[];
}): Promise<RawSheet> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  if (options.initialBank !== undefined) sheet.getCell('E3').value = options.initialBank;
  sheet.getCell('B8').value = 'RONDA 1';
  for (const row of options.rows) {
    sheet.getCell(`B${row.row}`).value = row.row - 10;
    sheet.getCell(`C${row.row}`).value = new Date('2024-10-22T00:00:00.000Z');
    if (row.sport !== undefined) sheet.getCell(`E${row.row}`).value = row.sport;
    if (row.description !== undefined) sheet.getCell(`F${row.row}`).value = row.description;
    if (row.declaredType !== undefined) sheet.getCell(`G${row.row}`).value = row.declaredType;
    if (row.amount !== undefined) sheet.getCell(`H${row.row}`).value = row.amount;
    if (row.odds !== undefined) sheet.getCell(`I${row.row}`).value = row.odds;
    if (row.result !== undefined) sheet.getCell(`J${row.row}`).value = row.result;
    if (row.totalReturn !== undefined) sheet.getCell(`K${row.row}`).value = row.totalReturn;
    if (row.profit !== undefined) sheet.getCell(`L${row.row}`).value = row.profit;
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const [rawSheet] = await readWorkbook(bytes);
  return rawSheet!;
}

describe('buildImportPreview (Fase 9.2.6, §113, ADR 0020; sin efectos secundarios)', () => {
  it('un lote completamente válido: archivo, resumen, capital, apuestas y contraste', async () => {
    const sheet = await buildBetsafeSheet({
      initialBank: 1000,
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description: 'Equipo A vs. Equipo B:\nGana Equipo A',
          declaredType: 'Simple',
          amount: 62.5,
          odds: 1.75,
          result: 'GANADO',
          totalReturn: 109.375,
          profit: 46.875,
        },
        {
          row: 12,
          sport: 'FUTBOL',
          description: 'Equipo C vs. Equipo D:\nGana Equipo C',
          declaredType: 'Simple',
          amount: 75,
          odds: 1.57,
          result: 'PERDIDO',
          totalReturn: -75,
          profit: -75,
        },
      ],
    });
    const file: ImportPreviewFile = {
      originalName: 'Betsafe.xlsx',
      sizeBytes: 173496,
      sha256: createHash('sha256').update('contenido de prueba').digest('hex'),
    };
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG, file);

    expect(preview.file).toEqual(file);
    expect(preview.origin).toBe('Betsafe');
    expect(preview.summary).toEqual({
      totalRows: 2,
      valid: 2,
      template: 0,
      empty: 0,
      partial: 0,
      invalid: 0,
      preliminaryBets: 2,
    });
    expect(preview.semaphore).toBe('OK');

    expect(preview.capital).toMatchObject({
      detected: true,
      amount: '1000.00',
      houseCandidate: 'Betsafe',
      occurredAtKnown: false,
    });
    // D-X23: medianoche (Lima, UTC-5) del 22 de octubre = 05:00 UTC.
    expect(preview.capital.occurredAt).toBe('2024-10-22T05:00:00.000Z');

    expect(preview.bets).toHaveLength(2);
    expect(preview.bets[0]).toMatchObject({
      rowNumber: 11,
      amount: '62.50',
      visibleTotalOdds: '1.75',
      status: 'WON',
      declaredType: 'Simple',
      derivedType: 'SIMPLE',
      typeMismatch: false,
      provisionalReturn: '109.38',
    });
    expect(preview.bets[1]).toMatchObject({ status: 'LOST', provisionalReturn: null });

    expect(preview.stages.candidates).toEqual([
      {
        label: 'RONDA 1',
        labelRow: 8,
        firstRow: 8,
        lastRow: 12,
        evidence: expect.any(String) as string,
      },
    ]);

    expect(preview.financialContrast.semaphore).toBe('GREEN');
    expect(preview.financialContrast.bets).toHaveLength(2);
  });

  it('un lote con filas de plantilla: se cuentan, sin generar apuesta ni advertencia', async () => {
    const sheet = await buildBetsafeSheet({
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description: 'Equipo A vs. Equipo B:\nGana Equipo A',
          declaredType: 'Simple',
          amount: 20,
          odds: 1.5,
          result: 'GANADO',
        },
        { row: 12, sport: 'FUTBOL' },
        { row: 13, sport: 'FUTBOL' },
      ],
    });
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);

    expect(preview.summary).toMatchObject({
      totalRows: 3,
      valid: 1,
      template: 2,
      preliminaryBets: 1,
    });
    expect(preview.semaphore).toBe('OK');
    const templateRows = preview.rows.filter((r) => r.status === 'TEMPLATE');
    expect(templateRows).toHaveLength(2);
    expect(templateRows.every((r) => r.category === 'INFORMATIONAL')).toBe(true);
  });

  it('un lote con una fila parcial: requiere reconocimiento, no bloquea', async () => {
    const sheet = await buildBetsafeSheet({
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description: 'Equipo A vs. Equipo B:\nGana Equipo A',
          declaredType: 'Simple',
          amount: 20,
          odds: 1.5,
          // sin resultado: parcial.
        },
      ],
    });
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);

    expect(preview.semaphore).toBe('NEEDS_ACKNOWLEDGMENT');
    expect(preview.summary).toMatchObject({ partial: 1, valid: 0, preliminaryBets: 0 });
    const partial = preview.rows.find((r) => r.rowNumber === 11)!;
    expect(partial).toMatchObject({
      status: 'PARTIAL',
      category: 'NEEDS_ACKNOWLEDGMENT',
      findings: [{ code: 'MISSING_RESULT', message: 'Falta el resultado.' }],
    });
    expect(preview.bets).toEqual([]);
  });

  it('un lote bloqueado por un error: BLOCKED, sin apuesta para esa fila', async () => {
    const sheet = await buildBetsafeSheet({
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description: 'Equipo A vs. Equipo B:\nGana Equipo A',
          declaredType: 'Simple',
          amount: 20,
          odds: 1.5,
          result: 'ANULADA', // fuera del vocabulario de RESULTADO de Betsafe.
        },
      ],
    });
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);

    expect(preview.semaphore).toBe('BLOCKED');
    expect(preview.summary).toMatchObject({ invalid: 1, valid: 0 });
    const invalid = preview.rows.find((r) => r.rowNumber === 11)!;
    expect(invalid).toMatchObject({ status: 'INVALID', category: 'BLOCKING' });
    expect(invalid.findings[0]).toMatchObject({ code: 'INVALID_RESULT' });
  });

  it('una diferencia financiera explicable por redondeo: amarillo, no rojo', async () => {
    const rows = [11, 12, 13].map((row) => ({
      row,
      sport: 'FUTBOL',
      description: `Equipo ${row} vs. Rival:\nGana Equipo ${row}`,
      declaredType: 'Simple',
      amount: 62.5,
      odds: 1.75,
      result: 'GANADO' as const,
      totalReturn: 109.375,
      profit: 46.875,
    }));
    const sheet = await buildBetsafeSheet({ rows });
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);

    expect(preview.semaphore).toBe('OK'); // D-X17b: estructuralmente, nada bloquea ni requiere revisión.
    expect(preview.financialContrast.bets.every((b) => b.semaphore === 'GREEN')).toBe(true);
    expect(preview.financialContrast.semaphore).toBe('YELLOW'); // §113.7: el total ya no es verde.
  });

  it('D-X24: un aviso de tipo (texto Multi, columna TIPO dice Simple) aparece en la vista previa', async () => {
    const sheet = await buildBetsafeSheet({
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description:
            '*Equipo A vs. Equipo B:\nGana Equipo A\n\n*Equipo C vs. Equipo D:\nGana Equipo C',
          declaredType: 'Simple',
          amount: 20,
          odds: 2.5,
          result: 'GANADO',
        },
      ],
    });
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);

    expect(preview.semaphore).toBe('OK'); // D-X24: nunca bloquea ni exige reconocimiento por sí solo.
    const row = preview.rows.find((r) => r.rowNumber === 11)!;
    expect(row).toMatchObject({
      declaredType: 'Simple',
      derivedType: 'MULTIPLE',
      typeMismatch: true,
    });
    expect(preview.bets[0]!.typeMismatch).toBe(true);
    expect(preview.bets[0]!.selections).toHaveLength(2);
  });

  it('un múltiple: sus selecciones nunca traen cuota individual (D-X15), la cuota total sigue siendo la autoridad', async () => {
    const sheet = await buildBetsafeSheet({
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description:
            '*Equipo A vs. Equipo B:\nGana Equipo A\n\n*Equipo C vs. Equipo D:\nGana Equipo C',
          declaredType: 'Multi',
          amount: 12.5,
          odds: 1.510016,
          result: 'GANADO',
        },
      ],
    });
    const preview = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);

    const bet = preview.bets[0]!;
    expect(bet.visibleTotalOdds).toBe('1.510016'); // los seis decimales, exactos.
    expect(bet.selections).toHaveLength(2);
    expect(bet.selections.every((s) => s.visibleOdds === null)).toBe(true);
    expect(bet.typeMismatch).toBe(false); // "Multi" declarado coincide con el derivado.
  });

  it('nunca escribe nada, ni crea import_batches, ni resuelve una etapa: es una función pura', async () => {
    const sheet = await buildBetsafeSheet({
      rows: [
        {
          row: 11,
          sport: 'FUTBOL',
          description: 'Equipo A vs. Equipo B:\nGana Equipo A',
          declaredType: 'Simple',
          amount: 20,
          odds: 1.5,
          result: 'GANADO',
        },
      ],
    });
    const first = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);
    const second = runPipeline(sheet, BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG);
    expect(first).toEqual(second);
    for (const candidate of first.stages.candidates) {
      expect(candidate).not.toHaveProperty('stageId');
    }
    expect(first).not.toHaveProperty('importBatchId');
    expect(first).not.toHaveProperty('permissions');
  });

  it('es agnóstica de origen: funciona con un adaptador que no es Betsafe, sin ningún cambio', async () => {
    const fakeAdapter: ImportOriginAdapter = {
      name: 'Origen de prueba',
      template: {
        name: 'Origen de prueba',
        firstDataRow: 2,
        columns: { date: 'A', description: 'B', amount: 'C', odds: 'D', result: 'E' },
        resultVocabulary: { WIN: 'WON', LOSE: 'LOST' },
        stageLabel: { column: 'A', pattern: /^SEASON/i },
      },
      parseSelections: (description, sport) => [
        {
          eventGroup: 0,
          position: 0,
          sport,
          event: description,
          market: null,
          selection: description,
          visibleOdds: null,
        },
      ],
      declaredTypeVocabulary: {},
    };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bets');
    sheet.getCell('A2').value = new Date('2026-01-10T00:00:00.000Z');
    sheet.getCell('B2').value = 'Alpha wins';
    sheet.getCell('C2').value = 10;
    sheet.getCell('D2').value = 2;
    sheet.getCell('E2').value = 'WIN';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const [rawSheet] = await readWorkbook(bytes);

    const preview = runPipeline(rawSheet!, fakeAdapter, {
      firstDataRow: 2,
      computedColumns: { totalReturn: 'F', profit: 'G' }, // el origen falso no tiene estas columnas: siempre null.
      headerCells: {},
    });

    expect(preview.origin).toBe('Origen de prueba');
    expect(preview.bets).toHaveLength(1);
    expect(preview.bets[0]).toMatchObject({
      amount: '10.00',
      status: 'WON',
      provisionalReturn: '20.00',
    });
    expect(preview.capital.amount).toBeNull(); // sin celda de capital configurada para este origen.
    expect(preview.financialContrast.bets[0]).toMatchObject({
      excelTotalReturn: null,
      excelProfit: null,
      semaphore: 'GREEN',
    });
  });
});

describe('deriveCandidateHouseName (D-X8)', () => {
  it.each([
    ['Betsafe.xlsx', 'Betsafe'],
    ['Betano.xlsx', 'Betano'],
    ['Historial 2024.xlsx', 'Historial 2024'],
    ['betsafe', 'betsafe'],
    ['Betsafe.XLSX', 'Betsafe'],
  ])('%s → %s', (originalName, expected) => {
    expect(deriveCandidateHouseName(originalName)).toBe(expected);
  });
});
