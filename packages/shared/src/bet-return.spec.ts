import { describe, expect, it } from 'vitest';
import { RETURN_ROUNDING_POLICY, calculateBetReturn } from './bet-return.js';

/**
 * Tabla de casos del retorno calculado (§77). La política de redondeo es provisional (D-B8): si
 * tickets reales demuestran que la casa trunca, se cambia la función y esta tabla, no el resto.
 */
describe('calculateBetReturn (§77, D-B8 provisional)', () => {
  it('declara la política vigente', () => {
    expect(RETURN_ROUNDING_POLICY).toBe('ROUND_HALF_UP');
  });

  const cases: [amount: string, odds: string, expected: string][] = [
    ['20.00', '1.95', '39.00'],
    ['20.00', '1.5', '30.00'],
    ['10.00', '2.345', '23.45'], // 23.450 exacto
    ['10.00', '2.3455', '23.46'], // 23.455 → mitad hacia arriba
    ['10.00', '2.3454', '23.45'],
    ['33.33', '1.91', '63.66'], // 63.6603 → hacia abajo
    ['0.01', '1.5', '0.02'], // 0.015 → hacia arriba
    ['100.00', '1.000001', '100.00'],
    ['1234.56', '15.750000', '19444.32'],
  ];
  it.each(cases)('monto %s × cuota %s = %s', (amount, odds, expected) => {
    expect(calculateBetReturn(amount, odds)).toBe(expected);
  });

  it('no usa coma flotante binaria', () => {
    // 0.1 × 3 en binario da 0.30000000000000004; aquí es exactamente 0.30.
    expect(calculateBetReturn('0.10', '3')).toBe('0.30');
  });
});
