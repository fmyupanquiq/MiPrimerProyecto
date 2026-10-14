import {
  groupByLeg,
  type BetSelectionInput,
  type BetType,
  type TicketExtractionSelection,
  type VisibleResult,
} from '@letfer/shared';

/*
 * Modelo de edición de las selecciones de "Añadir apuesta" (§114): TICKET → LEG → CONDICIÓN.
 *
 *   - LEG = `eventGroup`; condición interna = cada fila del grupo (`position`).
 *   - Una Múltiple puede contener legs de varias filas (Bet Builder / Same Game Parlay): el leg
 *     tiene UNA sola cuota (la de su fila `position = 0`) y sus condiciones no llevan cuota.
 *   - Las funciones son puras: reciben y devuelven listas; la interfaz solo las invoca.
 *
 * Nada se inventa: un campo que el ticket no mostró queda vacío y la persona decide.
 */

let nextKey = 0;

export type VisibleResultDraft = '' | VisibleResult;

export interface SelectionDraft {
  key: number;
  eventGroup: number;
  position: number;
  sport: string;
  event: string;
  market: string;
  selection: string;
  /** Cuota del LEG si la fila es `position = 0`; las condiciones internas no la usan. */
  visibleOdds: string;
  /** Marcador visible del evento (documental); solo en la fila `position = 0`. */
  legScore: string;
  /** Resultado individual visible del leg (documental); solo en la fila `position = 0`. */
  legResult: VisibleResultDraft;
  /** Estado individual visible de esta condición (documental). */
  conditionStatus: VisibleResultDraft;
}

/** Deporte inicial más habitual (Fase 10.3); se puede cambiar en cada leg. */
export const DEFAULT_SPORT = 'Fútbol';

export const newSelection = (eventGroup: number, position: number): SelectionDraft => ({
  key: nextKey++,
  eventGroup,
  position,
  sport: DEFAULT_SPORT,
  event: '',
  market: '',
  selection: '',
  visibleOdds: '',
  legScore: '',
  legResult: '',
  conditionStatus: '',
});

/** Legs (grupos de filas) en orden, con sus condiciones ordenadas por `position`. */
export const legsOf = (selections: readonly SelectionDraft[]): SelectionDraft[][] =>
  groupByLeg(selections);

/**
 * Deja los legs numerados 0, 1, 2… (en el orden en que están) y las posiciones de cada leg como
 * 0, 1, 2…: lo que exige la API. Mantiene la identidad (`key`) de cada fila.
 */
export function normalize(selections: readonly SelectionDraft[]): SelectionDraft[] {
  return legsOf(selections).flatMap((leg, group) =>
    leg.map((row, position) => ({ ...row, eventGroup: group, position })),
  );
}

/**
 * Formato elegido: decide cómo se organizan las selecciones para que el tipo que la API derive
 * (§90) sea justamente ese. Cambiar de Creada a Múltiple separa cada fila en su propio leg (cada
 * una pasa a ser un evento); de Múltiple a Creada todo se junta en un único leg del primer
 * partido; dentro de una Múltiple los legs creados se conservan.
 */
export function restructure(
  format: BetType,
  selections: readonly SelectionDraft[],
  from: BetType = format,
): SelectionDraft[] {
  const ordered = legsOf(selections).flat();
  const first = ordered[0] ?? newSelection(0, 0);
  if (format === 'SIMPLE') return [{ ...first, eventGroup: 0, position: 0 }];
  if (format === 'MULTIPLE') {
    const legs =
      from === 'CREATED'
        ? ordered.map((row, index) => ({ ...row, eventGroup: index, position: 0 }))
        : ordered;
    const list = normalize(legs);
    return legsOf(list).length >= 2 ? list : [...list, newSelection(legsOf(list).length, 0)];
  }
  const list = ordered.map((row, index) => ({
    ...row,
    eventGroup: 0,
    position: index,
    event: first.event,
    sport: first.sport,
  }));
  const flat = normalize(list);
  return flat.length >= 2
    ? flat
    : [...flat, { ...newSelection(0, flat.length), event: first.event, sport: first.sport }];
}

/** Añade un leg normal vacío al final (Múltiple). */
export const addLeg = (selections: readonly SelectionDraft[]): SelectionDraft[] => [
  ...normalize(selections),
  newSelection(legsOf(selections).length, 0),
];

/**
 * Añade una condición interna al leg (lo convierte en un leg creado si tenía una sola): hereda
 * partido y deporte, y NO lleva cuota — la cuota es del leg.
 */
export function addCondition(
  selections: readonly SelectionDraft[],
  eventGroup: number,
): SelectionDraft[] {
  const list = normalize(selections);
  const leg = list.filter((row) => row.eventGroup === eventGroup);
  if (leg.length === 0) return list;
  const head = leg[0]!;
  const condition = {
    ...newSelection(eventGroup, leg.length),
    event: head.event,
    sport: head.sport,
  };
  const lastIndex = list.lastIndexOf(leg[leg.length - 1]!);
  return normalize([...list.slice(0, lastIndex + 1), condition, ...list.slice(lastIndex + 1)]);
}

/**
 * Quita una fila. Si era la fila principal de un leg creado, la cuota, el marcador y el resultado
 * del leg pasan a la siguiente condición (no se pierden); si el leg queda con una sola fila, vuelve
 * a ser un leg normal.
 */
export function removeRow(selections: readonly SelectionDraft[], key: number): SelectionDraft[] {
  const list = normalize(selections);
  const target = list.find((row) => row.key === key);
  if (!target) return list;
  const leg = list.filter((row) => row.eventGroup === target.eventGroup);
  let rest = list.filter((row) => row.key !== key);
  if (target.position === 0 && leg.length > 1) {
    const heir = leg[1]!;
    rest = rest.map((row) =>
      row.key === heir.key
        ? {
            ...row,
            visibleOdds: target.visibleOdds,
            legScore: target.legScore,
            legResult: target.legResult,
          }
        : row,
    );
  }
  return normalize(rest);
}

