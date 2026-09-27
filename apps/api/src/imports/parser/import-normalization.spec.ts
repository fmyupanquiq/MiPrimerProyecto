import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { BETSAFE_ADAPTER } from './betsafe-adapter.js';
import { normalizeBetsafeSheet } from './betsafe-normalizer.js';
import type { ImportOriginAdapter } from './import-normalization.js';
import { normalizeImportSheet } from './import-normalization.js';
import { buildImportValidationReport } from './import-validation-report.js';
import type { NormalizedImportSelection } from '../import-types.js';
import { readWorkbook } from './xlsx-reader.js';

/**
 * Un origen deliberadamente distinto de Betsafe (otras columnas, otro idioma de vocabulario, otra
 * gramática de selecciones), solo para probar que `normalizeImportSheet` no tiene ninguna regla de
 * Betsafe agazapada dentro (Fase 9.2.4). Nunca se usaría en producción: es un doble de pruebas.
 */
const FAKE_ADAPTER: ImportOriginAdapter = {
  name: 'Origen de prueba',
  template: {
    name: 'Origen de prueba',
    firstDataRow: 2,
    columns: {
      date: 'A',
      sport: 'B',
      description: 'C',
      declaredType: 'D',
      amount: 'E',
      odds: 'F',
      result: 'G',
    },
    resultVocabulary: { WIN: 'WON', LOSE: 'LOST', OPEN: 'PENDING' },
    stageLabel: { column: 'A', pattern: /^SEASON\s+\d+/i },
  },
  // Gramática deliberadamente distinta de la de Betsafe: separa por "||", cada tramo "Evento=Selección".
  parseSelections: (description, sport): NormalizedImportSelection[] =>
    description
      .split('||')
      .map((leg) => leg.trim())
      .filter((leg) => leg.length > 0)
      .map((leg, index) => {
        const [event, selection] = leg.split('=').map((part) => part.trim());
        return {
          eventGroup: index,
          position: 0,
          sport,
          event: event || `Leg ${index + 1}`,
          market: null,
          selection: selection || event || `Leg ${index + 1}`,
          visibleOdds: null,
        };
      }),
  declaredTypeVocabulary: { Single: 'SIMPLE', Combo: 'MULTIPLE', Builder: 'CREATED' },
};

async function buildFakeOriginFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bets');
  sheet.getCell('A1').value = 'SEASON 1';
  const set = (r: number, values: Record<string, unknown>) => {
    for (const [col, value] of Object.entries(values))
      sheet.getCell(`${col}${r}`).value = value as never;
  };
  // Fila 2: válida, simple (un solo tramo).
  set(2, {
    A: new Date('2026-01-10T00:00:00.000Z'),
    B: 'FOOTBALL',
    C: 'Alpha=Wins',
    D: 'Single',
    E: 20,
    F: 1.9,
    G: 'WIN',
  });
  // Fila 3: válida, combo (dos tramos "||").
  set(3, {
    A: new Date('2026-01-10T00:00:00.000Z'),
    B: 'FOOTBALL',
    C: 'Beta=Wins||Gamma=Draws',
    D: 'Combo',
    E: 10,
    F: 2.4,
    G: 'LOSE',
  });
  // Fila 4: parcial (sin resultado).
  set(4, {
    A: new Date('2026-01-10T00:00:00.000Z'),
    B: 'TENNIS',
    C: 'Delta=Wins',
    D: 'Single',
    E: 15,
    F: 1.5,
  });
  // Fila 5: inválida (resultado fuera del vocabulario del origen falso).
  set(5, {
    A: new Date('2026-01-10T00:00:00.000Z'),
    B: 'TENNIS',
    C: 'Epsilon=Wins',
    D: 'Single',
    E: 15,
    F: 1.5,
    G: 'VOID',
  });
  // Fila 6: plantilla (solo fecha y deporte).
  set(6, { A: new Date('2026-01-10T00:00:00.000Z'), B: 'FOOTBALL' });

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

