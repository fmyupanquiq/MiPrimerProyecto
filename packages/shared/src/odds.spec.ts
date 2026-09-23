import { describe, expect, it } from 'vitest';
import { deriveEffectiveOdds, formatOdds, isOddsString, oddsInputSchema } from './odds.js';

describe('isOddsString', () => {
  it('acepta enteros y hasta 6 decimales, siempre positivos', () => {
    for (const value of ['1', '1.95', '1.9548', '2.000001', '100']) {
      expect(isOddsString(value), value).toBe(true);
    }
  });

  it('rechaza negativos, más de 6 decimales, notación científica y no numérico', () => {
    for (const value of ['-1.95', '1.95000001', '1e5', '', 'abc', '1,95']) {
      expect(isOddsString(value), value).toBe(false);
    }
  });
});

describe('oddsInputSchema', () => {
  const schema = oddsInputSchema();

  it('acepta una cuota válida sin transformarla (regla crítica 5: sin redondeo destructivo)', () => {
    expect(schema.parse('1.9548')).toBe('1.9548');
    expect(schema.parse(' 1.95 ')).toBe('1.95');
  });

  it('rechaza cero y negativos', () => {
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('-1.5').success).toBe(false);
  });

  it('rechaza más de 6 decimales en vez de truncar', () => {
    expect(schema.safeParse('1.12345678').success).toBe(false);
  });
});

describe('deriveEffectiveOdds (§22, §77)', () => {
  it('retorno ÷ monto efectivo', () => {
    expect(deriveEffectiveOdds('195.48', '100.00')).toBe('1.9548');
  });

  it('null sin retorno positivo (pendiente o perdida) o sin monto efectivo positivo', () => {
    expect(deriveEffectiveOdds('0.00', '100.00')).toBeNull();
    expect(deriveEffectiveOdds('195.48', '0.00')).toBeNull();
  });
});

describe('formatOdds', () => {
  it('presenta con 2 decimales por defecto, sin alterar el valor almacenado', () => {
    expect(formatOdds('1.9548')).toBe('1.95');
    expect(formatOdds('1.9548', 4)).toBe('1.9548');
  });
});
