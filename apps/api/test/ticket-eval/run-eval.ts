import { evaluateCase } from './compare-extraction.js';
import { loadActual, type LoadedCase } from './load-cases.js';
import { buildReport, type EvalReport } from './report.js';

export interface EvalRun {
  report: EvalReport;
  /** Casos sin `actual/<etiqueta>.json`: no se evalúan (nunca se inventa una respuesta). */
  skipped: string[];
}

/**
 * Evalúa la ejecución `label` sobre los casos dados. Solo usa respuestas ya guardadas en disco:
 * este módulo no llama a Anthropic ni a ningún servicio.
 */
export async function evaluateRun(cases: readonly LoadedCase[], label: string): Promise<EvalRun> {
  const results = [];
  const skipped: string[] = [];
  for (const loaded of cases) {
    const actual = await loadActual(loaded, label);
    if (!actual) {
      skipped.push(loaded.evalCase.meta.id);
      continue;
    }
    results.push(evaluateCase(loaded.evalCase, actual));
  }
  return { report: buildReport(label, results), skipped };
}
