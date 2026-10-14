import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { expectedProblems, loadCases } from './load-cases.js';
import { compareReports, formatComparison, formatReport } from './report.js';
import { evaluateRun } from './run-eval.js';

/**
 * Ejecutor del arnés sobre los casos de `cases/` (sintéticos, versionados) y `cases-local/` (reales,
 * ignorados por Git). NO llama a Anthropic: solo lee las respuestas ya guardadas en `actual/`.
 *
 * Variables de entorno (ver README.md):
 *   EVAL_RUN=<etiqueta>        ejecución a evaluar (obligatoria para que se evalúe algo)
 *   EVAL_BASELINE=<etiqueta>   otra ejecución con la que comparar (regresiones)
 *   EVAL_SYNTHETIC=1           incluir también los casos sintéticos (por defecto se excluyen)
 *   EVAL_OUT=<archivo.json>    guardar el informe de la ejecución en JSON
 */
const run = process.env['EVAL_RUN'];
const baselineLabel = process.env['EVAL_BASELINE'];
const includeSynthetic = process.env['EVAL_SYNTHETIC'] === '1';
const out = process.env['EVAL_OUT'];

describe('fixtures de evaluación', () => {
  it('todos los casos se cargan y su extracción esperada es aceptable para el validador', async () => {
    const cases = await loadCases();
    for (const { evalCase } of cases) {
      expect(expectedProblems(evalCase), `caso ${evalCase.meta.id}`).toEqual([]);
    }
  });
});

describe.skipIf(!run)('evaluación de tickets (solo con EVAL_RUN)', () => {
  it('evalúa la ejecución indicada e imprime el informe', async () => {
    const cases = (await loadCases()).filter((c) => includeSynthetic || !c.evalCase.meta.synthetic);
    const current = await evaluateRun(cases, run!);

    console.log(`\n${formatReport(current.report)}`);
    if (current.skipped.length > 0) {
      console.log(`\nSin respuesta para "${run}" (no evaluados): ${current.skipped.join(', ')}`);
    }
    if (baselineLabel) {
      const baseline = await evaluateRun(cases, baselineLabel);
      console.log(`\n${formatComparison(compareReports(baseline.report, current.report))}`);
    }
    if (out) await writeFile(out, JSON.stringify(current.report, null, 2), 'utf8');
    expect(current.report.casesEvaluated + current.skipped.length).toBe(cases.length);
  });
});
