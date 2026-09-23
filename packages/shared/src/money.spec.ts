import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatPEN,
  isMoneyString,
  isNegativeMoney,
  isPositiveMoney,
  isZeroMoney,
  moneyInputSchema,
  multiplyMoney,
  percentageOf,
  roundMoney,
  subtractMoney,
  sumMoney,
  ZERO_MONEY,
} from './money.js';

describe('isMoneyString', () => {
  it('acepta enteros y hasta 2 decimales, con signo opcional', () => {
    for (const value of ['0', '0.00', '195.5', '195.48', '-10', '-10.50', '1000000']) {
      expect(isMoneyString(value), value).toBe(true);
    }
  });

  it('rechaza más de 2 decimales, notación científica, vacío y no numérico', () => {
    for (const value of ['195.489', '1e5', '', 'abc', '1.2.3', ' 10', '10 ', '10,50']) {
      expect(isMoneyString(value), value).toBe(false);
    }
  });
});

describe('roundMoney (ROUND_HALF_UP, ADR 0004)', () => {
  it('redondea al alza exactamente en el punto medio', () => {
    expect(roundMoney('1.005')).toBe('1.01');
    expect(roundMoney('1.015')).toBe('1.02');
    expect(roundMoney('-1.005')).toBe('-1.01'); // half-up: se aleja de cero, no "hacia arriba" numérico
  });

  it('no toca un valor que ya tiene 2 decimales o menos', () => {
    expect(roundMoney('195.48')).toBe('195.48');
    expect(roundMoney('10')).toBe('10.00');
    expect(roundMoney('0')).toBe(ZERO_MONEY);
  });

  it('rechaza una cadena que no es dinero', () => {
    expect(() => roundMoney('no-es-dinero')).toThrow();
  });
});

describe('addMoney / sumMoney', () => {
  it('suma exactamente, sin errores de coma flotante', () => {
    // 0.1 + 0.2 en number da 0.30000000000000004; aquí debe dar exactamente 0.30.
    expect(addMoney('0.10', '0.20')).toBe('0.30');
  });

  it('sin argumentos da cero', () => {
    expect(addMoney()).toBe(ZERO_MONEY);
  });

  it('suma muchas filas (simula reconstruir un saldo desde el ledger)', () => {
    const movements = ['100.00', '-25.50', '10.00', '-5.25', '0.75'];
    expect(sumMoney(movements)).toBe('80.00');
  });
});

describe('subtractMoney', () => {
  it('resta y puede dar negativo (el servicio decide si es un error)', () => {
    expect(subtractMoney('100.00', '30.00')).toBe('70.00');
    expect(subtractMoney('30.00', '100.00')).toBe('-70.00');
  });
});

describe('multiplyMoney (monto teórico de una apuesta: stake × unidad, §12, §76)', () => {
  it('multiplica y redondea a 2 decimales', () => {
    expect(multiplyMoney('10.00', '1.5')).toBe('15.00');
    expect(multiplyMoney('10.00', '0.25')).toBe('2.50');
  });

  it('redondea ROUND_HALF_UP el resultado, no los factores', () => {
    expect(multiplyMoney('10.00', '1.005')).toBe('10.05'); // 10.05 exacto
    expect(multiplyMoney('3.33', '3')).toBe('9.99');
  });
});

describe('compareMoney', () => {
  it('compara con normalización (10 === 10.00)', () => {
    expect(compareMoney('10', '10.00')).toBe(0);
    expect(compareMoney('9.99', '10.00')).toBe(-1);
    expect(compareMoney('10.01', '10.00')).toBe(1);
  });
});

describe('isZeroMoney / isPositiveMoney / isNegativeMoney', () => {
  it('clasifica correctamente', () => {
    expect(isZeroMoney('0.00')).toBe(true);
    expect(isZeroMoney('0')).toBe(true);
    expect(isPositiveMoney('0.01')).toBe(true);
    expect(isPositiveMoney('0.00')).toBe(false);
    expect(isNegativeMoney('-0.01')).toBe(true);
    expect(isNegativeMoney('0.00')).toBe(false);
  });
});

describe('moneyInputSchema', () => {
  it('por defecto exige >= 0 y no redondea en silencio (rechaza 3+ decimales)', () => {
    const schema = moneyInputSchema();
    expect(schema.safeParse('100.00').success).toBe(true);
    expect(schema.safeParse('0').success).toBe(true);
    expect(schema.safeParse('-1').success).toBe(false);
    expect(schema.safeParse('100.005').success).toBe(false);
  });

  it('normaliza "100" a "100.00" y recorta espacios', () => {
    const schema = moneyInputSchema();
    expect(schema.parse('100')).toBe('100.00');
    expect(schema.parse('  50.5  ')).toBe('50.50');
  });

  it('con positive: true, cero también se rechaza', () => {
    const schema = moneyInputSchema({ positive: true });
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('0.01').success).toBe(true);
  });
});

describe('percentageOf (Yield, ROI, drawdown %, §108.1, §108.4)', () => {
  it('numerator ÷ denominator × 100, redondeado a 2 decimales', () => {
    expect(percentageOf('19.00', '100.00')).toBe('19.00');
    expect(percentageOf('1.00', '3.00')).toBe('33.33');
  });

  it('puede dar negativo (una pérdida)', () => {
    expect(percentageOf('-25.00', '100.00')).toBe('-25.00');
  });

  it('null cuando el denominador es cero (razón indefinida, no 0%)', () => {
    expect(percentageOf('50.00', '0.00')).toBeNull();
    expect(percentageOf('0.00', '0.00')).toBeNull();
  });
});

describe('formatPEN', () => {
  it('formatea con el prefijo S/ y separador de miles', () => {
    expect(formatPEN('1234.5')).toBe('S/ 1,234.50');
    expect(formatPEN('0.00')).toBe('S/ 0.00');
  });
});
