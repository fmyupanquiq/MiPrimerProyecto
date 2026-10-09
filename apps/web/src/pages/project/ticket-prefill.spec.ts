import type { TicketExtractionSelection } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import {
  collectCompleteIndividualOdds,
  composeForecastText,
  deriveStakeFromAmount,
} from './ticket-prefill.js';

const QUICK_STAKES = [10, 20, 30, 40, 50] as const;

describe('composeForecastText (Fase 10.8, §1: mercado + selección = Pronóstico)', () => {
  it('combina mercado y selección, mercado primero', () => {
    expect(composeForecastText('Hándicap Resultado del Partido', 'Inglaterra -1')).toBe(
      'Hándicap Resultado del Partido Inglaterra -1',
    );
    expect(composeForecastText('Doble oportunidad', 'Real Madrid o Empate')).toBe(
      'Doble oportunidad Real Madrid o Empate',
    );
    expect(composeForecastText('Goles totales Más/Menos', 'Más de 1.5')).toBe(
      'Goles totales Más/Menos Más de 1.5',
    );
  });

  it('sin mercado, solo la selección (no inventa texto)', () => {
    expect(composeForecastText(undefined, 'España')).toBe('España');
    expect(composeForecastText('', 'España')).toBe('España');
  });

  it('sin selección, solo el mercado', () => {
    expect(composeForecastText('Resultado del partido', undefined)).toBe('Resultado del partido');
  });

  it('sin ninguno de los dos, cadena vacía', () => {
    expect(composeForecastText(undefined, undefined)).toBe('');
  });
});

describe('deriveStakeFromAmount (Fase 10.8, §3-§5: el importe del ticket determina el stake)', () => {
  it('importe 10.72, unidad 2 → stake 5.36, no es un atajo (nunca se redondea a 5)', () => {
    expect(deriveStakeFromAmount('10.72', '2.00', QUICK_STAKES)).toEqual({
      stake: '5.36',
      isPreset: false,
    });
  });

  it('importe 60, unidad 2 → stake 30, coincide con el atajo 30', () => {
    expect(deriveStakeFromAmount('60.00', '2.00', QUICK_STAKES)).toEqual({
      stake: '30',
      isPreset: true,
    });
  });

  it('importe 50, unidad 5 → stake 10, coincide con el atajo 10', () => {
    expect(deriveStakeFromAmount('50.00', '5.00', QUICK_STAKES)).toEqual({
      stake: '10',
      isPreset: true,
    });
  });

  it('importe 10.75, unidad 2 → stake 5.375, no es un atajo (nunca se aproxima a 5.4)', () => {
    expect(deriveStakeFromAmount('10.75', '2.00', QUICK_STAKES)).toEqual({
      stake: '5.375',
      isPreset: false,
    });
  });

  it('importe = unidad → stake 1 (no se omite ni se redondea)', () => {
    expect(deriveStakeFromAmount('2.00', '2.00', QUICK_STAKES)).toEqual({
      stake: '1',
      isPreset: false,
    });
  });

  it('importe 2.17, unidad 2 → stake 1.085: el importe manda, nunca la cuota (§5-§6)', () => {
    // 2.17 "parece" una cuota, pero aquí es el IMPORTE: el resultado debe ser 2.17 ÷ 2, nunca
    // confundirse con una cuota de 2.17 (que daría, por error, 1 u otra cifra distinta).
    expect(deriveStakeFromAmount('2.17', '2.00', QUICK_STAKES)).toEqual({
      stake: '1.085',
      isPreset: false,
    });
  });

  it('un importe o unidad inválidos no revientan: devuelven null', () => {
    expect(deriveStakeFromAmount('abc', '2.00', QUICK_STAKES)).toBeNull();
  });
});

const selection = (visibleOdds?: string): TicketExtractionSelection => ({
  event: 'A vs B',
  selection: 'A',
  visibleOdds,
});

describe('collectCompleteIndividualOdds (Fase 10.9, §2-§4: referencia solo si TODAS tienen cuota)', () => {
  it('con las 5 cuotas (ticket real de Betano, Combinada de 5, Perdida)', () => {
    expect(
      collectCompleteIndividualOdds([
        selection('1.31'),
        selection('1.42'),
        selection('1.29'),
        selection('1.30'),
        selection('1.53'),
      ]),
    ).toEqual(['1.31', '1.42', '1.29', '1.30', '1.53']);
  });

  it('con 3 cuotas, todas presentes', () => {
    expect(
      collectCompleteIndividualOdds([selection('1.5'), selection('2'), selection('1.1')]),
    ).toEqual(['1.5', '2', '1.1']);
  });

  it('si falta la cuota de una sola selección, no inventa nada: undefined', () => {
    expect(
      collectCompleteIndividualOdds([selection('1.31'), selection(undefined), selection('1.29')]),
    ).toBeUndefined();
  });

  it('sin selecciones, undefined', () => {
    expect(collectCompleteIndividualOdds([])).toBeUndefined();
    expect(collectCompleteIndividualOdds(undefined)).toBeUndefined();
  });
});
