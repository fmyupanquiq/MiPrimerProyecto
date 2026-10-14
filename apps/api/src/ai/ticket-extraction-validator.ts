import {
  BET_TYPES,
  isOddsString,
  isPositiveMoney,
  isPositiveOdds,
  isStakeString,
  normalizeMoneyInput,
  VISIBLE_RESULTS,
  type TicketConfidenceByField,
  type TicketExtraction,
  type TicketExtractionCondition,
  type TicketExtractionSelection,
} from '@letfer/shared';

/**
 * Barrera de validación entre la respuesta de la IA y la persistencia (§29, §97, §110.3): la IA
 * propone, el backend decide si lo propuesto es aceptable. Todo lo que llega de un proveedor es
 * una entrada no confiable (`unknown`) hasta pasar por aquí.
 *
 * Política (no se adivina ni se corrige nada):
 * - Los valores aceptados se devuelven EXACTAMENTE como llegaron (sin recortar, sin normalizar);
 *   `normalizeMoneyInput` solo se usa para comprobar que el dinero es interpretable.
 * - Cualquier regla incumplida invalida TODA la respuesta: nunca se persiste una parte.
 * - Las claves desconocidas no se rechazan (el esquema de la herramienta no las prohíbe) pero
 *   tampoco se persisten: se descartan, para que solo se guarde el contrato `TicketExtraction`.
 * - Los problemas se describen solo con ruta y código, NUNCA con el valor recibido: el contenido
 *   viene del ticket (texto no confiable) y el mensaje termina en el histórico y en los logs.
 */

export const TICKET_EXTRACTION_ISSUE_CODES = [
  'NOT_AN_OBJECT',
  'NOT_AN_ARRAY',
  'WRONG_TYPE',
  'EMPTY_VALUE',
  'TOO_LONG',
  'INVALID_ENUM',
  'INVALID_DATE',
  'INVALID_TIME',
  'INVALID_MONEY',
  'NEGATIVE_MONEY',
  'NOT_POSITIVE',
  'INVALID_ODDS',
  'INVALID_STAKE',
  'OUT_OF_RANGE',
  'TOO_MANY_ENTRIES',
  'INCOMPLETE_SELECTION',
  'DUPLICATE_SELECTION',
  'ODDS_MISMATCH',
  'TOO_FEW_ENTRIES',
  'CONDITIONS_WITH_SELECTION',
] as const;
export type TicketExtractionIssueCode = (typeof TICKET_EXTRACTION_ISSUE_CODES)[number];

export interface TicketExtractionIssue {
  /** Ruta del campo, p. ej. `officialAmount` o `selections[2].visibleOdds`. */
  path: string;
  code: TicketExtractionIssueCode;
}

export type TicketExtractionValidation =
  | {
      ok: true;
      extraction: TicketExtraction;
      confidenceByField: TicketConfidenceByField | null;
    }
  | { ok: false; issues: TicketExtractionIssue[] };

/** Mismo máximo que el texto de una selección de apuesta (`bet.ts`, `TEXT_MAX_LENGTH`). */
const TEXT_MAX_LENGTH = 200;
/** Un bloque de condiciones tiene entre 2 y 10: una sola condición es un leg normal. */
const CONDITIONS_MIN = 2;
const CONDITIONS_MAX = 10;
const SCORE_MAX_LENGTH = 30;
const REFERENCE_MAX_LENGTH = 100;
const CONFIDENCE_MAX_ENTRIES = 50;
const CONFIDENCE_KEY_MAX_LENGTH = 100;
const MAX_REPORTED_ISSUES = 10;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Error de dominio: la respuesta del proveedor no superó la validación. Mensaje seguro (sin valores). */
export class TicketExtractionInvalidError extends Error {
  constructor(readonly issues: readonly TicketExtractionIssue[]) {
    super(describeTicketExtractionIssues(issues));
    this.name = 'TicketExtractionInvalidError';
  }
}

