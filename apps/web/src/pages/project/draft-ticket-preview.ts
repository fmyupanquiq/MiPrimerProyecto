import {
  formatOdds,
  multiplyOdds,
  type BetSelectionSummary,
  type BetType,
  type TotalOddsSource,
} from '@letfer/shared';
import { groupBetLegs, type BetLeg } from './bet-legs.js';
import type { SelectionDraft } from './bet-selection-drafts.js';

/*
 * Vista previa del ticket de LetFer a partir del borrador (paso Confirmar). Solo reorganiza lo que
 * la persona tiene en el formulario con la MISMA función que usa "Ver apuesta" (`groupBetLegs`):
 * no calcula nada financiero ni inventa campos. Lo que está vacío queda vacío.
 */

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export function draftPreviewLegs(
  selections: readonly SelectionDraft[],
  format: BetType,
  totalOdds: string,
): BetLeg[] {
  const rows: BetSelectionSummary[] = selections.map((row) => ({
    id: String(row.key),
    eventGroup: row.eventGroup,
    position: row.position,
    sport: orNull(row.sport),
    event: row.event.trim() || '(sin partido)',
    market: orNull(row.market),
    selection: row.selection.trim() || '(sin pronóstico)',
    // Solo el leg (position 0) lleva cuota; una condición interna nunca.
    visibleOdds: row.position === 0 ? orNull(row.visibleOdds) : null,
    legScore: row.position === 0 ? orNull(row.legScore) : null,
    legResult: row.position === 0 ? row.legResult || null : null,
    conditionStatus: row.conditionStatus || null,
  }));
  return groupBetLegs(rows, format, totalOdds.trim());
}

/** Problemas de estructura del borrador (selecciones incompletas, legs sin cuota en una Múltiple). */
export function draftStructureIssues(
  selections: readonly SelectionDraft[],
  format: BetType,
): string[] {
  const issues: string[] = [];
  const incomplete = selections.filter(
    (row) => row.event.trim() === '' || row.selection.trim() === '',
  ).length;
  if (incomplete > 0) {
    issues.push(
      incomplete === 1
        ? '1 selección sin partido o pronóstico.'
        : `${incomplete} selecciones sin partido o pronóstico.`,
    );
  }
  const legsWithoutOdds = selections.filter(
    (row) => row.position === 0 && row.visibleOdds.trim() === '',
  ).length;
  if (format === 'MULTIPLE' && legsWithoutOdds > 0) {
    issues.push(legsWithoutOdds === 1 ? '1 leg sin cuota.' : `${legsWithoutOdds} legs sin cuota.`);
  }
  return issues;
}

/** Avisos de revisión previos a guardar: solo describen lo que falta o es ambiguo, no bloquean. */
export function draftReviewWarnings(input: {
  houseChosen: boolean;
  selections: readonly SelectionDraft[];
  format: BetType;
  totalOdds: string;
  amount: string | null;
  /** Múltiple/Creada con cuota total sin declarar si es oficial o calculada. */
  totalOddsSourceMissing?: boolean;
}): string[] {
  const warnings: string[] = [];
  if (!input.houseChosen) warnings.push('Falta elegir la casa de apuestas.');
  if (input.amount === null) warnings.push('Falta el importe apostado (stake o monto oficial).');
  warnings.push(...draftStructureIssues(input.selections, input.format));
  if (input.format !== 'SIMPLE' && input.totalOdds.trim() === '') {
    warnings.push(
      'No hay cuota total: indícala. Si el ticket no la muestra, el producto de las cuotas de los legs es solo una referencia, no una cuota oficial.',
    );
  }
  if (input.totalOddsSourceMissing && input.totalOdds.trim() !== '') {
    warnings.push(
      'Indica si la cuota total es oficial (la muestra la casa) o una referencia calculada.',
    );
  }
  return warnings;
}

/**
 * Producto de las cuotas de los legs de una Múltiple, SOLO si todos los legs tienen la suya (con una
 * sola faltante sería un número menor al verdadero: inventar). Se redondea a 2 decimales como la
 * cuota que ofrece el prellenado de IA. Es una referencia calculada, nunca la cuota oficial.
 */
export function legOddsProduct(
  selections: readonly SelectionDraft[],
  format: BetType,
): string | null {
  if (format !== 'MULTIPLE') return null;
  const legOdds = selections
    .filter((row) => row.position === 0)
    .map((row) => row.visibleOdds.trim());
  if (legOdds.length < 2 || legOdds.some((odds) => odds === '')) return null;
  const product = multiplyOdds(legOdds);
  return product === null || legOdds.some((odds) => multiplyOdds([odds]) === null)
    ? null
    : formatOdds(product);
}

/**
 * Procedencia con que se registrará la cuota total (ADR 0023). `null` = falta que la persona lo
 * declare: en una Múltiple/Creada nunca se supone que una cifra tecleada es la oficial de la casa.
 */
export function resolveTotalOddsSource(input: {
  format: BetType;
  /** El valor del campo coincide con la cuota que LetFer calculó. */
  isCalculated: boolean;
  choice: Exclude<TotalOddsSource, 'UNKNOWN'> | null;
}): Exclude<TotalOddsSource, 'UNKNOWN'> | null {
  if (input.isCalculated) return 'CALCULATED';
  if (input.format === 'SIMPLE') return 'OFFICIAL';
  return input.choice;
}
