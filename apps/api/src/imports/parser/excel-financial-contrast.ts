import {
  addMoney,
  calculateBetReturn,
  compareMoney,
  roundMoney,
  subtractMoney,
  ZERO_MONEY,
  type MoneyString,
} from '@letfer/shared';
import type { PreliminaryNormalizedBet } from './import-normalization.js';
import type { RawCellValue, RawSheet } from './sheet-model.js';

/**
 * Contraste financiero contra las cifras propias del Excel (Fase 9.2.5, §113.7, D-X11, D-X17,
 * ADR 0020). **Deliberadamente separado** de `import-validation-report.ts` (D-X17b, estructural:
 * filas bloqueantes o que requieren revisión): esto no decide si un lote se puede confirmar, solo
 * contrasta lo que el propio Excel calculó (A+G, GANANCIA, Bank Actual) contra lo que LetFer
 * reconstruye, como información — nunca se ajusta nada para hacerlos coincidir (principio rector,
 * D-X11).
 *
 * El Excel no redondea y LetFer sí (ROUND_HALF_UP a dos decimales, D-B8 pendiente): las dos cifras
 * no tienen por qué coincidir al céntimo, y eso no es un defecto de ninguna de las dos.
 */

/** Columnas donde el archivo guarda sus propios cálculos (nunca se importan; solo se contrastan). */
export interface ExcelComputedColumnMap {
  /** "A+G": monto+ganancia si ganó, −monto si perdió, 0 si pendiente (fórmula real de Betsafe). */
  totalReturn: string;
  /** "GANANCIA": retorno neto (ganancia si ganó, −monto si perdió, 0 si pendiente). */
  profit: string;
}

/** Celdas de cabecera con un total ya calculado por el propio archivo (opcionales: no todos los tienen). */
export interface ExcelHeaderCells {
  /** p. ej. Bank Inicial. */
  initialBank?: { row: number; column: string };
  /** p. ej. Bank Actual = Bank Inicial + Ganancia. */
  currentBank?: { row: number; column: string };
  /** p. ej. el total de GANANCIA de la cabecera (`SUM` de la columna, ya calculado por el archivo). */
  profitTotal?: { row: number; column: string };
}

export interface ExcelFinancialContrastConfig {
  firstDataRow: number;
  computedColumns: ExcelComputedColumnMap;
  headerCells: ExcelHeaderCells;
}

export type RowFinancialSemaphore = 'GREEN' | 'RED';
export type BatchFinancialSemaphore = 'GREEN' | 'YELLOW' | 'RED';

export interface BetFinancialComparison {
  rowNumber: number;
  /** `null` si la celda del Excel está vacía (p. ej. una plantilla que igualmente se compara). */
  excelTotalReturn: MoneyString | null;
  excelProfit: MoneyString | null;
  letferTotalReturn: MoneyString;
  letferProfit: MoneyString;
  /** `excel − LetFer` (D-X17); `null` cuando no hay valor del Excel con el que restar. */
  totalReturnResidual: MoneyString | null;
  profitResidual: MoneyString | null;
  /** Verde si ambos residuos son `<= 0.01` en valor absoluto (o no hay valor del Excel); si no, rojo. */
  semaphore: RowFinancialSemaphore;
}

export interface HeaderConsistencyCheck {
  label: string;
  /** Valor que el propio archivo guarda en la celda de cabecera; `null` si no se configuró o está vacía. */
  excelValue: MoneyString | null;
  /** Reconstruido sumando las propias filas del archivo (nunca las de LetFer). */
  expectedFromRows: MoneyString;
  residual: MoneyString | null;
  consistent: boolean;
}

export interface ExcelFinancialContrastReport {
  bets: BetFinancialComparison[];
  /** `T`: suma de los residuos de GANANCIA de las filas con valor del Excel (D-X17, "total del lote"). */
  totalProfitResidual: MoneyString;
  /** Cuántas de esas filas tienen, en el Excel, un valor con más de dos decimales (margen explicable). */
  rowsWithMoreThanTwoDecimals: number;
  semaphore: BatchFinancialSemaphore;
  headerChecks: HeaderConsistencyCheck[];
  /**
   * El "Bank Inicial" que el propio archivo declara en su cabecera (D-X3/D-X18); `null` si no se
   * configuró la celda o está vacía. Se lee aquí (y no en otro sitio) porque este módulo ya es el
   * único que toca las celdas de cabecera del archivo; la vista previa (9.2.6) lo reutiliza para no
   * tener que leer el Excel una segunda vez.
   */
  initialBankAmount: MoneyString | null;
}

