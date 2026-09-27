import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { PreliminaryNormalizedBet } from './import-normalization.js';
import {
  buildExcelFinancialContrast,
  type ExcelFinancialContrastConfig,
} from './excel-financial-contrast.js';
import { BETSAFE_FINANCIAL_CONTRAST_CONFIG } from './betsafe-adapter.js';
import { readWorkbook } from './xlsx-reader.js';

const CONFIG: ExcelFinancialContrastConfig = BETSAFE_FINANCIAL_CONTRAST_CONFIG;

const bet = (
  rowNumber: number,
  amount: string,
  visibleTotalOdds: string,
  status: 'WON' | 'LOST' | 'PENDING',
): PreliminaryNormalizedBet => ({
  rowNumber,
  amount,
  visibleTotalOdds,
  status,
  placedAt: new Date('2024-10-22T17:00:00.000Z'),
  placedTimeKnown: false,
  settledAt: status === 'PENDING' ? null : new Date('2024-10-22T17:00:00.000Z'),
  settledTimeKnown: status !== 'PENDING',
  selections: [
    {
      eventGroup: 0,
      position: 0,
      sport: null,
      event: 'A vs. B',
      selection: 'Gana A',
      visibleOdds: null,
    },
  ],
});

/** Construye una hoja con la forma de cabecera y columnas confirmada para Betsafe (§113.7, 9.2.0). */
async function buildSheet(options: {
  rows: { row: number; totalReturn?: number; profit?: number }[];
  initialBank?: number;
  currentBank?: number;
  profitTotalHeader?: number;
}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  if (options.initialBank !== undefined) sheet.getCell('E3').value = options.initialBank;
  if (options.currentBank !== undefined) sheet.getCell('E4').value = options.currentBank;
  if (options.profitTotalHeader !== undefined)
    sheet.getCell('I4').value = options.profitTotalHeader;
  for (const row of options.rows) {
    if (row.totalReturn !== undefined) sheet.getCell(`K${row.row}`).value = row.totalReturn;
    if (row.profit !== undefined) sheet.getCell(`L${row.row}`).value = row.profit;
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const [rawSheet] = await readWorkbook(bytes);
  return rawSheet!;
}

describe('buildExcelFinancialContrast (Fase 9.2.5, §113.7, D-X11, D-X17; nunca ajusta nada)', () => {
  it('verde por fila: el residuo de redondeo (109.375 → 109.38) es ≤ 0.01', async () => {
    // 62.5 × 1.75 = 109.375 (empate de medio céntimo); GANANCIA = 46.875. Los mismos números que
    // el ejemplo del ADR 0020 (§113.7), no el archivo real de nadie.
    const sheet = await buildSheet({ rows: [{ row: 11, totalReturn: 109.375, profit: 46.875 }] });
    const report = buildExcelFinancialContrast(sheet, [bet(11, '62.50', '1.75', 'WON')], CONFIG);

    expect(report.bets).toEqual([
      {
        rowNumber: 11,
        excelTotalReturn: '109.38', // el valor del Excel, redondeado solo para mostrarlo.
        excelProfit: '46.88',
        letferTotalReturn: '109.38',
        letferProfit: '46.88',
        // El residuo sale del valor EXACTO del Excel (109.375), no del ya redondeado: por eso no
        // es "0.00" a pesar de que las dos cifras redondeadas coincidan (D-X11: nunca se ajusta).
        totalReturnResidual: '-0.01',
        profitResidual: '-0.01',
        semaphore: 'GREEN', // dentro de la tolerancia (D-X17: verde hasta 0.01 inclusive).
      },
    ]);
    expect(report.semaphore).toBe('GREEN');
  });

  it('una perdida: LetFer reproduce la misma forma que la fórmula del Excel (−monto)', async () => {
    const sheet = await buildSheet({ rows: [{ row: 12, totalReturn: -75, profit: -75 }] });
    const report = buildExcelFinancialContrast(sheet, [bet(12, '75.00', '1.57', 'LOST')], CONFIG);
    expect(report.bets[0]).toMatchObject({
      letferTotalReturn: '-75.00',
      letferProfit: '-75.00',
      totalReturnResidual: '0.00',
      profitResidual: '0.00',
      semaphore: 'GREEN',
    });
  });

  it('una pendiente: 0 en ambos lados, como la fórmula del Excel', async () => {
    const sheet = await buildSheet({ rows: [{ row: 13, totalReturn: 0, profit: 0 }] });
    const report = buildExcelFinancialContrast(
      sheet,
      [bet(13, '40.00', '1.80', 'PENDING')],
      CONFIG,
    );
    expect(report.bets[0]).toMatchObject({
      letferTotalReturn: '0.00',
      letferProfit: '0.00',
      semaphore: 'GREEN',
    });
  });

  it('el ruido de coma flotante (243.00000000000003) no produce una diferencia real', async () => {
    const sheet = await buildSheet({
      rows: [{ row: 14, totalReturn: 243.00000000000003, profit: 93.00000000000003 }],
    });
    const report = buildExcelFinancialContrast(sheet, [bet(14, '150.00', '1.62', 'WON')], CONFIG);
    expect(report.bets[0]).toMatchObject({ semaphore: 'GREEN', profitResidual: '0.00' });
  });

  it('rojo por fila: una diferencia real (no de redondeo) entre el Excel y LetFer', async () => {
    // La ganancia del Excel no tiene relación con 62.5 × 1.75: alguien sobrescribió la celda.
    const sheet = await buildSheet({ rows: [{ row: 11, totalReturn: 500, profit: 437.5 }] });
    const report = buildExcelFinancialContrast(sheet, [bet(11, '62.50', '1.75', 'WON')], CONFIG);
    expect(report.bets[0]!.semaphore).toBe('RED');
    expect(report.semaphore).toBe('RED');
  });

  it('sin valor del Excel en la fila (celda vacía): verde, nada que contrastar', async () => {
    const sheet = await buildSheet({ rows: [] });
    const report = buildExcelFinancialContrast(sheet, [bet(11, '62.50', '1.75', 'WON')], CONFIG);
    expect(report.bets[0]).toMatchObject({
      excelTotalReturn: null,
      excelProfit: null,
      totalReturnResidual: null,
      profitResidual: null,
      semaphore: 'GREEN',
    });
  });

  it('amarillo del lote: residuo total > 0.01 pero explicable por redondeo (todas las filas verdes)', async () => {
    // Tres filas con el mismo empate de medio céntimo (62.5 × 1.75 = 109.375): cada una da un
    // residuo de -0.01 (dentro de tolerancia, verde), pero la suma de las tres (-0.03) ya no lo está.
    const rows = [11, 12, 13].map((row) => ({ row, totalReturn: 109.375, profit: 46.875 }));
    const sheet = await buildSheet({ rows });
    const bets = [11, 12, 13].map((row) => bet(row, '62.50', '1.75', 'WON'));
    const report = buildExcelFinancialContrast(sheet, bets, CONFIG);

    expect(report.bets.every((b) => b.semaphore === 'GREEN')).toBe(true);
    expect(report.totalProfitResidual).toBe('-0.03');
    // Las tres filas tienen, en el Excel, un valor con más de dos decimales (46.875): margen 0.03.
    expect(report.rowsWithMoreThanTwoDecimals).toBe(3);
    expect(report.semaphore).toBe('YELLOW');
  });

  it('rojo del lote: residuo total no explicable (mayor que el margen de redondeo)', async () => {
    const rows = [11, 12, 13].map((row) => ({ row, totalReturn: 200, profit: 150 }));
    const sheet = await buildSheet({ rows });
    const bets = [11, 12, 13].map((row) => bet(row, '62.50', '1.75', 'WON'));
    const report = buildExcelFinancialContrast(sheet, bets, CONFIG);
    expect(report.semaphore).toBe('RED'); // ya es rojo por fila (residuo grande), no solo por el total.
  });

  it('rojo del lote si cualquier fila es roja, aunque el total quedara pequeño por compensación', async () => {
    // Una fila con +50 de más y otra con −50 de menos: el total casi se cancela, pero cada fila es roja.
    const sheet = await buildSheet({
      rows: [
        { row: 11, totalReturn: 159.38, profit: 96.88 }, // +50 sobre 46.88
        { row: 12, totalReturn: -3.12, profit: -3.12 }, // no relacionado con 62.5×1.75 en absoluto
      ],
    });
    const bets = [bet(11, '62.50', '1.75', 'WON'), bet(12, '62.50', '1.75', 'WON')];
    const report = buildExcelFinancialContrast(sheet, bets, CONFIG);
    expect(report.bets.some((b) => b.semaphore === 'RED')).toBe(true);
    expect(report.semaphore).toBe('RED');
  });

  it('verifica la Ganancia y el Bank Actual de cabecera contra la suma de las propias filas del Excel', async () => {
    const sheet = await buildSheet({
      rows: [
        { row: 11, totalReturn: 109.375, profit: 46.875 },
        { row: 12, totalReturn: -75, profit: -75 },
      ],
      initialBank: 1000,
      profitTotalHeader: 46.875 - 75, // -28.125, la suma real de las dos filas.
      currentBank: 1000 + (46.875 - 75),
    });
    const bets = [bet(11, '62.50', '1.75', 'WON'), bet(12, '75.00', '1.57', 'LOST')];
    const report = buildExcelFinancialContrast(sheet, bets, CONFIG);

    expect(report.headerChecks).toHaveLength(2);
    for (const check of report.headerChecks) expect(check.consistent).toBe(true);
    expect(report.semaphore).toBe('GREEN');
  });

  it('una cabecera inconsistente (no coincide con la suma de sus propias filas) pone el lote en rojo', async () => {
    const sheet = await buildSheet({
      rows: [{ row: 11, totalReturn: 109.375, profit: 46.875 }],
      initialBank: 1000,
      profitTotalHeader: 999, // no tiene relación con la suma real de las filas (46.875).
      currentBank: 1046.875,
    });
    const report = buildExcelFinancialContrast(sheet, [bet(11, '62.50', '1.75', 'WON')], CONFIG);

    const profitCheck = report.headerChecks.find((c) => c.label.startsWith('Ganancia'))!;
    expect(profitCheck.consistent).toBe(false);
    expect(report.semaphore).toBe('RED'); // rojo aunque cada fila, por separado, sea verde.
    expect(report.bets[0]!.semaphore).toBe('GREEN');
  });

  it('nunca ajusta ningún valor: los mismos datos siempre producen el mismo informe', async () => {
    const sheet = await buildSheet({ rows: [{ row: 11, totalReturn: 109.375, profit: 46.875 }] });
    const bets = [bet(11, '62.50', '1.75', 'WON')];
    const first = buildExcelFinancialContrast(sheet, bets, CONFIG);
    const second = buildExcelFinancialContrast(sheet, bets, CONFIG);
    expect(first).toEqual(second);
    // Y los datos de entrada no se tocan.
    expect(bets[0]).toMatchObject({ amount: '62.50', visibleTotalOdds: '1.75' });
  });

  it('está separado de D-X17b: no clasifica filas ni decide si el lote se puede confirmar', () => {
    const report = { semaphore: 'GREEN' } as const;
    // No expone ninguna de las categorías estructurales de import-validation-report.ts.
    expect(report).not.toHaveProperty('category');
    expect(Object.keys(report)).not.toContain('BLOCKED');
  });
});
