import { stakeFromAmount } from '@letfer/shared';
import type {
  ImportRowNormalizedBet,
  ImportStagePlan,
  NormalizedImportBet,
} from './import-types.js';

/**
 * Resolutor de `stageKey`/`stake` (Fase 9.3.5, §113.3, D-X7, D-X19, ADR 0020,
 * docs/PLAN_FASE_9_3.md §3): la única pieza de cálculo de negocio genuinamente nueva de toda la
 * Fase 9.3. Dado el plan de etapas ya confirmado por una persona (9.3.4, con su rango de filas por
 * etapa) y las filas de staging ya persistidas (9.3.3, con su apuesta preliminar), calcula a qué
 * etapa pertenece cada fila y su stake (`monto ÷ unidad de esa etapa`), y construye el
 * `NormalizedImportBet` final — listo para `ImportBatchWriteInput.bets` (9.1.5).
 *
 * Función pura: no lee ni escribe nada, no crea ninguna etapa real ni ninguna apuesta. Asume que
 * `plan` ya pasó `validateImportStagePlan` (9.3.4): no lo vuelve a validar aquí (claves únicas,
 * rangos sin solaparse, como máximo una `ACTIVE`); si de todos modos llegara un plan con rangos
 * solapados, una fila de la zona solapada resuelve contra la primera etapa que la cubre, en el
 * orden en que aparece en `plan.stages`.
 */

export interface ImportStagingRow {
  rowNumber: number;
  bet: ImportRowNormalizedBet;
}

export interface ImportBetResolutionResult {
  bets: NormalizedImportBet[];
  /**
   * Filas `VALID` que ningún rango del plan cubre (D-X21: nada se pierde en silencio). Quien
   * confirme la importación (9.3.7) decide si esto bloquea o no; este resolutor solo lo hace
   * explícito, nunca omite la fila en silencio ni le inventa una etapa.
   */
  unresolvedRows: number[];
  /** Avisa (D-X19), nunca bloquea: el monto no es múltiplo exacto de la unidad de su etapa. */
  inexactStakeRows: number[];
}

/** La etapa del plan cuyo rango de filas cubre `rowNumber`, o `undefined` si ninguna lo cubre. */
function stageFor(plan: ImportStagePlan, rowNumber: number) {
  return plan.stages.find((stage) => rowNumber >= stage.firstRow && rowNumber <= stage.lastRow);
}

/**
 * Resuelve `stageKey` y `stake` de cada fila de staging contra el plan de etapas confirmado, y
 * construye el `NormalizedImportBet` final de cada una que sí resolvió.
 */
export function resolveImportBets(
  rows: readonly ImportStagingRow[],
  plan: ImportStagePlan,
): ImportBetResolutionResult {
  const bets: NormalizedImportBet[] = [];
  const unresolvedRows: number[] = [];
  const inexactStakeRows: number[] = [];

  for (const { rowNumber, bet } of rows) {
    const stage = stageFor(plan, rowNumber);
    if (!stage) {
      unresolvedRows.push(rowNumber);
      continue;
    }

    const { stake, exact } = stakeFromAmount(bet.amount, stage.unitStake);
    if (!exact) inexactStakeRows.push(rowNumber);

    bets.push({
      rowNumber,
      stageKey: stage.key,
      stake,
      amount: bet.amount,
      visibleTotalOdds: bet.visibleTotalOdds,
      status: bet.status,
      placedAt: new Date(bet.placedAt),
      placedTimeKnown: bet.placedTimeKnown,
      settledAt: bet.settledAt ? new Date(bet.settledAt) : null,
      settledTimeKnown: bet.settledTimeKnown,
      selections: bet.selections,
    });
  }

  return { bets, unresolvedRows, inexactStakeRows };
}
