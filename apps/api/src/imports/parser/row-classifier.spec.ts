import { describe, expect, it } from 'vitest';
import {
  classifyRow,
  extractSemanticRow,
  type ResultVocabulary,
  type SemanticBetRow,
  type SpreadsheetColumnMap,
} from './row-classifier.js';

const COLUMNS: SpreadsheetColumnMap = {
  date: 'C',
  sport: 'E',
  description: 'F',
  declaredType: 'G',
  amount: 'H',
  odds: 'I',
  result: 'J',
};
const VOCAB: ResultVocabulary = { GANADO: 'WON', PERDIDO: 'LOST', PENDIENTE: 'PENDING' };

const base: SemanticBetRow = {
  rowNumber: 11,
  date: new Date('2024-10-22T00:00:00.000Z'),
  sport: 'FUTBOL',
  description: 'Real Madrid vs. Barcelona: Gana Real Madrid',
  declaredType: 'Simple',
  amount: 62.5,
  odds: 1.75,
  result: 'GANADO',
};

describe('extractSemanticRow (§113.6)', () => {
  it('lee cada campo con sentido desde su columna, dejando el resto fuera', () => {
    const semantic = extractSemanticRow(
      {
        rowNumber: 11,
        cells: {
          B: 1,
          C: base.date,
          E: 'FUTBOL',
          F: 'texto',
          G: 'Simple',
          H: 62.5,
          I: 1.75,
          J: 'GANADO',
          K: 999,
        },
      },
      COLUMNS,
    );
    expect(semantic).toEqual({
      rowNumber: 11,
      date: base.date,
      sport: 'FUTBOL',
      description: 'texto',
      declaredType: 'Simple',
      amount: 62.5,
      odds: 1.75,
      result: 'GANADO',
    });
  });

  it('sin columna de deporte o de tipo declarado, esos campos quedan null', () => {
    const semantic = extractSemanticRow(
      { rowNumber: 11, cells: { C: base.date, F: 'texto', H: 62.5, I: 1.75, J: 'GANADO' } },
      { date: 'C', description: 'F', amount: 'H', odds: 'I', result: 'J' },
    );
    expect(semantic.sport).toBeNull();
    expect(semantic.declaredType).toBeNull();
  });
});

describe('classifyRow — EMPTY y TEMPLATE (D-X21, D-X21b)', () => {
  it('sin ningún dato en absoluto: EMPTY', () => {
    const row: SemanticBetRow = {
      ...base,
      date: null,
      sport: null,
      description: null,
      declaredType: null,
      amount: null,
      odds: null,
      result: null,
    };
    expect(classifyRow(row, { resultVocabulary: VOCAB })).toMatchObject({
      status: 'EMPTY',
      findings: [],
      normalized: null,
    });
  });

  it('con solo la fecha y el deporte prellenados (plantilla de Betsafe): TEMPLATE', () => {
    const row: SemanticBetRow = {
      ...base,
      description: null,
      declaredType: null,
      amount: null,
      odds: null,
      result: null,
    };
    expect(classifyRow(row, { resultVocabulary: VOCAB })).toMatchObject({
      status: 'TEMPLATE',
      findings: [],
      normalized: null,
    });
  });

  it('con solo el deporte (sin fecha) también cuenta como plantilla, no vacía', () => {
    const row: SemanticBetRow = {
      ...base,
      date: null,
      description: null,
      declaredType: null,
      amount: null,
      odds: null,
      result: null,
    };
    expect(classifyRow(row, { resultVocabulary: VOCAB }).status).toBe('TEMPLATE');
  });
});

describe('classifyRow — PARTIAL (D-X21b)', () => {
  it('con descripción pero sin monto, cuota ni resultado: PARTIAL con los hallazgos correspondientes', () => {
    const row: SemanticBetRow = { ...base, amount: null, odds: null, result: null };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('PARTIAL');
    expect(classified.normalized).toBeNull();
    expect(classified.findings.map((f) => f.code).sort()).toEqual(
      ['MISSING_AMOUNT', 'MISSING_ODDS', 'MISSING_RESULT'].sort(),
    );
  });

  it('con monto, cuota y resultado pero sin descripción: PARTIAL (falta descripción)', () => {
    const row: SemanticBetRow = { ...base, description: null };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('PARTIAL');
    expect(classified.findings).toEqual([
      { code: 'MISSING_DESCRIPTION', message: 'Falta la descripción.' },
    ]);
  });

  it('con las cuatro señales pero sin fecha: PARTIAL, no VALID', () => {
    const row: SemanticBetRow = { ...base, date: null };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('PARTIAL');
    expect(classified.findings).toContainEqual({
      code: 'MISSING_DATE',
      message: 'Falta la fecha.',
    });
  });
});

