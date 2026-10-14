import {
  EVAL_FIELDS,
  isHit,
  type CaseResult,
  type EvalFieldKey,
  type EvalOutcome,
  type SlotResult,
} from './types.js';

/** Conteos por resultado. `evaluated` = suma de todos los datos puntuados. */
export interface Stats {
  evaluated: number;
  correct: number;
  correctAbsent: number;
  incorrect: number;
  missing: number;
  unexpected: number;
  /** (correct + correctAbsent) / evaluated; `null` si no hay datos. Premia también omitir bien. */
  accuracy: number | null;
  /** correct / (correct + incorrect + missing): de lo que SÍ debía leerse, cuánto se leyó bien. */
  recall: number | null;
}

export interface EvalReport {
  /** Etiqueta de la ejecución (p. ej. `baseline`, `prompt-v2`). */
  label: string;
  casesEvaluated: number;
  /** Casos cuya respuesta habría rechazado el validador (cuentan como extracción vacía). */
  casesRejected: number;
  global: Stats;
  byField: Record<EvalFieldKey, Stats>;
  cases: CaseResult[];
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function statsOf(slots: readonly SlotResult[]): Stats {
  const count = (outcome: EvalOutcome) => slots.filter((s) => s.outcome === outcome).length;
  const correct = count('CORRECT');
  const correctAbsent = count('CORRECT_ABSENT');
  const incorrect = count('INCORRECT');
  const missing = count('MISSING');
  const unexpected = count('UNEXPECTED');
  return {
    evaluated: slots.length,
    correct,
    correctAbsent,
    incorrect,
    missing,
    unexpected,
    accuracy: ratio(correct + correctAbsent, slots.length),
    recall: ratio(correct, correct + incorrect + missing),
  };
}

export function buildReport(label: string, cases: readonly CaseResult[]): EvalReport {
  const all = cases.flatMap((c) => c.slots);
  const byField = Object.fromEntries(
    EVAL_FIELDS.map((field) => [field, statsOf(all.filter((s) => s.field === field))]),
  ) as Record<EvalFieldKey, Stats>;
  return {
    label,
    casesEvaluated: cases.length,
    casesRejected: cases.filter((c) => c.rejected).length,
    global: statsOf(all),
    byField,
    cases: [...cases],
  };
}

export interface SlotChange {
  caseId: string;
  path: string;
  field: EvalFieldKey;
  from: EvalOutcome;
  to: EvalOutcome;
  expected?: string;
  /** Lo obtenido por el candidato. */
  actual?: string;
}

export interface ReportComparison {
  baselineLabel: string;
  candidateLabel: string;
  /** Solo se comparan los casos presentes en ambas ejecuciones. */
  commonCases: number;
  global: { baseline: number | null; candidate: number | null; delta: number | null };
  byField: {
    field: EvalFieldKey;
    baseline: number | null;
    candidate: number | null;
    delta: number | null;
  }[];
  /** Datos que estaban bien en el baseline y ahora no. */
  regressions: SlotChange[];
  /** Datos que estaban mal en el baseline y ahora están bien. */
  improvements: SlotChange[];
}

const delta = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : b - a;

/**
 * Compara dos ejecuciones sobre los MISMOS casos: precisión global y por campo, y dato a dato qué
 * empeoró (regresión) y qué mejoró. Pasar de un error a otro error distinto no cuenta como ninguna
 * de las dos.
 */
export function compareReports(baseline: EvalReport, candidate: EvalReport): ReportComparison {
  const candidateById = new Map(candidate.cases.map((c) => [c.caseId, c]));
  const common = baseline.cases.filter((c) => candidateById.has(c.caseId));
  const commonIds = new Set(common.map((c) => c.caseId));
  const baseCommon = buildReport(
    baseline.label,
    baseline.cases.filter((c) => commonIds.has(c.caseId)),
  );
  const candCommon = buildReport(
    candidate.label,
    candidate.cases.filter((c) => commonIds.has(c.caseId)),
  );

  const regressions: SlotChange[] = [];
  const improvements: SlotChange[] = [];
  for (const base of common) {
    const cand = candidateById.get(base.caseId)!;
    const candByPath = new Map(cand.slots.map((s) => [s.path, s]));
    for (const before of base.slots) {
      const after = candByPath.get(before.path);
      if (!after) continue;
      const change: SlotChange = {
        caseId: base.caseId,
        path: before.path,
        field: before.field,
        from: before.outcome,
        to: after.outcome,
      };
      if (after.expected !== undefined) change.expected = after.expected;
      if (after.actual !== undefined) change.actual = after.actual;
      if (isHit(before.outcome) && !isHit(after.outcome)) regressions.push(change);
      else if (!isHit(before.outcome) && isHit(after.outcome)) improvements.push(change);
    }
  }

  return {
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    commonCases: common.length,
    global: {
      baseline: baseCommon.global.accuracy,
      candidate: candCommon.global.accuracy,
      delta: delta(baseCommon.global.accuracy, candCommon.global.accuracy),
    },
    byField: EVAL_FIELDS.map((field) => ({
      field,
      baseline: baseCommon.byField[field].accuracy,
      candidate: candCommon.byField[field].accuracy,
      delta: delta(baseCommon.byField[field].accuracy, candCommon.byField[field].accuracy),
    })).filter((row) => row.baseline !== null || row.candidate !== null),
    regressions,
    improvements,
  };
}

const pct = (value: number | null): string =>
  value === null ? '   n/a' : `${(value * 100).toFixed(1).padStart(5)}%`;
const signed = (value: number | null): string =>
  value === null ? '   n/a' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
const quote = (value: string | undefined): string =>
  value === undefined ? '∅' : JSON.stringify(value);

/** Informe legible: resumen, tabla por campo y el detalle de cada dato incorrecto, faltante o inesperado. */
export function formatReport(report: EvalReport): string {
  const g = report.global;
  const lines: string[] = [
    `Evaluación "${report.label}": ${report.casesEvaluated} caso(s), ${report.casesRejected} rechazado(s) por el validador`,
    `Precisión global: ${pct(g.accuracy)}  (${g.correct + g.correctAbsent}/${g.evaluated} datos; ` +
      `${g.correct} leídos bien, ${g.correctAbsent} omitidos bien, ${g.incorrect} incorrectos, ` +
      `${g.missing} faltantes, ${g.unexpected} inesperados)`,
    `Lectura correcta de lo que debía leerse: ${pct(g.recall)}`,
    '',
    'Campo                              eval  ok  omit  mal  falt  inesp  precisión',
  ];
  for (const field of EVAL_FIELDS) {
    const s = report.byField[field];
    if (s.evaluated === 0) continue;
    lines.push(
      `${field.padEnd(34)} ${String(s.evaluated).padStart(4)} ${String(s.correct).padStart(3)} ` +
        `${String(s.correctAbsent).padStart(5)} ${String(s.incorrect).padStart(4)} ` +
        `${String(s.missing).padStart(5)} ${String(s.unexpected).padStart(6)}  ${pct(s.accuracy)}`,
    );
  }
  const failures = report.cases.filter((c) => c.slots.some((s) => !isHit(s.outcome)));
  if (failures.length > 0) lines.push('', 'Detalle de errores:');
  for (const c of failures) {
    lines.push(
      `  · ${c.caseId}${c.synthetic ? ' [sintético]' : ''}${c.rejected ? ' [RECHAZADO por el validador]' : ''}` +
        ` — selecciones esperadas/obtenidas: ${c.selectionCount.expected}/${c.selectionCount.actual}`,
    );
    for (const slot of c.slots.filter((s) => !isHit(s.outcome))) {
      lines.push(
        `      ${slot.outcome.padEnd(10)} ${slot.path}: esperado ${quote(slot.expected)} · obtenido ${quote(slot.actual)}`,
      );
    }
    lines.push(
      `      cuotas por selección — esperadas: [${c.oddsSequence.expected.join(', ')}] · obtenidas: [${c.oddsSequence.actual.join(', ')}]`,
    );
    for (const f of c.failedSelections) {
      lines.push(
        `      selección #${f.index + 1} falló en: ${f.fields.join(', ')}` +
          `${f.extra ? ' (selección de más)' : ''}${f.absent ? ' (selección ausente)' : ''}`,
      );
    }
  }
  return lines.join('\n');
}

/** Informe de regresiones entre dos ejecuciones. */
export function formatComparison(cmp: ReportComparison): string {
  const lines: string[] = [
    `Comparación "${cmp.baselineLabel}" → "${cmp.candidateLabel}" (${cmp.commonCases} caso(s) en común)`,
    `Precisión global: ${pct(cmp.global.baseline)} → ${pct(cmp.global.candidate)}  (${signed(cmp.global.delta)})`,
    '',
    'Campo                              antes   ahora   cambio',
  ];
  for (const row of cmp.byField) {
    lines.push(
      `${row.field.padEnd(34)} ${pct(row.baseline)} ${pct(row.candidate)}  ${signed(row.delta)}`,
    );
  }
  lines.push('', `Regresiones: ${cmp.regressions.length} · Mejoras: ${cmp.improvements.length}`);
  for (const r of cmp.regressions) {
    lines.push(
      `  ▼ ${r.caseId} ${r.path}: ${r.from} → ${r.to} (esperado ${quote(r.expected)}, obtenido ${quote(r.actual)})`,
    );
  }
  for (const r of cmp.improvements) {
    lines.push(`  ▲ ${r.caseId} ${r.path}: ${r.from} → ${r.to}`);
  }
  return lines.join('\n');
}
