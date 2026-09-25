import { multiplyMoney, type MoneyString } from './money.js';
import type { OddsString } from './odds.js';

/**
 * Política de redondeo del retorno calculado (§77, D-B8). **Provisional**: `ROUND_HALF_UP` a dos
 * decimales (ADR 0004) hasta que tickets reales de Betano y Betsafe confirmen si la casa redondea o
 * trunca. Cambiarla es tocar solo esta función: el retorno calculado se guarda al liquidar, así que
 * un cambio futuro no reescribe la historia, y `ReturnDifferencesReport` aporta la evidencia.
 */
export const RETURN_ROUNDING_POLICY = 'ROUND_HALF_UP' as const;

/**
 * Retorno calculado no confirmado de una apuesta ganada (§77):
 * `monto oficial o confirmado × cuota visible total`. Único punto de cálculo de retornos.
 */
export function calculateBetReturn(amount: MoneyString, visibleTotalOdds: OddsString): MoneyString {
  return multiplyMoney(amount, visibleTotalOdds);
}