export function describeTicketExtractionIssues(issues: readonly TicketExtractionIssue[]): string {
  const shown = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path}: ${issue.code}`)
    .join('; ');
  const extra =
    issues.length > MAX_REPORTED_ISSUES ? ` (+${issues.length - MAX_REPORTED_ISSUES} más)` : '';
  return `La respuesta de la IA no superó la validación — ${shown}${extra}`;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isValidCalendarDate = (value: string): boolean => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/** Forma canónica de una cuota ya validada con `isOddsString`, para comparar sin `number`. */
const canonicalOdds = (value: string): string => {
  const [integer = '0', fraction = ''] = value.trim().split('.');
  const int = integer.replace(/^0+(?=\d)/, '');
  const frac = fraction.replace(/0+$/, '');
  return frac === '' ? int : `${int}.${frac}`;
};

class Collector {
  readonly issues: TicketExtractionIssue[] = [];
  add(path: string, code: TicketExtractionIssueCode): void {
    this.issues.push({ path, code });
  }

  /** Texto no vacío (tras recortar solo para comprobar) y acotado; el valor se conserva tal cual. */
  text(path: string, value: unknown): string | undefined {
    if (typeof value !== 'string') {
      this.add(path, 'WRONG_TYPE');
      return undefined;
    }
    if (value.trim() === '') {
      this.add(path, 'EMPTY_VALUE');
      return undefined;
    }
    if (value.length > TEXT_MAX_LENGTH) {
      this.add(path, 'TOO_LONG');
      return undefined;
    }
    return value;
  }

  money(path: string, value: unknown, options: { positive: boolean }): string | undefined {
    const raw = this.text(path, value);
    if (raw === undefined) return undefined;
    const normalized = normalizeMoneyInput(raw);
    if (normalized === null) {
      this.add(path, 'INVALID_MONEY');
      return undefined;
    }
    if (normalized.startsWith('-')) {
      this.add(path, 'NEGATIVE_MONEY');
      return undefined;
    }
    if (options.positive && !isPositiveMoney(normalized)) {
      this.add(path, 'NOT_POSITIVE');
      return undefined;
    }
    return raw;
  }

  /** Texto corto (marcador, referencia): no vacío y acotado por `max`, conservado tal cual. */
  shortText(path: string, value: unknown, max: number): string | undefined {
    const raw = this.text(path, value);
    if (raw === undefined) return undefined;
    if (raw.length > max) {
      this.add(path, 'TOO_LONG');
      return undefined;
    }
    return raw;
  }

  visibleResult(path: string, value: unknown): string | undefined {
    const raw = this.text(path, value);
    if (raw === undefined) return undefined;
    if (!(VISIBLE_RESULTS as readonly string[]).includes(raw)) {
      this.add(path, 'INVALID_ENUM');
      return undefined;
    }
    return raw;
  }

  odds(path: string, value: unknown): string | undefined {
    const raw = this.text(path, value);
    if (raw === undefined) return undefined;
    if (!isOddsString(raw)) {
      this.add(path, 'INVALID_ODDS');
      return undefined;
    }
    if (!isPositiveOdds(raw)) {
      this.add(path, 'NOT_POSITIVE');
      return undefined;
    }
    return raw;
  }
}

function validateSelection(
  c: Collector,
  path: string,
  raw: unknown,
): TicketExtractionSelection | undefined {
  if (!isPlainObject(raw)) {
    c.add(path, 'NOT_AN_OBJECT');
    return undefined;
  }
  const before = c.issues.length;
  const out: TicketExtractionSelection = {};
  if (raw['sport'] !== undefined) {
    const v = c.text(`${path}.sport`, raw['sport']);
    if (v !== undefined) out.sport = v;
  }
  if (raw['event'] !== undefined) {
    const v = c.text(`${path}.event`, raw['event']);
    if (v !== undefined) out.event = v;
  }
  if (raw['market'] !== undefined) {
    const v = c.text(`${path}.market`, raw['market']);
    if (v !== undefined) out.market = v;
  }
  if (raw['selection'] !== undefined) {
    const v = c.text(`${path}.selection`, raw['selection']);
    if (v !== undefined) out.selection = v;
  }
  if (raw['visibleOdds'] !== undefined) {
    const v = c.odds(`${path}.visibleOdds`, raw['visibleOdds']);
    if (v !== undefined) out.visibleOdds = v;
  }
  if (raw['legScore'] !== undefined) {
    const v = c.shortText(`${path}.legScore`, raw['legScore'], SCORE_MAX_LENGTH);
    if (v !== undefined) out.legScore = v;
  }
  if (raw['legResult'] !== undefined) {
    const v = c.visibleResult(`${path}.legResult`, raw['legResult']);
    if (v !== undefined) out.legResult = v;
  }
  if (raw['conditions'] !== undefined) {
    const conditions = validateConditions(c, `${path}.conditions`, raw['conditions']);
    if (conditions) out.conditions = conditions;
    // Un bloque se describe SOLO con sus condiciones: un `selection` además sería una segunda
    // fuente (p. ej. el resumen en texto) que podría contradecirlas.
    if (conditions && out.selection !== undefined) {
      c.add(`${path}.selection`, 'CONDITIONS_WITH_SELECTION');
    }
  }
  // Una selección sin evento, mercado, pronóstico ni condiciones no identifica nada que registrar.
  if (
    c.issues.length === before &&
    !out.event &&
    !out.market &&
    !out.selection &&
    !out.conditions
  ) {
    c.add(path, 'INCOMPLETE_SELECTION');
    return undefined;
  }
  return out;
}

function validateConditions(
  c: Collector,
  path: string,
  raw: unknown,
): TicketExtractionCondition[] | undefined {
  if (!Array.isArray(raw)) {
    c.add(path, 'NOT_AN_ARRAY');
    return undefined;
  }
  if (raw.length < CONDITIONS_MIN) {
    c.add(path, 'TOO_FEW_ENTRIES');
    return undefined;
  }
  if (raw.length > CONDITIONS_MAX) {
    c.add(path, 'TOO_MANY_ENTRIES');
    return undefined;
  }
  const list: TicketExtractionCondition[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      c.add(itemPath, 'NOT_AN_OBJECT');
      return;
    }
    const before = c.issues.length;
    const out: TicketExtractionCondition = {};
    if (item['market'] !== undefined) {
      const v = c.text(`${itemPath}.market`, item['market']);
      if (v !== undefined) out.market = v;
    }
    // El pronóstico es obligatorio: una condición sin él no dice qué se apostó.
    if (item['selection'] === undefined) c.add(`${itemPath}.selection`, 'INCOMPLETE_SELECTION');
    else {
      const v = c.text(`${itemPath}.selection`, item['selection']);
      if (v !== undefined) out.selection = v;
    }
    if (item['conditionStatus'] !== undefined) {
      const v = c.visibleResult(`${itemPath}.conditionStatus`, item['conditionStatus']);
      if (v !== undefined) out.conditionStatus = v;
    }
    // Las condiciones no llevan cuota: una clave `visibleOdds` (u otra desconocida) se descarta.
    if (c.issues.length !== before) return;
    const key = [out.market, out.selection]
      .map((part) => (part ?? '').trim().toLowerCase())
      .join(' ');
    if (seen.has(key)) c.add(itemPath, 'DUPLICATE_SELECTION');
    seen.add(key);
    list.push(out);
  });
  return list;
}

const selectionKey = (s: TicketExtractionSelection): string =>
  [
    s.event,
    s.market,
    s.selection,
    (s.conditions ?? []).map((cond) => `${cond.market ?? ''}|${cond.selection ?? ''}`).join('||'),
    // La cuota ya está validada: "1.5" y "1.50" son la misma cifra.
    s.visibleOdds === undefined ? undefined : canonicalOdds(s.visibleOdds),
  ]
    .map((part) => (part ?? '').trim().toLowerCase())
    .join('\u0000');

function validateConfidence(c: Collector, raw: unknown): TicketConfidenceByField | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    c.add('confidenceByField', 'NOT_AN_OBJECT');
    return null;
  }
  const entries = Object.entries(raw);
  if (entries.length > CONFIDENCE_MAX_ENTRIES) {
    c.add('confidenceByField', 'TOO_MANY_ENTRIES');
    return null;
  }
  const out: TicketConfidenceByField = {};
  for (const [key, value] of entries) {
    const path = `confidenceByField.${key.slice(0, CONFIDENCE_KEY_MAX_LENGTH)}`;
    if (key.length > CONFIDENCE_KEY_MAX_LENGTH) {
      c.add(path, 'TOO_LONG');
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      c.add(path, 'WRONG_TYPE');
    } else if (value < 0 || value > 1) {
      c.add(path, 'OUT_OF_RANGE');
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Valida la salida cruda de un `TicketReader`. `extraction` y `confidenceByField` son `unknown`
 * a propósito: la interfaz declara tipos, pero un proveedor (o un `as`) puede mentir.
 */
export function validateTicketExtraction(
  extraction: unknown,
  confidenceByField: unknown,
): TicketExtractionValidation {
  const c = new Collector();
  if (!isPlainObject(extraction)) {
    return { ok: false, issues: [{ path: 'extraction', code: 'NOT_AN_OBJECT' }] };
  }

  const out: TicketExtraction = {};

  if (extraction['house'] !== undefined) {
    const v = c.text('house', extraction['house']);
    if (v !== undefined) out.house = v;
  }

  if (extraction['placedDate'] !== undefined) {
    const v = c.text('placedDate', extraction['placedDate']);
    if (v !== undefined) {
      if (isValidCalendarDate(v)) out.placedDate = v;
      else c.add('placedDate', 'INVALID_DATE');
    }
  }
  if (extraction['placedTime'] !== undefined) {
    const v = c.text('placedTime', extraction['placedTime']);
    if (v !== undefined) {
      if (TIME_PATTERN.test(v)) out.placedTime = v;
      else c.add('placedTime', 'INVALID_TIME');
    }
  }

  if (extraction['betType'] !== undefined) {
    const v = c.text('betType', extraction['betType']);
    if (v !== undefined) {
      if ((BET_TYPES as readonly string[]).includes(v)) out.betType = v;
      else c.add('betType', 'INVALID_ENUM');
    }
  }

  if (extraction['externalReference'] !== undefined) {
    const v = c.shortText(
      'externalReference',
      extraction['externalReference'],
      REFERENCE_MAX_LENGTH,
    );
    if (v !== undefined) out.externalReference = v;
  }

  if (extraction['selections'] !== undefined) {
    if (!Array.isArray(extraction['selections'])) {
      c.add('selections', 'NOT_AN_ARRAY');
    } else {
      const list: TicketExtractionSelection[] = [];
      const seen = new Set<string>();
      extraction['selections'].forEach((item: unknown, index) => {
        const path = `selections[${index}]`;
        const selection = validateSelection(c, path, item);
        if (!selection) return;
        const key = selectionKey(selection);
        if (seen.has(key)) c.add(path, 'DUPLICATE_SELECTION');
        seen.add(key);
        list.push(selection);
      });
      out.selections = list;
    }
  }

  if (extraction['stake'] !== undefined) {
    const v = c.text('stake', extraction['stake']);
    if (v !== undefined) {
      if (isStakeString(v.trim())) out.stake = v;
      else c.add('stake', 'INVALID_STAKE');
    }
  }

  if (extraction['officialTotalOdds'] !== undefined) {
    const v = c.odds('officialTotalOdds', extraction['officialTotalOdds']);
    if (v !== undefined) out.officialTotalOdds = v;
  }
  if (extraction['officialAmount'] !== undefined) {
    const v = c.money('officialAmount', extraction['officialAmount'], { positive: true });
    if (v !== undefined) out.officialAmount = v;
  }
  if (extraction['officialPotentialReturn'] !== undefined) {
    const v = c.money('officialPotentialReturn', extraction['officialPotentialReturn'], {
      positive: false,
    });
    if (v !== undefined) out.officialPotentialReturn = v;
  }
  if (extraction['officialRealizedReturn'] !== undefined) {
    const v = c.money('officialRealizedReturn', extraction['officialRealizedReturn'], {
      positive: false,
    });
    if (v !== undefined) out.officialRealizedReturn = v;
  }

  // El resultado es texto libre en el contrato actual (sin enumeración aprobada): solo se exige
  // que sea texto no vacío. Su interpretación sigue siendo cosa de la web (`statusFromResultText`).
  if (extraction['result'] !== undefined) {
    const v = c.text('result', extraction['result']);
    if (v !== undefined) out.result = v;
  }

  // Relaciones entre campos (solo si los campos implicados ya son válidos individualmente).
  // El `betType` de la IA es solo una pista: el tipo real lo deriva el backend de la estructura de
  // selecciones (`deriveBetType`, §90) y la persona confirma, así que no se contrasta con su número.
  const selectionCount = out.selections?.length ?? 0;
  // §6 (Fase 10.8): en una Simple la cuota total y la de su única selección son la misma cifra.
  const onlyOdds = selectionCount === 1 ? out.selections![0]!.visibleOdds : undefined;
  if (
    out.betType === 'SIMPLE' &&
    out.officialTotalOdds !== undefined &&
    onlyOdds !== undefined &&
    canonicalOdds(out.officialTotalOdds) !== canonicalOdds(onlyOdds)
  ) {
    c.add('officialTotalOdds', 'ODDS_MISMATCH');
  }

  const confidence = validateConfidence(c, confidenceByField);

  if (c.issues.length > 0) return { ok: false, issues: c.issues };
  return { ok: true, extraction: out, confidenceByField: confidence };
}
