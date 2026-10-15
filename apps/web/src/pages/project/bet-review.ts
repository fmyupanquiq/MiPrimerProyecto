import {
  addMoney,
  calculateBetReturn,
  compareMoney,
  multiplyMoney,
  subtractMoney,
  type BetSelectionSummary,
  type BetStatus,
  type BetType,
  type CreateBetInput,
  type MoneyString,
} from '@letfer/shared';
import { groupBetLegs, type BetLeg } from './bet-legs.js';

/*
 * Revisión final del asistente "Añadir apuesta" (Paso 3 "Confirmar", ADR 0024, corrección
 * 2026-10-15). Todo sale del MISMO payload ya validado que se enviará a `betsApi.create`: lo que se
 * ve es exactamente lo que se registra. Las cifras usan las reglas de la API (§76, §77): el monto es
 * el oficial o `stake × unidad`; el retorno potencial, el oficial o `monto × cuota`; el realizado
 * de un alta liquidada, el oficial o el que la API calcularía. La API vuelve a calcular y validar
 * todo al registrar: esto es solo una vista previa, nunca una segunda fuente de verdad.
 */

export interface BetReview {
  payload: CreateBetInput;
  /** Simple/Creada/Múltiple derivado de la estructura, como lo hace la API (§90). */
  betType: BetType;
  legs: BetLeg[];
  status: BetStatus;
  amount: MoneyString;
  amountOfficial: boolean;
  potentialReturn: MoneyString;
  potentialOfficial: boolean;
  /** Retorno realizado de un alta ya liquidada; `null` si queda pendiente. */
  realizedReturn: MoneyString | null;
  realizedOfficial: boolean;
  /** Ganancia (+) o pérdida (−) de un alta liquidada; `null` si queda pendiente. */
  profit: MoneyString | null;
}

/** Igual que `deriveBetType` de la API: un leg con una fila es Simple; con varias, Creada. */
export function betTypeOfSelections(selections: readonly { eventGroup: number }[]): BetType {
  const groups = new Set(selections.map((s) => s.eventGroup));
  if (groups.size === 1) return selections.length === 1 ? 'SIMPLE' : 'CREATED';
  return 'MULTIPLE';
}

export function buildBetReview(payload: CreateBetInput, unitStake: MoneyString): BetReview {
  const betType = betTypeOfSelections(payload.selections);
  const rows: BetSelectionSummary[] = payload.selections.map((row) => ({
    id: `${row.eventGroup}-${row.position}`,
    eventGroup: row.eventGroup,
    position: row.position,
    sport: row.sport ?? null,
    event: row.event,
    market: row.market ?? null,
    selection: row.selection,
    // La cuota es del leg (fila 0): una condición interna nunca lleva cuota propia.
    visibleOdds: row.position === 0 ? (row.visibleOdds ?? null) : null,
    legScore: row.position === 0 ? (row.legScore ?? null) : null,
    legResult: row.position === 0 ? (row.legResult ?? null) : null,
    conditionStatus: row.conditionStatus ?? null,
  }));
  const amount = payload.officialAmount ?? multiplyMoney(unitStake, payload.stake);
  const potentialReturn =
    payload.officialPotentialReturn ?? calculateBetReturn(amount, payload.visibleTotalOdds);
  const settlement = payload.settlement;
  const official = settlement?.officialRealizedReturn;
  let realizedReturn: MoneyString | null = null;
  if (settlement) {
    switch (settlement.status) {
      case 'LOST':
        realizedReturn = '0.00';
        break;
      case 'VOID':
        realizedReturn = official ?? amount;
        break;
      case 'WON':
        realizedReturn = official ?? calculateBetReturn(amount, payload.visibleTotalOdds);
        break;
      case 'CASHOUT':
        realizedReturn = official ?? null;
        break;
    }
  }
  return {
    payload,
    betType,
    legs: groupBetLegs(rows, betType, payload.visibleTotalOdds),
    status: settlement?.status ?? 'PENDING',
    amount,
    amountOfficial: payload.officialAmount !== undefined,
    potentialReturn,
    potentialOfficial: payload.officialPotentialReturn !== undefined,
    realizedReturn,
    realizedOfficial: official !== undefined || settlement?.status === 'VOID',
    profit: realizedReturn === null ? null : subtractMoney(realizedReturn, amount),
  };
}

/**
 * Efecto del registro sobre el disponible de la casa: una pendiente reserva el monto; una ya
 * liquidada mueve además su retorno. `insufficient` si el disponible no alcanza para el monto
 * (la API lo rechazaría: nunca un saldo negativo).
 */
export function reviewImpact(
  review: BetReview,
  available: MoneyString,
): { availableAfter: MoneyString; insufficient: boolean } {
  const afterPlacement = subtractMoney(available, review.amount);
  return {
    availableAfter:
      review.realizedReturn === null
        ? afterPlacement
        : addMoney(afterPlacement, review.realizedReturn),
    insufficient: compareMoney(available, review.amount) < 0,
  };
}

/** Mismo payload salvo la clave de idempotencia (que cambia entre intentos sin cambiar la apuesta). */
export function samePayload(a: CreateBetInput, b: CreateBetInput): boolean {
  const strip = (input: CreateBetInput) => JSON.stringify({ ...input, clientRequestId: null });
  return strip(a) === strip(b);
}
