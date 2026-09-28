import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { BETSAFE_ADAPTER, BETSAFE_FINANCIAL_CONTRAST_CONFIG } from './betsafe-adapter.js';
import { buildExcelFinancialContrast } from './excel-financial-contrast.js';
import { normalizeImportSheet, type ImportOriginAdapter } from './import-normalization.js';
import { buildImportPreview, type ImportPreviewFile } from './import-preview.js';
import { runImportAnalysisPipeline, runImportPreviewPipeline } from './import-preview-pipeline.js';
import { buildImportValidationReport } from './import-validation-report.js';
import { readWorkbook } from './xlsx-reader.js';

const TIME_ZONE = 'America/Lima';
const FILE_META: ImportPreviewFile = {
  originalName: 'Betsafe.xlsx',
  sizeBytes: 173496,
  sha256: 'a'.repeat(64),
};

/** Hoja con la forma confirmada de Betsafe (§113, 9.2.0); datos sintéticos, no el archivo de nadie. */
async function buildBetsafeWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  sheet.getCell('E3').value = 1000;
  sheet.getCell('B8').value = 'RONDA 1';
  const row = (
    n: number,
    values: {
      description: string;
      amount: number;
      odds: number;
      result: string;
      totalReturn: number;
      profit: number;
    },
  ) => {
    const r = 10 + n;
    sheet.getCell(`B${r}`).value = n;
    sheet.getCell(`C${r}`).value = new Date('2024-10-22T00:00:00.000Z');
    sheet.getCell(`E${r}`).value = 'FUTBOL';
    sheet.getCell(`F${r}`).value = values.description;
    sheet.getCell(`G${r}`).value = 'Simple';
    sheet.getCell(`H${r}`).value = values.amount;
    sheet.getCell(`I${r}`).value = values.odds;
    sheet.getCell(`J${r}`).value = values.result;
    sheet.getCell(`K${r}`).value = values.totalReturn;
    sheet.getCell(`L${r}`).value = values.profit;
  };
  row(1, {
    description: 'Equipo A vs. Equipo B:\nGana Equipo A',
    amount: 62.5,
    odds: 1.75,
    result: 'GANADO',
    totalReturn: 109.375,
    profit: 46.875,
  });
  row(2, {
    description: 'Equipo C vs. Equipo D:\nGana Equipo C',
    amount: 75,
    odds: 1.57,
    result: 'PERDIDO',
    totalReturn: -75,
    profit: -75,
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('runImportPreviewPipeline (Fase 9.3.2, §113, ADR 0020; sin base de datos)', () => {
  it('pipeline completo con un .xlsx sintético con la forma de Betsafe', async () => {
    const file = await buildBetsafeWorkbook();
    const preview = await runImportPreviewPipeline({
      file,
      adapter: BETSAFE_ADAPTER,
      fileMeta: FILE_META,
      timeZone: TIME_ZONE,
    });

    expect(preview.file).toEqual(FILE_META);
    expect(preview.origin).toBe('Betsafe');
    expect(preview.summary).toMatchObject({ totalRows: 2, valid: 2, preliminaryBets: 2 });
    expect(preview.semaphore).toBe('OK');
    expect(preview.capital).toMatchObject({
      detected: true,
      amount: '1000.00',
      houseCandidate: 'Betsafe',
    });
    expect(preview.bets).toHaveLength(2);
    expect(preview.bets[0]).toMatchObject({
      amount: '62.50',
      status: 'WON',
      provisionalReturn: '109.38',
    });
    expect(preview.financialContrast.bets).toHaveLength(2);
    expect(preview.financialContrast.initialBankAmount).toBe('1000.00');
    // Ni casa, ni etapas, ni stake resueltos: sigue siendo un candidato, no una decisión tomada.
    expect(preview.stages.candidates[0]).not.toHaveProperty('stageId');
    expect(preview.bets[0]).not.toHaveProperty('stageKey');
    expect(preview.bets[0]).not.toHaveProperty('stake');
  });

  it('pipeline completo con un adaptador ficticio que no es Betsafe, sin ningún cambio', async () => {
    const fakeAdapter: ImportOriginAdapter = {
      name: 'Origen de prueba',
      sheetName: 'Bets',
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
      // Sin financialContrast: es válido que un origen no lo tenga.
    };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bets');
    sheet.getCell('A2').value = new Date('2026-01-10T00:00:00.000Z');
    sheet.getCell('B2').value = 'Alpha wins';
    sheet.getCell('C2').value = 10;
    sheet.getCell('D2').value = 2;
    sheet.getCell('E2').value = 'WIN';
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await runImportPreviewPipeline({
      file,
      adapter: fakeAdapter,
      fileMeta: {
        originalName: 'origen-de-prueba.xlsx',
        sizeBytes: file.length,
        sha256: 'b'.repeat(64),
      },
      timeZone: 'UTC',
    });

    expect(preview.origin).toBe('Origen de prueba');
    expect(preview.bets).toHaveLength(1);
    expect(preview.bets[0]).toMatchObject({
      amount: '10.00',
      status: 'WON',
      provisionalReturn: '20.00',
    });
    // Sin financialContrast configurado: vacío, todo verde, nada que contrastar.
    expect(preview.financialContrast).toEqual({
      configured: false,
      bets: [],
      totalProfitResidual: '0.00',
      rowsWithMoreThanTwoDecimals: 0,
      semaphore: 'GREEN',
      headerChecks: [],
      initialBankAmount: null,
    });
  });

  it('produce exactamente lo mismo que ejecutar manualmente cada etapa de la 9.2', async () => {
    const file = await buildBetsafeWorkbook();
    const viaPipeline = await runImportPreviewPipeline({
      file,
      adapter: BETSAFE_ADAPTER,
      fileMeta: FILE_META,
      timeZone: TIME_ZONE,
    });

    const [sheet] = await readWorkbook(file);
    const normalization = normalizeImportSheet(sheet!, BETSAFE_ADAPTER, { timeZone: TIME_ZONE });
    const validation = buildImportValidationReport(normalization);
    const financialContrast = buildExcelFinancialContrast(
      sheet!,
      normalization.bets,
      BETSAFE_FINANCIAL_CONTRAST_CONFIG,
    );
    const viaManualChain = buildImportPreview({
      file: FILE_META,
      originName: BETSAFE_ADAPTER.name,
      normalization,
      validation,
      financialContrast,
      timeZone: TIME_ZONE,
    });

    expect(viaPipeline).toEqual(viaManualChain);
  });

  it('un archivo que no es un .xlsx falla correctamente (400), no con un error genérico', async () => {
    await expect(
      runImportPreviewPipeline({
        file: Buffer.from('esto no es un xlsx'),
        adapter: BETSAFE_ADAPTER,
        fileMeta: FILE_META,
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('un .xlsx real pero sin la hoja que el adaptador espera falla correctamente (400)', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Otra hoja').getCell('A1').value = 'x';
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(
      runImportPreviewPipeline({
        file,
        adapter: BETSAFE_ADAPTER,
        fileMeta: FILE_META,
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Rondas') as string });
  });

  it('sin ningún efecto secundario: la misma entrada produce siempre la misma salida', async () => {
    const file = await buildBetsafeWorkbook();
    const bytesBefore = Buffer.from(file);
    const input = { file, adapter: BETSAFE_ADAPTER, fileMeta: FILE_META, timeZone: TIME_ZONE };
    const first = await runImportPreviewPipeline(input);
    const second = await runImportPreviewPipeline(input);
    expect(first).toEqual(second);
    // Los bytes originales no se tocan (D-X12): siguen siendo exactamente los mismos.
    expect(file.equals(bytesBefore)).toBe(true);
  });
});

describe('runImportAnalysisPipeline (Fase 9.3.3, base para persistir el staging)', () => {
  it('devuelve la misma vista previa que runImportPreviewPipeline, más la hoja y la normalización', async () => {
    const file = await buildBetsafeWorkbook();
    const input = { file, adapter: BETSAFE_ADAPTER, fileMeta: FILE_META, timeZone: TIME_ZONE };

    const analysis = await runImportAnalysisPipeline(input);
    const preview = await runImportPreviewPipeline(input);

    expect(analysis.preview).toEqual(preview);
    expect(analysis.sheet.name).toBe('Rondas');
    expect(analysis.normalization.bets).toHaveLength(2);
    // Campos que la vista previa no expone (no hacen falta para mostrarla) pero sí para persistir
    // la fila de staging completa (9.3.3): p. ej. `placedTimeKnown`.
    expect(analysis.normalization.bets[0]).toMatchObject({
      rowNumber: 11,
      placedTimeKnown: false,
      settledTimeKnown: false,
    });
  });
});
