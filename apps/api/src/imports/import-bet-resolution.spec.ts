import { describe, expect, it } from 'vitest';
import { resolveImportBets, type ImportStagingRow } from './import-bet-resolution.js';
import type { ImportRowNormalizedBet, ImportStagePlan } from './import-types.js';

const bet = (overrides: Partial<ImportRowNormalizedBet> = {}): ImportRowNormalizedBet => ({
  declaredType: 'Simple',
  derivedType: 'SIMPLE',
  typeMismatch: false,
  amount: '62.50',
  visibleTotalOdds: '1.75',
  status: 'WON',
  placedAt: '2024-10-22T17:00:00.000Z',
  placedTimeKnown: false,
  settledAt: '2024-10-22T17:00:00.000Z',
  settledTimeKnown: false,
  selections: [
    { eventGroup: 0, position: 0, event: 'A vs. B', selection: 'A gana', visibleOdds: null },
  ],
  ...overrides,
});

const plan = (): ImportStagePlan => ({
  stages: [
    {
      key: 'r1',
      name: 'Ronda 1',
      unitStake: '12.50',
      startsAt: null,
      status: 'CLOSED',
      firstRow: 11,
      lastRow: 15,
    },
    {
      key: 'r2',
      name: 'Ronda 2',
      unitStake: '25.00',
      startsAt: null,
      status: 'ACTIVE',
      firstRow: 16,
      lastRow: 20,
    },
  ],
});

/**
 * Fase 9.3.5 (§113.3, D-X7, D-X19): resolución de `stageKey`/`stake` a partir del plan de etapas
 * ya confirmado y las filas de staging ya persistidas. Función pura, sin PostgreSQL.
 */
describe('resolveImportBets', () => {
  it('resuelve stageKey por el rango de filas de cada etapa del plan', () => {
    const rows: ImportStagingRow[] = [
      { rowNumber: 11, bet: bet({ amount: '62.50' }) },
      { rowNumber: 16, bet: bet({ amount: '50.00' }) },
    ];
    const result = resolveImportBets(rows, plan());

    expect(result.bets).toHaveLength(2);
    expect(result.bets[0]).toMatchObject({ rowNumber: 11, stageKey: 'r1' });
    expect(result.bets[1]).toMatchObject({ rowNumber: 16, stageKey: 'r2' });
    expect(result.unresolvedRows).toEqual([]);
  });

  it('calcula el stake como monto ÷ unidad de esa etapa, sin múltiplo exacto avisa sin bloquear', () => {
    const rows: ImportStagingRow[] = [
      { rowNumber: 11, bet: bet({ amount: '25.00' }) }, // 25.00 / 12.50 = 2 exacto
      { rowNumber: 12, bet: bet({ amount: '10.00' }) }, // 10.00 / 12.50 = 0.8, no exacto
    ];
    const result = resolveImportBets(rows, plan());

    expect(result.bets[0]).toMatchObject({ stake: '2.0000' });
    expect(result.bets[1]).toMatchObject({ stake: '0.8000' });
    expect(result.inexactStakeRows).toEqual([12]);
    // No exacto avisa, pero la apuesta se sigue construyendo (D-X19: nunca bloquea).
    expect(result.bets).toHaveLength(2);
  });

  it('una fila que ningún rango del plan cubre queda en unresolvedRows, no se pierde en silencio', () => {
    const rows: ImportStagingRow[] = [
      { rowNumber: 11, bet: bet() },
      { rowNumber: 25, bet: bet() }, // fuera de ambos rangos (11-15, 16-20)
    ];
    const result = resolveImportBets(rows, plan());

    expect(result.unresolvedRows).toEqual([25]);
    expect(result.bets).toHaveLength(1);
    expect(result.bets[0]!.rowNumber).toBe(11);
  });

  it('construye el NormalizedImportBet final con todos los campos de la apuesta preliminar', () => {
    const rows: ImportStagingRow[] = [
      {
        rowNumber: 11,
        bet: bet({
          amount: '25.00',
          visibleTotalOdds: '1.90',
          status: 'PENDING',
          settledAt: null,
          settledTimeKnown: true,
          placedTimeKnown: false,
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'C vs. D',
              selection: 'C gana',
              visibleOdds: null,
            },
          ],
        }),
      },
    ];
    const result = resolveImportBets(rows, plan());

    expect(result.bets[0]).toEqual({
      rowNumber: 11,
      stageKey: 'r1',
      stake: '2.0000',
      amount: '25.00',
      visibleTotalOdds: '1.90',
      status: 'PENDING',
      placedAt: new Date('2024-10-22T17:00:00.000Z'),
      placedTimeKnown: false,
      settledAt: null,
      settledTimeKnown: true,
      selections: [
        { eventGroup: 0, position: 0, event: 'C vs. D', selection: 'C gana', visibleOdds: null },
      ],
    });
  });

  it('sin ninguna fila, devuelve listas vacías sin lanzar nada', () => {
    expect(resolveImportBets([], plan())).toEqual({
      bets: [],
      unresolvedRows: [],
      inexactStakeRows: [],
    });
  });

  it('con rangos solapados (un plan que no debería llegar aquí ya validado), toma la primera etapa que cubre la fila', () => {
    const overlapping: ImportStagePlan = {
      stages: [
        {
          key: 'r1',
          name: 'Ronda 1',
          unitStake: '10.00',
          startsAt: null,
          status: 'CLOSED',
          firstRow: 11,
          lastRow: 15,
        },
        {
          key: 'r2',
          name: 'Ronda 2',
          unitStake: '20.00',
          startsAt: null,
          status: 'CLOSED',
          firstRow: 13,
          lastRow: 18,
        },
      ],
    };
    const result = resolveImportBets([{ rowNumber: 13, bet: bet() }], overlapping);
    expect(result.bets[0]!.stageKey).toBe('r1');
  });
});
