import type { BetType } from './bet.js';

/*
 * Estructura de una apuesta (§114): TICKET → LEGS → CONDICIONES.
 *
 *   - LEG = `eventGroup`. Una Simple tiene 1 leg de 1 fila; una Creada independiente, 1 leg de
 *     varias filas; una Múltiple, 2 o más legs, y cualquiera de ellos puede ser un leg creado
 *     (varias filas = Bet Builder / Same Game Parlay dentro de la Múltiple).
 *   - Condición interna = cada fila del grupo, ordenada por `position` (0, 1, 2…).
 *   - La cuota de un LEG se guarda UNA vez, en la fila `position = 0`. Las condiciones internas
 *     (`position > 0`) de un leg creado no tienen cuota propia: nunca se copia ni se reparte.
 *
 * Funciones puras compartidas por la API (validación al registrar/editar) y la web (formulario y
 * vista de detalle), para que ambas apliquen exactamente la misma regla.
 */

export interface StructureRow {
  eventGroup: number;
  position: number;
  event: string;
  sport?: string | null;
  visibleOdds?: string | null;
  legScore?: string | null;
  legResult?: string | null;
}

/** Agrupa las filas por leg (ordenadas por `eventGroup` y, dentro, por `position`). */
export function groupByLeg<T extends { eventGroup: number; position: number }>(
  rows: readonly T[],
): T[][] {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const list = groups.get(row.eventGroup) ?? [];
    list.push(row);
    groups.set(row.eventGroup, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, list]) => [...list].sort((a, b) => a.position - b.position));
}

const has = (value: string | null | undefined): boolean =>
  value !== undefined && value !== null && value !== '';

/**
 * Valida la estructura de las selecciones que se van a persistir. Devuelve el primer problema
 * (mensaje legible para la persona) o `null` si es válida. Las apuestas de un lote de importación
 * no pasan por aquí (el historial importado no conserva las cuotas, §113.5).
 *
 * Reglas:
 *   - Las posiciones de cada leg son exactamente 0, 1, 2… sin huecos ni repetidas.
 *   - Todas las filas de un leg son del mismo partido.
 *   - Marcador y resultado del leg solo en la fila `position = 0`.
 *   - Cuotas: Simple, la de su única fila; Creada independiente, opcionales (la cuota total basta);
 *     Múltiple, la del LEG (fila `position = 0`) obligatoria en cada leg; las condiciones internas
 *     (`position > 0`) pueden ir sin cuota.
 */
export function validateSelectionStructure(
  rows: readonly StructureRow[],
  betType: BetType,
): string | null {
  const legs = groupByLeg(rows);
  for (const leg of legs) {
    for (let index = 0; index < leg.length; index++) {
      if (leg[index]!.position !== index) {
        return 'Las selecciones de un mismo partido deben numerarse 0, 1, 2… sin repetir ni saltar posiciones.';
      }
    }
    const event = leg[0]!.event.trim();
    if (leg.some((row) => row.event.trim() !== event)) {
      return 'Las selecciones internas de un leg deben ser del mismo partido.';
    }
    if (leg.some((row, index) => index > 0 && (has(row.legScore) || has(row.legResult)))) {
      return 'El marcador y el resultado del leg solo se indican una vez, en la primera selección.';
    }
  }

  if (betType === 'CREATED') return null;
  for (const leg of legs) {
    if (!has(leg[0]!.visibleOdds)) {
      return betType === 'MULTIPLE'
        ? 'Cada leg de una Múltiple necesita su cuota (la de la primera selección del leg).'
        : 'La selección de una Simple necesita su cuota.';
    }
  }
  return null;
}

/** Cuotas de los LEGS (una por leg, la de su fila `position = 0`), en orden. */
export function legOdds(rows: readonly StructureRow[]): (string | null)[] {
  return groupByLeg(rows).map((leg) => (has(leg[0]!.visibleOdds) ? leg[0]!.visibleOdds! : null));
}
