import type { BetSelectionSummary } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { groupBetLegs } from './bet-legs.js';

let id = 0;
const row = (overrides: Partial<BetSelectionSummary> = {}): BetSelectionSummary => ({
  id: `s${id++}`,
  eventGroup: 0,
  position: 0,
  sport: null,
  event: 'Evento',
  market: null,
  selection: 'Gana A',
  visibleOdds: '1.50',
  legScore: null,
  legResult: null,
  conditionStatus: null,
  ...overrides,
});

describe('groupBetLegs: LEG = eventGroup, selección interna = fila del grupo', () => {
  it('Simple: un leg con su cuota', () => {
    const legs = groupBetLegs([row()], 'SIMPLE', '1.50');
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ number: 1, grouped: false, odds: '1.50', ownOdds: false });
  });

  it('Múltiple de 4 con datos existentes: cuatro legs, cada uno con su cuota', () => {
    const legs = groupBetLegs(
      [
        row({ eventGroup: 0, event: 'A', visibleOdds: '2.15' }),
        row({ eventGroup: 1, event: 'B', visibleOdds: '2.47' }),
        row({ eventGroup: 2, event: 'C', visibleOdds: '1.21' }),
        row({ eventGroup: 3, event: 'D', visibleOdds: '1.31' }),
      ],
      'MULTIPLE',
      '8.42',
    );
    expect(legs.map((l) => [l.number, l.event, l.odds, l.grouped])).toEqual([
      [1, 'A', '2.15', false],
      [2, 'B', '2.47', false],
      [3, 'C', '1.21', false],
      [4, 'D', '1.31', false],
    ]);
  });

  it('un leg con dos selecciones (datos sintéticos) es UN leg: la cuota del leg aparece una vez', () => {
    const legs = groupBetLegs(
      [
        row({ eventGroup: 1, position: 1, selection: 'Más de 2.5', visibleOdds: '2.47' }),
        row({ eventGroup: 0, event: 'Otro', visibleOdds: '2.15' }),
        row({ eventGroup: 1, position: 0, selection: 'Manchester City', visibleOdds: '2.47' }),
      ],
      'MULTIPLE',
      '5.31',
    );
    expect(legs).toHaveLength(2);
    expect(legs[1]).toMatchObject({ number: 2, grouped: true, odds: '2.47', ownOdds: false });
    // Orden por posición dentro del leg.
    expect(legs[1]!.selections.map((s) => s.selection)).toEqual(['Manchester City', 'Más de 2.5']);
  });

  it('una cuota presente en una sola fila del leg es la del leg; la otra no inventa ninguna', () => {
    const [leg] = groupBetLegs(
      [
        row({ position: 0, visibleOdds: '2.47' }),
        row({ position: 1, selection: 'Más de 2.5', visibleOdds: null }),
      ],
      'MULTIPLE',
      '2.47',
    );
    expect(leg).toMatchObject({ grouped: true, odds: '2.47', ownOdds: false });
  });

  it('filas con cuotas distintas entre sí: no hay cuota del leg, cada una muestra la suya', () => {
    const [leg] = groupBetLegs(
      [row({ position: 0, visibleOdds: '1.20' }), row({ position: 1, visibleOdds: '1.90' })],
      'MULTIPLE',
      '2.28',
    );
    expect(leg).toMatchObject({ odds: null, ownOdds: true });
  });

  it('Creada sin cuotas individuales: la cuota total es la del único leg', () => {
    const [leg] = groupBetLegs(
      [
        row({ position: 0, visibleOdds: null }),
        row({ position: 1, selection: 'Ambos marcan', visibleOdds: null }),
      ],
      'CREATED',
      '3.42',
    );
    expect(leg).toMatchObject({ grouped: true, odds: '3.42' });
  });

  it('Múltiple importada sin cuotas: nunca se atribuye la cuota total a un leg', () => {
    const legs = groupBetLegs(
      [row({ eventGroup: 0, visibleOdds: null }), row({ eventGroup: 1, visibleOdds: null })],
      'MULTIPLE',
      '3.00',
    );
    expect(legs.map((l) => l.odds)).toEqual([null, null]);
  });
});
