import type { TicketExtraction, TicketExtractionSelection } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { classify, evaluateCase } from './compare-extraction.js';
import { ALL_EXTRACTION_FIELDS_COVERED, type EvalActual, type EvalCase } from './types.js';

/** Casos SINTÉTICOS: prueban el comparador, no la capacidad de Anthropic. */
const s1: TicketExtractionSelection = {
  sport: 'Fútbol',
  event: 'Equipo A vs Equipo B',
  market: 'Resultado final',
  selection: 'Equipo A',
  visibleOdds: '1.50',
};
const s2: TicketExtractionSelection = {
  sport: 'Fútbol',
  event: 'Equipo C vs Equipo D',
  market: 'Goles totales',
  selection: 'Más de 2.5',
  visibleOdds: '1.80',
};
const expected: TicketExtraction = {
  house: 'Casa Ejemplo',
  placedDate: '2026-01-15',
  placedTime: '20:30',
  betType: 'MULTIPLE',
  selections: [s1, s2],
  officialTotalOdds: '2.70',
  officialAmount: '10.00',
  officialPotentialReturn: '27.00',
  result: 'Pendiente',
};
const caseOf = (over: Partial<EvalCase> = {}): EvalCase => ({
  meta: { id: 'sintetico', description: 'caso inventado', synthetic: true },
  expected,
  ...over,
});
const valid = (extraction: TicketExtraction): EvalActual => ({ status: 'VALID', extraction });
const withChange = (change: Partial<TicketExtraction>): EvalActual =>
  valid({ ...expected, ...change });

const outcomes = (result: ReturnType<typeof evaluateCase>, outcome: string) =>
  result.slots.filter((s) => s.outcome === outcome).map((s) => s.path);
const failures = (result: ReturnType<typeof evaluateCase>) =>
  result.slots.filter((s) => s.outcome !== 'CORRECT' && s.outcome !== 'CORRECT_ABSENT');

describe('cobertura del contrato', () => {
  it('el arnés evalúa todos los campos de TicketExtraction (comprobado al compilar)', () => {
    expect(ALL_EXTRACTION_FIELDS_COVERED).toBe(true);
  });
});

describe('classify: igualdad estricta, sin comparaciones "inteligentes"', () => {
  it('distingue los cinco resultados', () => {
    expect(classify('1.85', '1.85')).toBe('CORRECT');
    expect(classify(undefined, undefined)).toBe('CORRECT_ABSENT');
    expect(classify('1.85', '1.95')).toBe('INCORRECT');
    expect(classify('1.85', undefined)).toBe('MISSING');
    expect(classify(undefined, '1.85')).toBe('UNEXPECTED');
  });

  it.each([
    ['1.85', '1.95'],
    ['1.5', '1.50'],
    ['10.00', 'S/10.00'],
    ['Betano', 'betano'],
    ['Betano', ' Betano'],
    ['Más de 2.5', 'Mas de 2.5'],
  ])('%s y %s NO son equivalentes', (a, b) => {
    expect(classify(a, b)).toBe('INCORRECT');
  });
});

