import type { TicketExtraction, TicketExtractionSelection } from '@letfer/shared';
import type { TicketExtractionIssue } from '../../src/ai/ticket-extraction-validator.js';

/*
 * Arnés de evaluación de la lectura de tickets (precisión de la IA). Responsabilidad distinta a
 * la del validador: `ticket-extraction-validator` decide si una respuesta es ACEPTABLE (forma y
 * coherencia); el evaluador decide si COINCIDE con lo que de verdad debía extraerse. Nada de aquí
 * llama a Anthropic: la respuesta obtenida se aporta ya hecha (`actual/<etiqueta>.json`).
 *
 * Los tipos de la extracción son los de `@letfer/shared` (`TicketExtraction`); aquí solo se
 * añade lo que el contrato no tiene: qué campos se evalúan y cómo se describe un caso.
 */

/** Campos escalares de `TicketExtraction` que se evalúan (todos menos `selections`). */
export const SCALAR_FIELDS = [
  'house',
  'placedDate',
  'placedTime',
  'betType',
  'externalReference',
  'officialTotalOdds',
  'officialAmount',
  'stake',
  'officialPotentialReturn',
  'officialRealizedReturn',
  'result',
] as const satisfies readonly (keyof TicketExtraction)[];
export type ScalarField = (typeof SCALAR_FIELDS)[number];

/** Campos de cada selección que se evalúan. */
export const SELECTION_FIELDS = [
  'sport',
  'event',
  'market',
  'selection',
  'visibleOdds',
  'legScore',
  'legResult',
  // Las condiciones internas del leg se comparan como un solo dato (ver `selectionFieldValue`).
  'conditions',
] as const satisfies readonly (keyof TicketExtractionSelection)[];
export type SelectionField = (typeof SELECTION_FIELDS)[number];

/**
 * Compila solo si `TicketExtraction` no gana un campo escalar que el arnés no evalúa (y lo mismo
 * para las selecciones): así un campo nuevo del contrato no queda sin medir en silencio.
 */
export type AllExtractionFieldsCovered = [
  Exclude<keyof TicketExtraction, 'selections' | ScalarField>,
  Exclude<keyof TicketExtractionSelection, SelectionField>,
] extends [never, never]
  ? true
  : never;
export const ALL_EXTRACTION_FIELDS_COVERED: AllExtractionFieldsCovered = true;

/** Clave de métrica de un campo de selección, agregada sobre todas las selecciones. */
export type SelectionFieldKey = `selections[].${SelectionField}`;
export type EvalFieldKey = ScalarField | SelectionFieldKey;

export const EVAL_FIELDS: readonly EvalFieldKey[] = [
  ...SCALAR_FIELDS,
  ...SELECTION_FIELDS.map((field): SelectionFieldKey => `selections[].${field}`),
];

export const isEvalFieldKey = (value: string): value is EvalFieldKey =>
  (EVAL_FIELDS as readonly string[]).includes(value);

/**
 * Resultado de comparar UN dato:
 * - `CORRECT`: esperado y obtenido, idénticos.
 * - `CORRECT_ABSENT`: no debía extraerse y no se extrajo (omisión correcta).
 * - `INCORRECT`: esperado y obtenido, distintos.
 * - `MISSING`: debía extraerse y no está.
 * - `UNEXPECTED`: no debía extraerse (ausente del ticket o ilegible) y apareció.
 */
export const EVAL_OUTCOMES = [
  'CORRECT',
  'CORRECT_ABSENT',
  'INCORRECT',
  'MISSING',
  'UNEXPECTED',
] as const;
export type EvalOutcome = (typeof EVAL_OUTCOMES)[number];

export const isHit = (outcome: EvalOutcome): boolean =>
  outcome === 'CORRECT' || outcome === 'CORRECT_ABSENT';

/** Por qué un campo no aparece en la extracción esperada (solo documenta; puntúa igual). */
export type AbsenceReason = 'NOT_IN_TICKET' | 'UNREADABLE';

/** Un error ya observado en la lectura real de este ticket (qué leyó, por qué es incorrecto). */
export interface KnownError {
  /** Ruta del dato, p. ej. `officialAmount` o `selections[1].visibleOdds`. */
  path: string;
  /** Lo que leyó la IA. */
  read?: string;
  explanation: string;
}

export interface EvalCaseMeta {
  /** Debe coincidir con el nombre de la carpeta del caso. */
  id: string;
  description: string;
  /** Casa del ticket (informativo, para agrupar). */
  house?: string;
  /** Tipo de pantalla: detalle, lista, confirmación, captura larga… (informativo). */
  screen?: string;
  /** `true` en los casos inventados para probar el propio arnés. */
  synthetic?: boolean;
  /** Archivo de imagen/PDF original, relativo a la carpeta del caso (opcional). */
  imageFile?: string;
}

/**
 * Caso de evaluación (`case.json`). `expected` es la extracción CORRECTA: un campo ausente
 * significa "no debe extraerse" (no aparece en el ticket o no es legible); si la IA lo devuelve
 * cuenta como inesperado.
 */
export interface EvalCase {
  meta: EvalCaseMeta;
  expected: TicketExtraction;
  /** Campos no relevantes para este ticket: no se puntúan (ni a favor ni en contra). */
  ignoredFields?: EvalFieldKey[];
  /** Campos ausentes de `expected` a propósito, con el motivo. No pueden estar en `expected`. */
  absentFields?: Partial<Record<EvalFieldKey, AbsenceReason>>;
  knownErrors?: KnownError[];
}

/**
 * Lo obtenido en una ejecución. `VALID` es la extracción que superó el validador (la que se
 * habría persistido); `REJECTED` es una respuesta que el validador habría rechazado: el usuario no
 * recibe nada, así que se evalúa como extracción vacía.
 */
export type EvalActual =
  | { status: 'VALID'; extraction: TicketExtraction }
  | { status: 'REJECTED'; issues: TicketExtractionIssue[] };

/** Un dato comparado. */
export interface SlotResult {
  caseId: string;
  /** Ruta concreta, p. ej. `selections[2].visibleOdds`. */
  path: string;
  /** Clave de métrica agregada, p. ej. `selections[].visibleOdds`. */
  field: EvalFieldKey;
  outcome: EvalOutcome;
  expected?: string;
  actual?: string;
  absence?: AbsenceReason;
}

/** Qué falló en una selección concreta. */
export interface SelectionFailure {
  index: number;
  fields: SelectionField[];
  /** La selección obtenida no existe en lo esperado (sobra). */
  extra: boolean;
  /** La selección esperada no existe en lo obtenido (falta). */
  absent: boolean;
}

export interface CaseResult {
  caseId: string;
  description: string;
  synthetic: boolean;
  rejected: boolean;
  rejectionIssues: TicketExtractionIssue[];
  selectionCount: { expected: number; actual: number };
  /** Condiciones internas en total (suma de `conditions` de todos los legs). Informativo. */
  conditionCount: { expected: number; actual: number };
  /**
   * `visibleOdds` de cada selección, en orden (`∅` si no hay). Informativo: la comparación es por
   * posición y una selección de más o de menos desplaza todas las siguientes, así que esta
   * secuencia permite ver que, p. ej., las demás cuotas siguen estando aunque cambien de posición.
   */
  oddsSequence: { expected: string[]; actual: string[] };
  slots: SlotResult[];
  failedSelections: SelectionFailure[];
}