describe('normalizeImportSheet es agnóstico de origen (Fase 9.2.4, §113, ADR 0020)', () => {
  it('recorre, clasifica y normaliza un origen con columnas, vocabulario y gramática totalmente distintos', async () => {
    const bytes = await buildFakeOriginFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeImportSheet(sheet!, FAKE_ADAPTER, { timeZone: 'UTC' });

    expect(result.counts).toEqual({ VALID: 2, TEMPLATE: 1, EMPTY: 0, PARTIAL: 1, INVALID: 1 });
    expect(result.bets).toHaveLength(2);

    const simple = result.bets.find((b) => b.rowNumber === 2)!;
    expect(simple).toMatchObject({ amount: '20.00', visibleTotalOdds: '1.9', status: 'WON' });
    expect(simple.selections).toEqual([
      {
        eventGroup: 0,
        position: 0,
        sport: 'FOOTBALL',
        event: 'Alpha',
        market: null,
        selection: 'Wins',
        visibleOdds: null,
      },
    ]);
    expect(result.rows.find((r) => r.rowNumber === 2)).toMatchObject({
      declaredType: 'Single',
      derivedType: 'SIMPLE',
      typeMismatch: false,
    });

    const combo = result.bets.find((b) => b.rowNumber === 3)!;
    expect(combo.selections).toHaveLength(2);
    expect(combo.selections.map((s) => s.event)).toEqual(['Beta', 'Gamma']);
    expect(result.rows.find((r) => r.rowNumber === 3)).toMatchObject({
      derivedType: 'MULTIPLE',
      typeMismatch: false, // "Combo" está en el vocabulario del origen falso y coincide.
    });

    expect(result.rows.find((r) => r.rowNumber === 4)!.status).toBe('PARTIAL');
    expect(result.rows.find((r) => r.rowNumber === 5)!.status).toBe('INVALID');
    expect(result.rows.find((r) => r.rowNumber === 6)!.status).toBe('TEMPLATE');

    expect(result.stageCandidates).toEqual([
      {
        label: 'SEASON 1',
        labelRow: 1,
        firstRow: 1,
        lastRow: 6,
        evidence: expect.any(String) as string,
      },
    ]);
  });

  it('el informe de validación también es agnóstico: el mismo semáforo y resumen con cualquier adaptador', async () => {
    const bytes = await buildFakeOriginFile();
    const [sheet] = await readWorkbook(bytes);
    const result = normalizeImportSheet(sheet!, FAKE_ADAPTER, { timeZone: 'UTC' });
    const report = buildImportValidationReport(result);

    expect(report.semaphore).toBe('BLOCKED'); // la fila 5 es INVALID.
    expect(report.summary).toMatchObject({ totalRows: 5, validBets: 2, errors: 1, partialRows: 1 });
  });

  it('un tipo declarado que no coincide con el derivado avisa igual, con el vocabulario del propio origen', async () => {
    // Un combo real (dos tramos "||"), pero declarado "Single": debe avisar, con el vocabulario
    // del origen falso (no el de Betsafe).
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bets');
    sheet.getCell('A2').value = new Date('2026-01-10T00:00:00.000Z');
    sheet.getCell('B2').value = 'FOOTBALL';
    sheet.getCell('C2').value = 'Beta=Wins||Gamma=Draws';
    sheet.getCell('D2').value = 'Single';
    sheet.getCell('E2').value = 10;
    sheet.getCell('F2').value = 2.4;
    sheet.getCell('G2').value = 'WIN';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const [rawSheet] = await readWorkbook(bytes);
    const result = normalizeImportSheet(rawSheet!, FAKE_ADAPTER, { timeZone: 'UTC' });
    expect(result.rows.find((r) => r.rowNumber === 2)).toMatchObject({
      declaredType: 'Single',
      derivedType: 'MULTIPLE',
      typeMismatch: true,
    });
  });
});

describe('normalizeBetsafeSheet delega en la capa agnóstica sin cambiar de comportamiento', () => {
  it('produce exactamente lo mismo que normalizeImportSheet con BETSAFE_ADAPTER', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rondas');
    sheet.getCell('B8').value = 'RONDA 1';
    sheet.getCell('B11').value = 1;
    sheet.getCell('C11').value = new Date('2024-10-22T00:00:00.000Z');
    sheet.getCell('E11').value = 'FUTBOL';
    sheet.getCell('F11').value = 'A vs. B:\nGana A';
    sheet.getCell('G11').value = 'Simple';
    sheet.getCell('H11').value = 62.5;
    sheet.getCell('I11').value = 1.75;
    sheet.getCell('J11').value = 'GANADO';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const [rawSheet] = await readWorkbook(bytes);
    const viaWrapper = normalizeBetsafeSheet(rawSheet!, { timeZone: 'America/Lima' });
    const viaGenericEngine = normalizeImportSheet(rawSheet!, BETSAFE_ADAPTER, {
      timeZone: 'America/Lima',
    });
    expect(viaWrapper).toEqual(viaGenericEngine);
  });
});

describe('BETSAFE_ADAPTER (§113, D-X24)', () => {
  it('tiene la forma de un ImportOriginAdapter completo', () => {
    expect(BETSAFE_ADAPTER.name).toBe('Betsafe');
    expect(typeof BETSAFE_ADAPTER.parseSelections).toBe('function');
    expect(BETSAFE_ADAPTER.declaredTypeVocabulary).toMatchObject({
      Simple: 'SIMPLE',
      Multi: 'MULTIPLE',
      Creada: 'CREATED',
    });
    expect(BETSAFE_ADAPTER.template.firstDataRow).toBe(11);
  });
});
