import type { BetSelectionSummary, BetType, VisibleResult } from '@letfer/shared';

/*
 * Estructura de lectura de una apuesta registrada: LEG = `eventGroup`; selección interna = cada
 * fila de ese grupo (`position`). Solo reorganiza lo que ya devuelve `BetDetail`: no deduce ni
 * inventa nada (p. ej. no parte textos de `selection`) y nunca reparte una cuota entre filas.
 */

export interface BetLeg {
  /** Número del leg (1, 2, 3…), por orden de `eventGroup`. */
  number: number;
  eventGroup: number;
  /** Varias selecciones en el mismo leg (una Creada), o una sola (una Simple). */
  grouped: boolean;
  /** Partido del leg (el de su primera selección). */
  event: string;
  selections: BetSelectionSummary[];
  /** Marcador visible del evento (documental), de la fila principal del leg. */
  score: string | null;
  /** Resultado individual visible del leg (documental); nunca liquida nada. */
  result: VisibleResult | null;
  /**
   * La cuota del leg, mostrada una sola vez: la de la única selección; la única cuota distinta
   * que comparten las filas de un leg agrupado; o, en una apuesta sin cuotas individuales que no
   * es Múltiple, la cuota total de la apuesta. `null` si no consta. Si las filas de un leg
   * agrupado traen cuotas distintas entre sí, no hay una del leg: cada selección muestra la suya.
   */
  odds: string | null;
  /** Las filas de un leg agrupado tienen cuotas propias distintas: se muestran por selección. */
  ownOdds: boolean;
}

export function groupBetLegs(
  selections: readonly BetSelectionSummary[],
  betType: BetType,
  totalOdds: string,
): BetLeg[] {
  const groups = new Map<number, BetSelectionSummary[]>();
  for (const selection of selections) {
    const list = groups.get(selection.eventGroup) ?? [];
    list.push(selection);
    groups.set(selection.eventGroup, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([eventGroup, rows], index) => {
      const sorted = [...rows].sort((a, b) => a.position - b.position);
      const distinct = [
        ...new Set(sorted.map((s) => s.visibleOdds).filter((o): o is string => o !== null)),
      ];
      let odds: string | null = distinct.length === 1 ? distinct[0]! : null;
      // Sin cuotas individuales, la cuota total solo es "la del leg" cuando la apuesta entera es
      // ese único leg (Creada, o Simple importada): en una Múltiple no es de ningún leg.
      if (odds === null && distinct.length === 0 && betType !== 'MULTIPLE') odds = totalOdds;
      return {
        number: index + 1,
        eventGroup,
        grouped: sorted.length > 1,
        event: sorted[0]!.event,
        selections: sorted,
        score: sorted[0]!.legScore,
        result: sorted[0]!.legResult,
        odds,
        ownOdds: sorted.length > 1 && distinct.length > 1,
      };
    });
}