const ROUNDING_TOLERANCE = '0.01';
const isWithinTolerance = (residual: MoneyString): boolean =>
  compareMoney(absMoney(residual), ROUNDING_TOLERANCE) <= 0;
const absMoney = (value: MoneyString): MoneyString =>
  compareMoney(value, ZERO_MONEY) < 0 ? subtractMoney(ZERO_MONEY, value) : value;

function cellNumber(value: RawCellValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function cellMoney(value: RawCellValue): MoneyString | null {
  const n = cellNumber(value);
  return n === null ? null : roundMoney(String(n));
}

/**
 * El número exacto de la celda, como texto, **sin redondear a dos decimales** (a diferencia de
 * {@link cellMoney}): el Excel no redondea (D-X11), y el residuo frente a LetFer debe salir de
 * comparar su valor exacto, no una versión ya redondeada de él (si se redondeara primero, un
 * empate de medio céntimo como 109.375 → 109.38 desaparecería del residuo sin haber dejado de
 * existir). Solo el resultado final de la resta pasa por el módulo de dinero (`subtractMoney`,
 * `addMoney`), que sí redondea una vez, al final — nunca antes.
 */
function rawCellDecimal(value: RawCellValue): string | null {
  const n = cellNumber(value);
  return n === null ? null : String(n);
}

/** `true` si el número crudo del Excel tiene más de dos decimales (antes de que LetFer lo redondee). */
function hasMoreThanTwoDecimals(n: number): boolean {
  const cents = n * 100;
  return Math.abs(cents - Math.round(cents)) > 1e-6;
}

/** Reconstrucción de LetFer con la misma forma que la fórmula del Excel (D-X4, D-B2). */
function letferValues(bet: PreliminaryNormalizedBet): {
  totalReturn: MoneyString;
  profit: MoneyString;
} {
  if (bet.status === 'WON') {
    const realized = calculateBetReturn(bet.amount, bet.visibleTotalOdds);
    return { totalReturn: realized, profit: subtractMoney(realized, bet.amount) };
  }
  if (bet.status === 'LOST') {
    const negative = subtractMoney(ZERO_MONEY, bet.amount);
    return { totalReturn: negative, profit: negative };
  }
  return { totalReturn: ZERO_MONEY, profit: ZERO_MONEY }; // PENDING: 0, como la fórmula del Excel.
}

function rowCell(sheet: RawSheet, row: number, column: string): RawCellValue {
  return sheet.rows.find((r) => r.rowNumber === row)?.cells[column] ?? null;
}

/**
 * Contrasta cada apuesta preliminar contra las cifras que el propio Excel calculó para su fila, y
 * las cifras de cabecera del archivo contra la suma de sus propias filas. Función pura: no escribe
 * nada, no crea ninguna apuesta ni ajusta ningún valor (principio rector, D-X11).
 */
export function buildExcelFinancialContrast(
  sheet: RawSheet,
  bets: readonly PreliminaryNormalizedBet[],
  config: ExcelFinancialContrastConfig,
): ExcelFinancialContrastReport {
  const comparisons: BetFinancialComparison[] = [];
  for (const bet of bets) {
    if (bet.rowNumber === undefined) continue; // defensivo: aquí siempre lo trae el normalizador.
    const rawTotalReturn = rowCell(sheet, bet.rowNumber, config.computedColumns.totalReturn);
    const rawProfit = rowCell(sheet, bet.rowNumber, config.computedColumns.profit);
    const excelTotalReturn = cellMoney(rawTotalReturn);
    const excelProfit = cellMoney(rawProfit);
    const letfer = letferValues(bet);
    const rawTotalReturnDecimal = rawCellDecimal(rawTotalReturn);
    const rawProfitDecimal = rawCellDecimal(rawProfit);
    const totalReturnResidual =
      rawTotalReturnDecimal && subtractMoney(rawTotalReturnDecimal, letfer.totalReturn);
    const profitResidual = rawProfitDecimal && subtractMoney(rawProfitDecimal, letfer.profit);
    const semaphore: RowFinancialSemaphore =
      (!totalReturnResidual || isWithinTolerance(totalReturnResidual)) &&
      (!profitResidual || isWithinTolerance(profitResidual))
        ? 'GREEN'
        : 'RED';
    comparisons.push({
      rowNumber: bet.rowNumber,
      excelTotalReturn,
      excelProfit,
      letferTotalReturn: letfer.totalReturn,
      letferProfit: letfer.profit,
      totalReturnResidual,
      profitResidual,
      semaphore,
    });
  }

  // Total del lote (D-X17): suma de los residuos de GANANCIA de las filas con valor del Excel.
  let totalProfitResidual: MoneyString = ZERO_MONEY;
  let rowsWithMoreThanTwoDecimals = 0;
  let anyRowRed = false;
  for (const comparison of comparisons) {
    if (comparison.semaphore === 'RED') anyRowRed = true;
    if (comparison.profitResidual) {
      totalProfitResidual = addMoney(totalProfitResidual, comparison.profitResidual);
      const raw = cellNumber(rowCell(sheet, comparison.rowNumber, config.computedColumns.profit));
      if (raw !== null && hasMoreThanTwoDecimals(raw)) rowsWithMoreThanTwoDecimals += 1;
    }
  }

  const headerChecks = buildHeaderChecks(sheet, config);
  const headerInconsistent = headerChecks.some((check) => !check.consistent);

  const explicableMargin = roundMoney(String(0.01 * rowsWithMoreThanTwoDecimals));
  const totalWithinTolerance = isWithinTolerance(totalProfitResidual);
  const totalExplicable =
    !anyRowRed && compareMoney(absMoney(totalProfitResidual), explicableMargin) <= 0;

  const semaphore: BatchFinancialSemaphore =
    anyRowRed || headerInconsistent
      ? 'RED'
      : totalWithinTolerance
        ? 'GREEN'
        : totalExplicable
          ? 'YELLOW'
          : 'RED';

  const initialBankAmount = config.headerCells.initialBank
    ? cellMoney(
        rowCell(sheet, config.headerCells.initialBank.row, config.headerCells.initialBank.column),
      )
    : null;

  return {
    bets: comparisons,
    totalProfitResidual,
    rowsWithMoreThanTwoDecimals,
    semaphore,
    headerChecks,
    initialBankAmount,
  };
}

function buildHeaderChecks(
  sheet: RawSheet,
  config: ExcelFinancialContrastConfig,
): HeaderConsistencyCheck[] {
  const dataRows = sheet.rows.filter((row) => row.rowNumber >= config.firstDataRow);
  // Suma a precisión completa (nunca redondea fila por fila, tal como hace la propia fórmula del
  // Excel): solo el resultado final pasa una vez por el módulo de dinero (`addMoney`).
  const sumColumn = (column: string): MoneyString => {
    const raw = dataRows.flatMap((row) => {
      const value = rawCellDecimal(row.cells[column] ?? null);
      return value ? [value] : [];
    });
    return addMoney(...raw);
  };

  const checks: HeaderConsistencyCheck[] = [];
  const rowsProfitSum = sumColumn(config.computedColumns.profit);

  if (config.headerCells.profitTotal) {
    const excelValue = cellMoney(
      rowCell(sheet, config.headerCells.profitTotal.row, config.headerCells.profitTotal.column),
    );
    const rawExcelValue = rawCellDecimal(
      rowCell(sheet, config.headerCells.profitTotal.row, config.headerCells.profitTotal.column),
    );
    checks.push(consistencyCheck('Ganancia (cabecera)', excelValue, rawExcelValue, rowsProfitSum));
  }

  if (config.headerCells.currentBank && config.headerCells.initialBank) {
    const initialBank = rawCellDecimal(
      rowCell(sheet, config.headerCells.initialBank.row, config.headerCells.initialBank.column),
    );
    const excelValue = cellMoney(
      rowCell(sheet, config.headerCells.currentBank.row, config.headerCells.currentBank.column),
    );
    const rawExcelValue = rawCellDecimal(
      rowCell(sheet, config.headerCells.currentBank.row, config.headerCells.currentBank.column),
    );
    // Bank Actual = Bank Inicial + Ganancia (reconstruido desde las propias filas, nunca desde LetFer).
    const expected = addMoney(initialBank ?? ZERO_MONEY, rowsProfitSum);
    checks.push(consistencyCheck('Bank Actual (cabecera)', excelValue, rawExcelValue, expected));
  }

  return checks;
}

function consistencyCheck(
  label: string,
  excelValue: MoneyString | null,
  rawExcelValue: string | null,
  expectedFromRows: MoneyString,
): HeaderConsistencyCheck {
  const residual = rawExcelValue && subtractMoney(rawExcelValue, expectedFromRows);
  return {
    label,
    excelValue,
    expectedFromRows,
    residual,
    consistent: !residual || isWithinTolerance(residual),
  };
}
