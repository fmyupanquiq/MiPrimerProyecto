import {
  addMoney,
  calculateBetReturn,
  deriveEffectiveOdds,
  isMoneyString,
  isOddsString,
  isPositiveMoney,
  isPositiveOdds,
  isStakeString,
  multiplyMoney,
  subtractMoney,
  type MoneyString,
} from '@letfer/shared';

/** Resultado elegido al registrar: `PENDING` o uno de los estados de liquidación (Fase 10.3). */
export type DraftStatus = 'PENDING' | 'WON' | 'LOST' | 'VOID' | 'CASHOUT';

export interface BetDraftInput {
  stake: string;
  /** Unidad de la etapa en la que se registrará (la activa); `null` si no hay etapa activa. */
  unitStake: MoneyString | null;
  officialAmount: string;
  visibleTotalOdds: string;
  status: DraftStatus;
  /** Ganancia escrita a mano para coincidir con la casa; vacía = la calculada. */
  profitOverride: string;
}

export interface BetDraftFigures {
  /** Monto de la apuesta: el oficial si se indicó; si no, `stake × unidad` (§76). */
  amount: MoneyString | null;
  /** Retorno (apuesta + ganancia, "A+G"); `null` mientras está pendiente o falta un dato. */
  returnValue: MoneyString | null;
  profit: MoneyString | null;
  /** El retorno que se enviará como oficial: solo cuando la persona ajustó la ganancia. */
  officialRealizedReturn: MoneyString | undefined;
  /** Cuota efectiva (retorno ÷ monto) cuando la ganancia se ajustó: diagnóstica, no sustituye a la visible (regla 6). */
  effectiveOdds: string | null;
  /** La ganancia escrita no es una cifra válida (hasta 2 decimales). */
  profitOverrideInvalid: boolean;
}

/**
 * ¿Admite este resultado escribir la ganancia? Solo la ganada (para coincidir con la casa) y el cash
 * out (no se puede calcular). Una perdida no tiene retorno (D-B2) y una anulada devuelve el monto
 * sin ganancia (§21.4): en ambas la ganancia es fija.
 */
export const allowsProfitOverride = (status: DraftStatus) =>
  status === 'WON' || status === 'CASHOUT';

/**
 * Cifras que el formulario muestra antes de registrar. No decide nada: combina las mismas
 * funciones de `@letfer/shared` que usa la API (`multiplyMoney` para el monto,
 * `calculateBetReturn` para el retorno calculado, D-B8), y la API vuelve a calcular y validar
 * todo al registrar. Ajustar la ganancia fija el **retorno oficial** (monto + ganancia, §77); la
 * cuota visible nunca cambia (regla crítica 6).
 */
export function betDraftFigures(input: BetDraftInput): BetDraftFigures {
  const official = input.officialAmount.trim();
  const stake = input.stake.trim();
  const amount: MoneyString | null =
    isMoneyString(official) && isPositiveMoney(official)
      ? official
      : input.unitStake !== null && isStakeString(stake)
        ? multiplyMoney(input.unitStake, stake)
        : null;

  const empty = {
    amount,
    returnValue: null,
    profit: null,
    officialRealizedReturn: undefined,
    effectiveOdds: null,
    profitOverrideInvalid: false,
  };
  if (amount === null || input.status === 'PENDING') return empty;

  if (input.status === 'LOST') {
    return { ...empty, returnValue: '0.00', profit: subtractMoney('0.00', amount) };
  }

  // Anulada: se devuelve el monto, sin ganancia; nunca admite una ganancia escrita.
  if (input.status === 'VOID') return { ...empty, returnValue: amount, profit: '0.00' };

  const override = input.profitOverride.trim();
  if (override !== '') {
    if (!isMoneyString(override)) return { ...empty, profitOverrideInvalid: true };
    const returnValue = addMoney(amount, override);
    return {
      ...empty,
      returnValue,
      profit: subtractMoney(returnValue, amount),
      officialRealizedReturn: returnValue,
      effectiveOdds: deriveEffectiveOdds(returnValue, amount),
    };
  }

  const odds = input.visibleTotalOdds.trim();
  const returnValue: MoneyString | null =
    input.status === 'WON' && isOddsString(odds) && isPositiveOdds(odds)
      ? calculateBetReturn(amount, odds)
      : null; // un cash out no se puede calcular: hay que indicar la ganancia
  return {
    ...empty,
    returnValue,
    profit: returnValue === null ? null : subtractMoney(returnValue, amount),
  };
}
