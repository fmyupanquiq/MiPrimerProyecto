import { describe, expect, it } from 'vitest';
import { detectWithinFileDuplicates, selectionsSignature } from './import-duplicate-detection.js';
import type { PreliminaryNormalizedBet } from './import-normalization.js';

const TIME_ZONE = 'America/Lima';

const bet = (overrides: Partial<PreliminaryNormalizedBet> = {}): PreliminaryNormalizedBet => ({
  rowNumber: 11,
  amount: '25.00',
  visibleTotalOdds: '1.75',
  status: 'WON',
  placedAt: new Date('2024-10-22T17:00:00.000Z'), // 12:00 en America/Lima (D-X23)
  placedTimeKnown: false,
  settledAt: new Date('2024-10-22T17:00:00.000Z'),
  settledTimeKnown: false,
  selections: [
    {
      eventGroup: 0,
      position: 0,
      event: 'Real Madrid vs. Barcelona',
      selection: 'Gana Real Madrid',
      visibleOdds: null,
    },
  ],
  ...overrides,
});

/**
 * Fase 9.3.9 (D-X10, §113.6): duplicados por contenido dentro del mismo archivo. Función pura, sin
 * PostgreSQL. La mitad contra el histórico ya importado vive en `import-duplicate-history.ts`
 * (necesita base de datos) y se prueba aparte.
 */
describe('detectWithinFileDuplicates (D-X10)', () => {
  it('dos filas con misma fecha, monto, cuota y descripción forman un grupo duplicado', () => {
    const bets = [bet({ rowNumber: 11 }), bet({ rowNumber: 15 })];
    const result = detectWithinFileDuplicates(bets, TIME_ZONE);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rowNumbers: [11, 15],
      existingBetIds: [],
      date: '2024-10-22',
      amount: '25.00',
      odds: '1.75',
    });
  });

  it('no descarta ni fusiona nada: ambas filas se conservan en el informe, solo se reportan', () => {
    const bets = [
      bet({ rowNumber: 11 }),
      bet({ rowNumber: 15 }),
      bet({ rowNumber: 20, amount: '99.00' }),
    ];
    const result = detectWithinFileDuplicates(bets, TIME_ZONE);
    expect(result).toHaveLength(1); // la fila 20 (monto distinto) no entra en el grupo.
    expect(result[0]!.rowNumbers).toEqual([11, 15]);
  });

  it('distinta fecha, monto, cuota o descripción: no es duplicado', () => {
    const base = bet({ rowNumber: 11 });
    expect(
      detectWithinFileDuplicates([base, bet({ rowNumber: 12, amount: '30.00' })], TIME_ZONE),
    ).toEqual([]);
    expect(
      detectWithinFileDuplicates(
        [base, bet({ rowNumber: 12, visibleTotalOdds: '2.00' })],
        TIME_ZONE,
      ),
    ).toEqual([]);
    expect(
      detectWithinFileDuplicates(
        [base, bet({ rowNumber: 12, placedAt: new Date('2024-10-23T17:00:00.000Z') })],
        TIME_ZONE,
      ),
    ).toEqual([]);
    expect(
      detectWithinFileDuplicates(
        [
          base,
          bet({
            rowNumber: 12,
            selections: [
              {
                eventGroup: 0,
                position: 0,
                event: 'Otro partido',
                selection: 'Gana el otro',
                visibleOdds: null,
              },
            ],
          }),
        ],
        TIME_ZONE,
      ),
    ).toEqual([]);
  });

  it('la descripción se normaliza: mayúsculas y espacios de más no evitan detectar el duplicado', () => {
    const bets = [
      bet({ rowNumber: 11 }),
      bet({
        rowNumber: 12,
        selections: [
          {
            eventGroup: 0,
            position: 0,
            event: '  real madrid VS.   barcelona  ',
            selection: 'gana real madrid',
            visibleOdds: null,
          },
        ],
      }),
    ];
    expect(detectWithinFileDuplicates(bets, TIME_ZONE)).toHaveLength(1);
  });

  it('una apuesta múltiple: el orden de las selecciones no importa para detectar el duplicado', () => {
    const multi = (order: [string, string]): PreliminaryNormalizedBet =>
      bet({
        selections: order.map((event, i) => ({
          eventGroup: i,
          position: 0,
          event,
          selection: `Gana ${event}`,
          visibleOdds: null,
        })),
      });
    const bets = [
      multi(['A vs. B', 'C vs. D']),
      { ...multi(['C vs. D', 'A vs. B']), rowNumber: 12 },
    ];
    expect(detectWithinFileDuplicates(bets, TIME_ZONE)).toHaveLength(1);
  });

  it('sin ninguna apuesta, no hay nada que reportar', () => {
    expect(detectWithinFileDuplicates([], TIME_ZONE)).toEqual([]);
  });
});

describe('selectionsSignature', () => {
  it('es insensible al orden y a mayúsculas/espacios', () => {
    const a = selectionsSignature([
      { event: 'A vs. B', market: null, selection: 'Gana A' },
      { event: 'C vs. D', market: null, selection: 'Gana C' },
    ]);
    const b = selectionsSignature([
      { event: '  c VS.  d ', market: null, selection: 'gana c' },
      { event: 'a vs. b', market: null, selection: 'GANA A' },
    ]);
    expect(a).toBe(b);
  });
});