/** Quita un leg entero (con todas sus condiciones). */
export const removeLeg = (
  selections: readonly SelectionDraft[],
  eventGroup: number,
): SelectionDraft[] => normalize(selections.filter((row) => row.eventGroup !== eventGroup));

/**
 * Aplica un cambio a una fila. El partido y el deporte son del LEG: se comparten con las demás
 * filas del mismo leg (en una Creada, con todas).
 */
export function patchRow(
  selections: readonly SelectionDraft[],
  key: number,
  patch: Partial<SelectionDraft>,
): SelectionDraft[] {
  const target = selections.find((row) => row.key === key);
  if (!target) return [...selections];
  const shared: Partial<SelectionDraft> = {};
  if ('event' in patch) shared.event = patch.event!;
  if ('sport' in patch) shared.sport = patch.sport!;
  return selections.map((row) =>
    row.key === key
      ? { ...row, ...patch }
      : row.eventGroup === target.eventGroup
        ? { ...row, ...shared }
        : row,
  );
}

const emptyToUndefined = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;

/**
 * Lo que se envía a la API. La cuota de un leg creado dentro de una Múltiple va solo en su fila
 * principal (nunca se copia a las condiciones); en una Creada independiente cada fila conserva la
 * que la persona haya indicado (opcional, §90).
 */
export function toSelectionInputs(
  selections: readonly SelectionDraft[],
  format: BetType,
): BetSelectionInput[] {
  return selections.map((s) => {
    const first = s.position === 0;
    const odds = format === 'MULTIPLE' && !first ? undefined : emptyToUndefined(s.visibleOdds);
    return {
      eventGroup: s.eventGroup,
      position: s.position,
      sport: emptyToUndefined(s.sport),
      event: s.event,
      market: emptyToUndefined(s.market),
      selection: s.selection,
      // Fase 10.6: sin cuota individual (p. ej. una Creada con solo cuota total), se omite en vez
      // de mandar una cadena vacía — nunca se inventa ni se distribuye la cuota total (§90).
      visibleOdds: odds,
      legScore: first ? emptyToUndefined(s.legScore) : undefined,
      legResult: first && s.legResult !== '' ? s.legResult : undefined,
      conditionStatus: s.conditionStatus !== '' ? s.conditionStatus : undefined,
    };
  });
}

/** El tipo que de verdad usará el formulario, igual que derivará la API de la estructura real. */
export function formatFromExtraction(
  betType: string | undefined,
  items: readonly TicketExtractionSelection[],
): BetType {
  const grouped = items.some((item) => (item.conditions?.length ?? 0) > 0);
  if (grouped) return items.length === 1 ? 'CREATED' : 'MULTIPLE';
  if (betType === 'CREATED') return 'CREATED';
  if (betType === 'MULTIPLE' || items.length > 1) return 'MULTIPLE';
  return 'SIMPLE';
}

const resultOf = (value: string | undefined): VisibleResultDraft =>
  value === 'WON' || value === 'LOST' || value === 'VOID' || value === 'PENDING' ? value : '';

/**
 * Construye las filas a partir de lo que leyó la IA (§5, Fase 10.7), con la misma estructura
 * `eventGroup`/`position` que usa el formulario manual para que el tipo resultante sea el
 * correcto. Cada entrada de la extracción es un LEG; sus `conditions` son sus filas, y la cuota
 * del leg va solo en la primera. Mercado y pronóstico se conservan separados, tal como los leyó la
 * IA. Ningún campo ausente se inventa.
 */
export function draftsFromExtraction(
  betType: string | undefined,
  items: readonly TicketExtractionSelection[],
): SelectionDraft[] {
  if (items.length === 0) return [newSelection(0, 0)];
  const format = formatFromExtraction(betType, items);

  const legRows = (item: TicketExtractionSelection, group: number): SelectionDraft[] => {
    const base = {
      sport: item.sport ?? DEFAULT_SPORT,
      event: item.event ?? '',
    };
    const conditions = item.conditions ?? [];
    if (conditions.length === 0) {
      return [
        {
          ...newSelection(group, 0),
          ...base,
          market: item.market ?? '',
          selection: item.selection ?? '',
          visibleOdds: item.visibleOdds ?? '',
          legScore: item.legScore ?? '',
          legResult: resultOf(item.legResult),
        },
      ];
    }
    return conditions.map((condition, position) => ({
      ...newSelection(group, position),
      ...base,
      market: condition.market ?? '',
      selection: condition.selection ?? '',
      conditionStatus: resultOf(condition.conditionStatus),
      // Los datos del leg viven en la fila principal.
      ...(position === 0
        ? {
            visibleOdds: item.visibleOdds ?? '',
            legScore: item.legScore ?? '',
            legResult: resultOf(item.legResult),
          }
        : {}),
    }));
  };

  if (format === 'CREATED') {
    if (items.length === 1 && (items[0]!.conditions?.length ?? 0) > 0) {
      return legRows(items[0]!, 0);
    }
    // Forma anterior: una entrada por condición, todas del mismo partido.
    const first = items[0]!;
    return items.map((item, index) => ({
      ...newSelection(0, index),
      sport: item.sport ?? first.sport ?? DEFAULT_SPORT,
      event: first.event ?? '',
      market: item.market ?? '',
      selection: item.selection ?? '',
      visibleOdds: item.visibleOdds ?? '',
      conditionStatus: resultOf(undefined),
    }));
  }
  return items.flatMap((item, index) => legRows(item, index));
}
