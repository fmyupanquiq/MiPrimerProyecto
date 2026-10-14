import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareReports } from './report.js';
import { evaluateRun } from './run-eval.js';
import { expectedProblems, loadActual, loadCases, parseCase, toEvalActual } from './load-cases.js';
import type { EvalCase } from './types.js';

const SYNTHETIC_ROOT = fileURLToPath(new URL('./cases', import.meta.url));

const baseCase = (): Record<string, unknown> => ({
  meta: { id: 'caso-x', description: 'inventado' },
  expected: { house: 'Casa Ejemplo' },
});

describe('parseCase: formato de case.json', () => {
  it('acepta un caso mínimo', () => {
    expect(parseCase(baseCase(), 'caso-x').meta.id).toBe('caso-x');
  });

  it.each([
    ['no es un objeto', null],
    ['sin meta', { expected: {} }],
    ['sin expected', { meta: { id: 'caso-x', description: 'd' } }],
    ['id distinto de la carpeta', { ...baseCase(), meta: { id: 'otro', description: 'd' } }],
    ['sin descripción', { ...baseCase(), meta: { id: 'caso-x' } }],
    ['ignoredFields desconocido', { ...baseCase(), ignoredFields: ['inventado'] }],
    ['absentFields con motivo inválido', { ...baseCase(), absentFields: { stake: 'NO_SE' } }],
    [
      'absentFields con campo desconocido',
      { ...baseCase(), absentFields: { inventado: 'UNREADABLE' } },
    ],
    [
      'campo a la vez esperado y ausente',
      { ...baseCase(), absentFields: { house: 'NOT_IN_TICKET' } },
    ],
    ['knownErrors sin explicación', { ...baseCase(), knownErrors: [{ path: 'house' }] }],
  ])('rechaza un caso mal formado: %s', (_name, json) => {
    expect(() => parseCase(json, 'caso-x')).toThrow(/Caso "caso-x"|case\.json/);
  });

  it('un subcampo de selección ausente no puede estar presente en alguna selección esperada', () => {
    const json = {
      ...baseCase(),
      expected: { selections: [{ event: 'A vs B', market: 'Resultado' }] },
      absentFields: { 'selections[].market': 'NOT_IN_TICKET' },
    };
    expect(() => parseCase(json, 'caso-x')).toThrow(/también en expected/);
  });
});

describe('toEvalActual: pasa por el validador de producción', () => {
  it('una respuesta válida se evalúa sin su confianza', () => {
    expect(toEvalActual({ house: 'Betano', confidenceByField: { house: 0.9 } })).toEqual({
      status: 'VALID',
      extraction: { house: 'Betano' },
    });
  });

  it('una respuesta que el validador rechazaría queda REJECTED, con las rutas y códigos', () => {
    expect(toEvalActual({ officialAmount: 'abc' })).toEqual({
      status: 'REJECTED',
      issues: [{ path: 'officialAmount', code: 'INVALID_MONEY' }],
    });
    expect(toEvalActual('no es un objeto').status).toBe('REJECTED');
    expect(toEvalActual({ house: 'Betano', confidenceByField: { house: 4 } }).status).toBe(
      'REJECTED',
    );
  });
});

describe('expectedProblems', () => {
  it('detecta una errata en la extracción esperada de un fixture', () => {
    const bad: EvalCase = {
      meta: { id: 'x', description: 'd' },
      expected: { placedDate: '2026-02-30' },
    };
    expect(expectedProblems(bad)).toEqual([{ path: 'placedDate', code: 'INVALID_DATE' }]);
  });
});

describe('fixtures en disco: caso sintético de ejemplo', () => {
  it('se carga con sus ejecuciones y su extracción esperada es válida', async () => {
    const cases = await loadCases([SYNTHETIC_ROOT]);
    const example = cases.find((c) => c.evalCase.meta.id === 'sintetico-multiple-pendiente')!;
    expect(example.evalCase.meta.synthetic).toBe(true);
    expect(example.actualLabels).toEqual(['baseline', 'candidate']);
    expect(expectedProblems(example.evalCase)).toEqual([]);
  });

  it('una raíz inexistente se ignora (los casos reales viven en una carpeta local opcional)', async () => {
    expect(await loadCases(['/no/existe'])).toEqual([]);
  });

  it('una etiqueta sin archivo no se evalúa ni se inventa', async () => {
    const [example] = await loadCases([SYNTHETIC_ROOT]);
    expect(await loadActual(example!, 'no-existe')).toBeUndefined();
    const { report, skipped } = await evaluateRun([example!], 'no-existe');
    expect(report.casesEvaluated).toBe(0);
    expect(skipped).toEqual(['sintetico-multiple-pendiente']);
  });

  it('baseline frente a candidate: 4 datos mal en el baseline, todos corregidos y sin regresiones', async () => {
    const cases = await loadCases([SYNTHETIC_ROOT]);
    const baseline = (await evaluateRun(cases, 'baseline')).report;
    const candidate = (await evaluateRun(cases, 'candidate')).report;

    expect(baseline.global).toMatchObject({ incorrect: 2, missing: 1, unexpected: 1 });
    expect(baseline.byField['selections[].visibleOdds']).toMatchObject({
      incorrect: 1,
      correct: 2,
    });
    expect(candidate.global).toMatchObject({
      incorrect: 0,
      missing: 0,
      unexpected: 0,
      accuracy: 1,
    });

    const cmp = compareReports(baseline, candidate);
    expect(cmp.regressions).toEqual([]);
    expect(cmp.improvements.map((c) => c.path).sort()).toEqual([
      'officialTotalOdds',
      'placedTime',
      'selections[1].visibleOdds',
      'stake',
    ]);
  });
});
