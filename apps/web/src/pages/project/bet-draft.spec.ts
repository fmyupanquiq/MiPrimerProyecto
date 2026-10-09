import { formatOdds } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { allowsProfitOverride, betDraftFigures, type BetDraftInput } from './bet-draft.js';

const draft = (overrides: Partial<BetDraftInput> = {}): BetDraftInput => ({
  stake: '2',
  unitStake: '10.00',
  officialAmount: '',
  visibleTotalOdds: '1.95',
  status: 'PENDING',
  profitOverride: '',
  ...overrides,
});

describe('betDraftFigures (Fase 10.3: cifras del formulario, con las funciones de @letfer/shared)', () => {
  it('apuesta = stake × unidad de la etapa; pendiente: sin retorno ni ganancia', () => {
    expect(betDraftFigures(draft())).toMatchObject({
      amount: '20.00',
      returnValue: null,
      profit: null,
      officialRealizedReturn: undefined,
    });
    expect(betDraftFigures(draft({ stake: '2.5' })).amount).toBe('25.00');
  });

  it('el monto oficial, si se indica, manda sobre el calculado (§76)', () => {
    expect(betDraftFigures(draft({ officialAmount: '21.50' })).amount).toBe('21.50');
  });

  it('sin stake válido o sin etapa activa no hay monto', () => {
    expect(betDraftFigures(draft({ stake: 'abc' })).amount).toBeNull();
    expect(betDraftFigures(draft({ stake: '0' })).amount).toBeNull();
    expect(betDraftFigures(draft({ unitStake: null })).amount).toBeNull();
  });

  it('ganada: retorno calculado = monto × cuota visible y ganancia = retorno − monto', () => {
    expect(betDraftFigures(draft({ status: 'WON' }))).toMatchObject({
      returnValue: '39.00',
      profit: '19.00',
      officialRealizedReturn: undefined, // sin ajuste, la API guarda el retorno calculado
      effectiveOdds: null,
    });
  });

  it('ganada sin cuota válida todavía: sin retorno', () => {
    expect(betDraftFigures(draft({ status: 'WON', visibleTotalOdds: '' })).returnValue).toBeNull();
  });

  it('perdida: retorno 0 y ganancia = −monto; no admite ajustar la ganancia', () => {
    expect(betDraftFigures(draft({ status: 'LOST' }))).toMatchObject({
      returnValue: '0.00',
      profit: '-20.00',
      officialRealizedReturn: undefined,
    });
    expect(allowsProfitOverride('LOST')).toBe(false);
    expect(allowsProfitOverride('PENDING')).toBe(false);
  });

  it('anulada: el retorno es el monto y la ganancia 0, fija aunque llegue una ganancia escrita', () => {
    expect(betDraftFigures(draft({ status: 'VOID' }))).toMatchObject({
      returnValue: '20.00',
      profit: '0.00',
      officialRealizedReturn: undefined,
    });
    expect(allowsProfitOverride('VOID')).toBe(false);
    expect(betDraftFigures(draft({ status: 'VOID', profitOverride: '5.00' }))).toMatchObject({
      returnValue: '20.00',
      profit: '0.00',
      officialRealizedReturn: undefined,
      effectiveOdds: null,
    });
  });

  it('cash out: no se puede calcular; con la ganancia indicada, el retorno oficial es monto + ganancia', () => {
    expect(betDraftFigures(draft({ status: 'CASHOUT' })).returnValue).toBeNull();
    expect(betDraftFigures(draft({ status: 'CASHOUT', profitOverride: '-5.00' }))).toMatchObject({
      returnValue: '15.00',
      profit: '-5.00',
      officialRealizedReturn: '15.00',
    });
  });

  it('ganancia ajustada a la casa: fija el retorno oficial; la cuota visible no cambia y la efectiva es diagnóstica', () => {
    const figures = betDraftFigures(
      draft({ status: 'WON', profitOverride: '19.50', visibleTotalOdds: '1.95' }),
    );
    expect(figures).toMatchObject({
      returnValue: '39.50',
      profit: '19.50',
      officialRealizedReturn: '39.50',
      effectiveOdds: '1.975', // 39.50 ÷ 20.00
    });
  });

  it('la cuota efectiva calculada conserva su precisión completa: el formatter visual (§7-§8, Fase 10.9) es un paso aparte, nunca sustituye el valor usado en el cálculo', () => {
    const figures = betDraftFigures(
      draft({ status: 'WON', profitOverride: '19.50', visibleTotalOdds: '1.95' }),
    );
    // `effectiveOdds` sigue con sus 3 decimales reales (1.975), no los 2 que usaría la interfaz
    // para mostrarla — formatearla para presentación es decisión de quien la muestra, no de aquí.
    expect(figures.effectiveOdds).toBe('1.975');
    expect(formatOdds(figures.effectiveOdds!)).toBe('1.98');
    expect(formatOdds(figures.effectiveOdds!)).not.toBe(figures.effectiveOdds);
  });

  it('una ganancia mal escrita se marca inválida y no inventa un retorno', () => {
    expect(betDraftFigures(draft({ status: 'WON', profitOverride: '19.555' }))).toMatchObject({
      profitOverrideInvalid: true,
      returnValue: null,
      officialRealizedReturn: undefined,
    });
  });
});
