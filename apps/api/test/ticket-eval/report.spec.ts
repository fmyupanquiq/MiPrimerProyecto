import type { TicketExtraction } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { evaluateCase } from './compare-extraction.js';
import {
  buildReport,
  compareReports,
  formatComparison,
  formatReport,
  statsOf,
  type EvalReport,
} from './report.js';
import type { EvalCase } from './types.js';

/** Casos SINTÉTICOS: prueban métricas y comparación entre versiones del propio arnés. */
const expected: TicketExtraction = {
  house: 'Casa Ejemplo',
  officialAmount: '10.00',
  officialTotalOdds: '2.70',
  selections: [
    { event: 'A vs B', selection: 'A', visibleOdds: '1.50' },
    { event: 'C vs D', selection: 'C', visibleOdds: '1.80' },
  ],
};
const caseOf = (id: string): EvalCase => ({
  meta: { id, description: `caso ${id}`, synthetic: true },
  expected,
});
const run = (label: string, byCase: Record<string, TicketExtraction>): EvalReport =>
  buildReport(
    label,
    Object.entries(byCase).map(([id, extraction]) =>
      evaluateCase(caseOf(id), { status: 'VALID', extraction }),
    ),
  );

describe('statsOf / buildReport', () => {
  it('cuenta aciertos, errores, faltantes e inesperados y calcula las precisiones', () => {
    const report = run('r', {
      uno: expected, // todo correcto
      dos: { ...expected, officialAmount: '11.00', stake: '3' }, // 1 incorrecto + 1 inesperado
    });
    // Datos por caso: 11 escalares + 8 × 2 selecciones = 27 → 54 en total.
    expect(report.casesEvaluated).toBe(2);
    expect(report.global).toMatchObject({
      evaluated: 54,
      incorrect: 1,
      unexpected: 1,
      missing: 0,
    });
    expect(report.global.accuracy).toBeCloseTo(52 / 54);
    // Lo que debía leerse: house, amount, totalOdds + 3 campos × 2 selecciones = 9 por caso → 18.
    expect(report.global.recall).toBeCloseTo(17 / 18);
    expect(report.byField.officialAmount).toMatchObject({ evaluated: 2, correct: 1, incorrect: 1 });
    expect(report.byField.stake).toMatchObject({ evaluated: 2, unexpected: 1, correctAbsent: 1 });
    expect(report.byField['selections[].visibleOdds']).toMatchObject({ evaluated: 4, correct: 4 });
  });

  it('sin datos no hay precisión (null), nunca 0 ni NaN', () => {
    expect(statsOf([])).toMatchObject({ evaluated: 0, accuracy: null, recall: null });
    expect(buildReport('vacío', []).global.accuracy).toBeNull();
  });

  it('cuenta los casos rechazados por el validador', () => {
    const report = buildReport('r', [
      evaluateCase(caseOf('x'), {
        status: 'REJECTED',
        issues: [{ path: 'house', code: 'EMPTY_VALUE' }],
      }),
    ]);
    expect(report.casesRejected).toBe(1);
    expect(report.global.missing).toBeGreaterThan(0);
  });
});

describe('compareReports: regresiones entre versiones', () => {
  it('detecta qué mejoró y qué empeoró, dato a dato', () => {
    const baseline = run('v1', {
      uno: { ...expected, officialAmount: '11.00' }, // mal en v1
      dos: expected, // bien en v1
    });
    const candidate = run('v2', {
      uno: expected, // arreglado en v2
      dos: { ...expected, officialTotalOdds: '2.80' }, // roto en v2
    });
    const cmp = compareReports(baseline, candidate);

    expect(cmp.commonCases).toBe(2);
    expect(cmp.improvements.map((c) => [c.caseId, c.path])).toEqual([['uno', 'officialAmount']]);
    expect(cmp.regressions.map((c) => [c.caseId, c.path, c.from, c.to])).toEqual([
      ['dos', 'officialTotalOdds', 'CORRECT', 'INCORRECT'],
    ]);
    expect(cmp.regressions[0]).toMatchObject({ expected: '2.70', actual: '2.80' });
    expect(cmp.global.delta).toBeCloseTo(0);
  });

  it('pasar de un error a otro error distinto no es mejora ni regresión', () => {
    const baseline = run('v1', { uno: { ...expected, officialAmount: '11.00' } });
    const candidate = run('v2', { uno: { ...expected, officialAmount: '12.00' } });
    const cmp = compareReports(baseline, candidate);
    expect(cmp.regressions).toEqual([]);
    expect(cmp.improvements).toEqual([]);
  });

  it('solo compara los casos presentes en ambas ejecuciones', () => {
    const baseline = run('v1', { uno: expected, soloBase: { ...expected, house: 'otra' } });
    const candidate = run('v2', { uno: expected, soloCandidato: { ...expected, house: 'otra' } });
    const cmp = compareReports(baseline, candidate);
    expect(cmp.commonCases).toBe(1);
    expect(cmp.global.baseline).toBe(1);
    expect(cmp.global.candidate).toBe(1);
  });
});

describe('formatReport / formatComparison', () => {
  it('el informe nombra el caso, el dato exacto y la selección que falló', () => {
    const text = formatReport(
      run('prompt-actual', {
        uno: {
          ...expected,
          officialAmount: '11.00',
          selections: [
            expected.selections![0]!,
            { ...expected.selections![1]!, visibleOdds: '1.85' },
          ],
        },
      }),
    );
    expect(text).toContain('Evaluación "prompt-actual": 1 caso(s)');
    expect(text).toContain('officialAmount: esperado "10.00" · obtenido "11.00"');
    expect(text).toContain('selections[1].visibleOdds: esperado "1.80" · obtenido "1.85"');
    expect(text).toContain('selección #2 falló en: visibleOdds');
  });

  it('el informe de comparación lista las regresiones', () => {
    const cmp = compareReports(
      run('v1', { uno: expected }),
      run('v2', { uno: { ...expected, house: 'otra' } }),
    );
    const text = formatComparison(cmp);
    expect(text).toContain('Comparación "v1" → "v2"');
    expect(text).toContain('Regresiones: 1 · Mejoras: 0');
    expect(text).toContain('▼ uno house: CORRECT → INCORRECT');
  });
});
