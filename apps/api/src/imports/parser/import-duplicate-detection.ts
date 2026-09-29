import type { MoneyString, OddsString } from '@letfer/shared';
import { calendarDateInTimeZone } from '../../common/timezone.js';
import type { NormalizedImportSelection } from '../import-types.js';
import type { PreliminaryNormalizedBet } from './import-normalization.js';

/**
 * Duplicados por contenido (Fase 9.3.9, D-X10, §113.6): "misma casa, misma fecha, mismo monto,
 * misma cuota, misma descripción/partido normalizada". Nunca descarta ni fusiona nada — solo
 * agrupa y reporta, para que una persona decida (D-X11, principio rector). Se mantiene separado
 * del semáforo estructural de D-X17b y del financiero de §113.7 (mismo criterio que los mantiene
 * a ellos dos separados entre sí): es una tercera señal independiente.
 *
 * La "descripción/partido" se compara por las **selecciones ya normalizadas** (evento, mercado,
 * selección), no por el texto crudo de la celda: es más robusto a diferencias de formato (dobles
 * espacios, mayúsculas) que comparar la cadena original, y ya es el dato que el resto del pipeline
 * usa como la interpretación canónica de "qué partido y qué se jugó" — no hace falta releer nada.
 */

export interface ImportDuplicateMatch {
  /** Filas del archivo actual involucradas en este grupo (2 o más). */
  rowNumbers: number[];
  /** Apuestas ya importadas con las que coincide, si el solapamiento es contra el histórico. */
  existingBetIds: string[];
  date: string;
  amount: MoneyString;
  odds: OddsString;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Sin ceros de más a la derecha: la cuota de una apuesta recién leída del Excel llega como
 * `"1.75"`, pero la misma cuota, releída de `bets.visible_total_odds` (`NUMERIC(12,6)`), vuelve
 * como `"1.750000"` — ambas representan el mismo número, y D-X10 debe verlas como la misma cuota.
 */
function canonicalOdds(value: OddsString): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/** Firma de "qué partido y qué se jugó", insensible al orden de las selecciones (multi). */
export function selectionsSignature(
  selections: readonly Pick<NormalizedImportSelection, 'event' | 'market' | 'selection'>[],
): string {
  return selections
    .map(
      (s) =>
        `${normalizeText(s.event)}|${normalizeText(s.market ?? '')}|${normalizeText(s.selection)}`,
    )
    .sort()
    .join(';');
}

/** Clave de comparación D-X10 (sin la casa: eso ya lo fija el archivo, o la consulta en el histórico). */
export function duplicateKey(bet: {
  placedAt: Date;
  amount: MoneyString;
  visibleTotalOdds: OddsString;
  selections: readonly Pick<NormalizedImportSelection, 'event' | 'market' | 'selection'>[];
  timeZone: string;
}): string {
  const date = calendarDateInTimeZone(bet.placedAt, bet.timeZone);
  return `${date}|${bet.amount}|${canonicalOdds(bet.visibleTotalOdds)}|${selectionsSignature(bet.selections)}`;
}

/**
 * Agrupa las apuestas preliminares del archivo por la clave D-X10; devuelve solo los grupos con
 * más de una fila (los duplicados de verdad). Función pura: no lee ni escribe nada.
 */
export function detectWithinFileDuplicates(
  bets: readonly PreliminaryNormalizedBet[],
  timeZone: string,
): ImportDuplicateMatch[] {
  const groups = new Map<
    string,
    { rowNumbers: number[]; date: string; amount: MoneyString; odds: OddsString }
  >();
  for (const bet of bets) {
    if (bet.rowNumber === undefined) continue;
    const date = calendarDateInTimeZone(bet.placedAt, timeZone);
    const key = duplicateKey({ ...bet, timeZone });
    const group = groups.get(key);
    if (group) group.rowNumbers.push(bet.rowNumber);
    else
      groups.set(key, {
        rowNumbers: [bet.rowNumber],
        date,
        amount: bet.amount,
        odds: bet.visibleTotalOdds,
      });
  }
  return [...groups.values()]
    .filter((group) => group.rowNumbers.length > 1)
    .map((group) => ({
      rowNumbers: group.rowNumbers,
      existingBetIds: [],
      date: group.date,
      amount: group.amount,
      odds: group.odds,
    }));
}