describe('classifyRow — VALID', () => {
  it('una apuesta simple completa se clasifica como VALID y se normaliza', () => {
    const classified = classifyRow(base, { resultVocabulary: VOCAB });
    expect(classified).toMatchObject({
      rowNumber: 11,
      status: 'VALID',
      findings: [],
      normalized: {
        sport: 'FUTBOL',
        description: 'Real Madrid vs. Barcelona: Gana Real Madrid',
        declaredType: 'Simple',
        amount: '62.50',
        odds: '1.75',
        status: 'WON',
      },
    });
    expect(classified.normalized!.date.toISOString()).toBe('2024-10-22T00:00:00.000Z');
  });

  it('una cuota con seis decimales (múltiple) se conserva exacta', () => {
    const row: SemanticBetRow = { ...base, odds: 1.510016, result: 'PERDIDO' };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('VALID');
    expect(classified.normalized!.odds).toBe('1.510016');
    expect(classified.normalized!.status).toBe('LOST');
  });

  it('un monto entero se normaliza con dos decimales', () => {
    const row: SemanticBetRow = { ...base, amount: 75 };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.normalized!.amount).toBe('75.00');
  });

  it('un resultado PENDIENTE es válido y no exige fecha de liquidación (eso lo decide otra capa)', () => {
    const row: SemanticBetRow = { ...base, result: 'PENDIENTE' };
    expect(classifyRow(row, { resultVocabulary: VOCAB }).normalized!.status).toBe('PENDING');
  });

  it('sin columna de deporte configurada, sport queda null pero la fila sigue siendo válida', () => {
    const row: SemanticBetRow = { ...base, sport: null };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('VALID');
    expect(classified.normalized!.sport).toBeNull();
  });
});

describe('classifyRow — INVALID (D-X17b: bloquea, no se importa igual que PARTIAL)', () => {
  it('un resultado fuera del vocabulario (p. ej. texto libre "ANULADA"): INVALID', () => {
    const row: SemanticBetRow = { ...base, result: 'ANULADA' };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('INVALID');
    expect(classified.findings).toEqual([
      {
        code: 'INVALID_RESULT',
        message: 'El resultado "ANULADA" no está en el vocabulario esperado.',
      },
    ]);
  });

  it('un monto no numérico o negativo: INVALID', () => {
    for (const amount of ['no es un número', -10, 0]) {
      const row: SemanticBetRow = { ...base, amount };
      expect(classifyRow(row, { resultVocabulary: VOCAB }).status).toBe('INVALID');
    }
  });

  it('una cuota con más de seis decimales o no positiva: INVALID', () => {
    for (const odds of [1.1234567, -1.5, 0]) {
      const row: SemanticBetRow = { ...base, odds };
      const classified = classifyRow(row, { resultVocabulary: VOCAB });
      expect(classified.status).toBe('INVALID');
      expect(classified.findings.some((f) => f.code === 'INVALID_ODDS')).toBe(true);
    }
  });

  it('un monto con más de dos decimales se rechaza en vez de redondearse en silencio', () => {
    const row: SemanticBetRow = { ...base, amount: 62.567 };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('INVALID');
    expect(classified.findings).toEqual([
      { code: 'INVALID_AMOUNT', message: 'El monto no es un número positivo válido.' },
    ]);
  });

  it('una fecha en texto que no se puede interpretar: INVALID', () => {
    const row: SemanticBetRow = { ...base, date: 'no es una fecha' };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('INVALID');
    expect(classified.findings).toEqual([
      { code: 'INVALID_DATE', message: 'La fecha no es válida.' },
    ]);
  });

  it('varios problemas a la vez se acumulan todos en los hallazgos', () => {
    const row: SemanticBetRow = { ...base, amount: -1, odds: 0, result: 'X' };
    const classified = classifyRow(row, { resultVocabulary: VOCAB });
    expect(classified.status).toBe('INVALID');
    expect(classified.findings.map((f) => f.code).sort()).toEqual(
      ['INVALID_AMOUNT', 'INVALID_ODDS', 'INVALID_RESULT'].sort(),
    );
  });
});