describe('evaluateCase: casos sintéticos', () => {
  it('extracción completamente correcta: ningún error, los campos ausentes cuentan como omisión correcta', () => {
    const result = evaluateCase(caseOf(), valid(expected));
    expect(failures(result)).toEqual([]);
    expect(result.failedSelections).toEqual([]);
    expect(result.rejected).toBe(false);
    // Campos que no están en el ticket ni en la respuesta: omitidos correctamente.
    expect(outcomes(result, 'CORRECT_ABSENT')).toEqual([
      'externalReference',
      'stake',
      'officialRealizedReturn',
      'selections[0].legScore',
      'selections[0].legResult',
      'selections[0].conditions',
      'selections[1].legScore',
      'selections[1].legResult',
      'selections[1].conditions',
    ]);
    // 11 campos escalares + 8 campos × 2 selecciones.
    expect(result.slots).toHaveLength(11 + 8 * 2);
  });

  it('un campo incorrecto: solo ese falla', () => {
    const result = evaluateCase(caseOf(), withChange({ officialTotalOdds: '2.80' }));
    expect(failures(result)).toEqual([
      expect.objectContaining({
        path: 'officialTotalOdds',
        field: 'officialTotalOdds',
        outcome: 'INCORRECT',
        expected: '2.70',
        actual: '2.80',
      }),
    ]);
  });

  it('un campo faltante', () => {
    const rest: TicketExtraction = { ...expected };
    delete rest.officialAmount;
    const result = evaluateCase(caseOf(), valid(rest));
    expect(failures(result)).toEqual([
      expect.objectContaining({ path: 'officialAmount', outcome: 'MISSING', expected: '10.00' }),
    ]);
  });

  it('un campo inesperado (no debía extraerse) y su motivo documentado', () => {
    const result = evaluateCase(
      caseOf({ absentFields: { stake: 'NOT_IN_TICKET' } }),
      withChange({ stake: '5' }),
    );
    expect(failures(result)).toEqual([
      expect.objectContaining({
        path: 'stake',
        outcome: 'UNEXPECTED',
        actual: '5',
        absence: 'NOT_IN_TICKET',
      }),
    ]);
  });

  it('una selección incorrecta: informa cuál y en qué campo; la otra no se ve afectada', () => {
    const result = evaluateCase(
      caseOf(),
      withChange({ selections: [s1, { ...s2, visibleOdds: '1.85' }] }),
    );
    expect(failures(result)).toEqual([
      expect.objectContaining({
        path: 'selections[1].visibleOdds',
        field: 'selections[].visibleOdds',
        outcome: 'INCORRECT',
        expected: '1.80',
        actual: '1.85',
      }),
    ]);
    expect(result.failedSelections).toEqual([
      { index: 1, fields: ['visibleOdds'], extra: false, absent: false },
    ]);
  });

  it('una selección adicional inesperada: todos sus datos cuentan como inesperados', () => {
    const extra: TicketExtractionSelection = {
      event: 'Equipo X vs Equipo Y',
      selection: 'Equipo X',
    };
    const result = evaluateCase(caseOf(), withChange({ selections: [s1, s2, extra] }));
    expect(failures(result).map((s) => [s.path, s.outcome])).toEqual([
      ['selections[2].event', 'UNEXPECTED'],
      ['selections[2].selection', 'UNEXPECTED'],
    ]);
    expect(result.failedSelections).toEqual([
      { index: 2, fields: ['event', 'selection'], extra: true, absent: false },
    ]);
    expect(result.selectionCount).toEqual({ expected: 2, actual: 3 });
  });

  it('una selección que falta: sus datos cuentan como faltantes', () => {
    const result = evaluateCase(caseOf(), withChange({ selections: [s1] }));
    expect(outcomes(result, 'MISSING')).toEqual([
      'selections[1].sport',
      'selections[1].event',
      'selections[1].market',
      'selections[1].selection',
      'selections[1].visibleOdds',
    ]);
    expect(result.failedSelections).toEqual([
      {
        index: 1,
        fields: ['sport', 'event', 'market', 'selection', 'visibleOdds'],
        extra: false,
        absent: true,
      },
    ]);
  });

  it('las selecciones se comparan por posición: el mismo contenido en otro orden es un error', () => {
    const result = evaluateCase(caseOf(), withChange({ selections: [s2, s1] }));
    expect(result.failedSelections.map((f) => f.index)).toEqual([0, 1]);
  });

  it('mezclar datos de dos selecciones se detecta en el campo exacto', () => {
    // La cuota de la 2.ª selección copiada a la 1.ª.
    const result = evaluateCase(
      caseOf(),
      withChange({ selections: [{ ...s1, visibleOdds: s2.visibleOdds! }, s2] }),
    );
    expect(failures(result).map((s) => s.path)).toEqual(['selections[0].visibleOdds']);
  });
});

