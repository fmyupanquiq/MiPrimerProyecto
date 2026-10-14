import type { TicketExtraction, TicketExtractionSelection } from '@letfer/shared';
import {
  SCALAR_FIELDS,
  SELECTION_FIELDS,
  isHit,
  type EvalActual,
  type EvalCase,
  type EvalFieldKey,
  type EvalOutcome,
  type CaseResult,
  type SelectionFailure,
  type SlotResult,
} from './types.js';

/**
 * Valor comparable de un campo de selección. Las condiciones internas se serializan en el orden en
 * que están (mercado | pronóstico | estado): igualdad estricta, sin reordenar ni normalizar nada.
 */
export function selectionFieldValue(
  selection: TicketExtractionSelection | undefined,
  field: (typeof SELECTION_FIELDS)[number],
): string | undefined {
  if (!selection) return undefined;
  if (field !== 'conditions') return selection[field];
  return selection.conditions
    ?.map((c) => `${c.market ?? '∅'} | ${c.selection ?? '∅'} | ${c.conditionStatus ?? '∅'}`)
    .join(' ‖ ');
}

/**
 * Compara un dato. Igualdad ESTRICTA de cadenas (`===`): sin recortar, sin ignorar mayúsculas, sin
 * normalizar dinero ni cuotas ("1.85" ≠ "1.95", "1.5" ≠ "1.50", "S/10.00" ≠ "10.00"). Una
 * comparación "inteligente" podría ocultar justo el error que se quiere medir.
 */
export function classify(expected: string | undefined, actual: string | undefined): EvalOutcome {
  if (expected === undefined && actual === undefined) return 'CORRECT_ABSENT';
  if (expected !== undefined && actual === undefined) return 'MISSING';
  if (expected === undefined) return 'UNEXPECTED';
  return expected === actual ? 'CORRECT' : 'INCORRECT';
}

/**
 * Evalúa UNA respuesta obtenida contra el caso. No valida la respuesta (eso es del validador):
 * una respuesta `REJECTED` se evalúa como extracción vacía, que es lo que recibiría el usuario.
 *
 * Las selecciones se comparan por POSICIÓN (la 1ª esperada con la 1ª obtenida, etc.) y cada uno de
 * sus campos por separado, para poder decir qué selección concreta y qué campo fallaron. Una
 * selección obtenida de más cuenta sus campos como inesperados; una que falta, como faltantes.
 */
export function evaluateCase(evalCase: EvalCase, actual: EvalActual): CaseResult {
  const caseId = evalCase.meta.id;
  const ignored = new Set<EvalFieldKey>(evalCase.ignoredFields ?? []);
  const absences = evalCase.absentFields ?? {};
  const rejected = actual.status === 'REJECTED';
  const got: TicketExtraction = actual.status === 'VALID' ? actual.extraction : {};

  const slots: SlotResult[] = [];
  const push = (
    path: string,
    field: EvalFieldKey,
    expected: string | undefined,
    obtained: string | undefined,
  ): void => {
    if (ignored.has(field)) return;
    const slot: SlotResult = {
      caseId,
      path,
      field,
      outcome: classify(expected, obtained),
    };
    if (expected !== undefined) slot.expected = expected;
    if (obtained !== undefined) slot.actual = obtained;
    const absence = absences[field];
    if (expected === undefined && absence !== undefined) slot.absence = absence;
    slots.push(slot);
  };

  for (const field of SCALAR_FIELDS) {
    push(field, field, evalCase.expected[field], got[field]);
  }

  const expectedSelections: readonly TicketExtractionSelection[] =
    evalCase.expected.selections ?? [];
  const actualSelections: readonly TicketExtractionSelection[] = got.selections ?? [];
  const count = Math.max(expectedSelections.length, actualSelections.length);
  const failedSelections: SelectionFailure[] = [];

  for (let index = 0; index < count; index++) {
    const want = expectedSelections[index];
    const have = actualSelections[index];
    const failedFields: SelectionFailure['fields'] = [];
    for (const field of SELECTION_FIELDS) {
      const key = `selections[].${field}` as const;
      const before = slots.length;
      push(
        `selections[${index}].${field}`,
        key,
        selectionFieldValue(want, field),
        selectionFieldValue(have, field),
      );
      const slot = slots[before];
      if (slot && !isHit(slot.outcome)) failedFields.push(field);
    }
    if (failedFields.length > 0) {
      failedSelections.push({
        index,
        fields: failedFields,
        extra: want === undefined,
        absent: have === undefined,
      });
    }
  }

  return {
    caseId,
    description: evalCase.meta.description,
    synthetic: evalCase.meta.synthetic === true,
    rejected,
    rejectionIssues: actual.status === 'REJECTED' ? actual.issues : [],
    selectionCount: { expected: expectedSelections.length, actual: actualSelections.length },
    conditionCount: {
      expected: expectedSelections.reduce((n, s) => n + (s.conditions?.length ?? 0), 0),
      actual: actualSelections.reduce((n, s) => n + (s.conditions?.length ?? 0), 0),
    },
    oddsSequence: {
      expected: expectedSelections.map((s) => s.visibleOdds ?? '∅'),
      actual: actualSelections.map((s) => s.visibleOdds ?? '∅'),
    },
    slots,
    failedSelections,
  };
}