describe('evaluateCase: campos ignorados y respuestas rechazadas', () => {
  it('un campo ignorado no se puntúa, tenga el valor que tenga', () => {
    const result = evaluateCase(
      caseOf({ ignoredFields: ['officialAmount', 'selections[].sport'] }),
      withChange({ officialAmount: '999.00', selections: [{ ...s1, sport: 'Tenis' }, s2] }),
    );
    expect(result.slots.map((s) => s.field)).not.toContain('officialAmount');
    expect(result.slots.map((s) => s.field)).not.toContain('selections[].sport');
    expect(failures(result)).toEqual([]);
    expect(result.slots).toHaveLength(10 + 7 * 2);
  });

  it('una respuesta rechazada por el validador se evalúa como vacía', () => {
    const result = evaluateCase(caseOf(), {
      status: 'REJECTED',
      issues: [{ path: 'officialAmount', code: 'INVALID_MONEY' }],
    });
    expect(result.rejected).toBe(true);
    expect(result.rejectionIssues).toEqual([{ path: 'officialAmount', code: 'INVALID_MONEY' }]);
    // Todo lo que debía leerse falta; lo que no debía leerse sigue siendo una omisión correcta.
    expect(outcomes(result, 'MISSING')).toHaveLength(8 + 5 * 2);
    expect(outcomes(result, 'CORRECT_ABSENT')).toEqual([
      'externalReference',
      'stake',
      'officialRealizedReturn',
      'selections[0].legScore',
      'selections[0].legResult',
      'selections[0].conditions',
      'selections[1].legScore',
      'selections[1].legResult',
      'selections[1].conditions',
    ]);
  });

  it('un ticket sin selecciones esperadas y una respuesta sin selecciones: nada que puntuar', () => {
    const noSelections: TicketExtraction = { ...expected };
    delete noSelections.selections;
    const result = evaluateCase(caseOf({ expected: noSelections }), valid(noSelections));
    expect(result.slots).toHaveLength(11);
    expect(result.selectionCount).toEqual({ expected: 0, actual: 0 });
  });
});

describe('bloque de condiciones dentro de una combinada (estructura del caso real 01, datos sintéticos)', () => {
  const leg = (event: string, odds: string): TicketExtractionSelection => ({
    event,
    market: 'Resultado del partido',
    selection: event.split(' vs ')[0]!,
    visibleOdds: odds,
  });
  const block: TicketExtractionSelection = {
    event: 'Equipo C vs Equipo D',
    market: 'Bet Builder',
    selection: 'Equipo D — Resultado del partido; Más de 2.5 — Equipo D Más/Menos Córners',
    visibleOdds: '2.50',
  };
  const legs4 = [leg('Equipo A vs Equipo B', '2.00'), block, leg('Equipo E vs Equipo F', '1.20')];
  const caseOfBlock = caseOf({ expected: { betType: 'MULTIPLE', selections: legs4 } });

  it('el bloque como UN solo leg, con la cuota del bloque: sin errores', () => {
    const result = evaluateCase(caseOfBlock, valid({ betType: 'MULTIPLE', selections: legs4 }));
    expect(failures(result)).toEqual([]);
    expect(result.selectionCount).toEqual({ expected: 3, actual: 3 });
    expect(result.oddsSequence.actual).toEqual(['2.00', '2.50', '1.20']);
  });

  it('el bloque dividido en dos selecciones con una cuota inventada: se ve el desplazamiento y cada error', () => {
    const split: TicketExtractionSelection[] = [
      legs4[0]!,
      {
        event: block.event,
        market: 'Resultado del partido',
        selection: 'Equipo D',
        visibleOdds: '1.50',
      },
      {
        event: block.event,
        market: 'Equipo D Más/Menos Córners',
        selection: 'Más de 2.5',
        visibleOdds: '1.50',
      },
      legs4[2]!,
    ];
    const result = evaluateCase(caseOfBlock, valid({ betType: 'MULTIPLE', selections: split }));

    expect(result.selectionCount).toEqual({ expected: 3, actual: 4 });
    // Se perdió la cuota del bloque y se repitió una inventada.
    expect(result.oddsSequence).toEqual({
      expected: ['2.00', '2.50', '1.20'],
      actual: ['2.00', '1.50', '1.50', '1.20'],
    });
    expect(failures(result).find((s) => s.path === 'selections[1].visibleOdds')).toMatchObject({
      outcome: 'INCORRECT',
      expected: '2.50',
      actual: '1.50',
    });
    // La selección de más aparece como tal (la comparación por posición desplaza el último leg).
    expect(result.failedSelections.at(-1)).toMatchObject({ index: 3, extra: true });
  });
});
