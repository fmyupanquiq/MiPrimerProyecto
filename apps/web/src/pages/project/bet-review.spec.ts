import type { CreateBetInput } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { betTypeOfSelections, buildBetReview, reviewImpact, samePayload } from './bet-review.js';

const HOUSE = '0195f7c0-0000-7000-8000-0000000000a1';

/** Múltiple de 3 con un leg creado (2 condiciones) en medio: la cuota del leg va solo en la fila 0. */
const multipleWithCreated = (overrides: Partial<CreateBetInput> = {}): CreateBetInput => ({
  houseId: HOUSE,
  stake: '5',
  visibleTotalOdds: '6.00',
  totalOddsSource: 'OFFICIAL',
  clientRequestId: '0195f7c0-0000-7000-8000-00000000aaaa',
  placedAt: '2026-10-10T20:05:00.000Z',
  placedTimeKnown: true,
  selections: [
    { eventGroup: 0, position: 0, event: 'A - B', selection: '1', visibleOdds: '2.00' },
    { eventGroup: 1, position: 0, event: 'C - D', selection: 'D', visibleOdds: '1.50' },
    { eventGroup: 1, position: 1, event: 'C - D', selection: 'Más de 2.5 córners' },
    { eventGroup: 2, position: 0, event: 'E - F', selection: 'E', visibleOdds: '2.00' },
  ],
  ...overrides,
});

describe('buildBetReview (revisión del Paso 3, desde el payload validado)', () => {
  it('deriva el tipo como la API y conserva la estructura: la Creada es un leg con su cuota una vez', () => {
    const review = buildBetReview(multipleWithCreated(), '2.00');
    expect(review.betType).toBe('MULTIPLE');
    expect(review.legs).toHaveLength(3);
    const created = review.legs[1]!;
    expect(created.grouped).toBe(true);
    expect(created.selections).toHaveLength(2);
    expect(created.odds).toBe('1.50');
    // Las condiciones internas no llevan cuota propia.
    expect(created.selections[1]!.visibleOdds).toBeNull();
  });

  it('pendiente: monto stake × unidad y retorno potencial calculado, sin realizado', () => {
    const review = buildBetReview(multipleWithCreated(), '2.00');
    expect(review).toMatchObject({
      status: 'PENDING',
      amount: '10.00',
      amountOfficial: false,
      potentialReturn: '60.00',
      potentialOfficial: false,
      realizedReturn: null,
      profit: null,
    });
  });

  it('monto y retorno potencial oficiales mandan sobre los calculados', () => {
    const review = buildBetReview(
      multipleWithCreated({ officialAmount: '9.50', officialPotentialReturn: '57.00' }),
      '2.00',
    );
    expect(review).toMatchObject({
      amount: '9.50',
      amountOfficial: true,
      potentialReturn: '57.00',
      potentialOfficial: true,
    });
  });

  it('liquidada al registrar: perdida, ganada (calculada u oficial), anulada y cash out', () => {
    const settledAt = '2026-10-10T22:00:00.000Z';
    const at = (settlement: CreateBetInput['settlement']) =>
      buildBetReview(multipleWithCreated({ settlement }), '2.00');
    expect(at({ status: 'LOST', settledAt, settledTimeKnown: true })).toMatchObject({
      realizedReturn: '0.00',
      profit: '-10.00',
    });
    expect(at({ status: 'WON', settledAt, settledTimeKnown: true })).toMatchObject({
      realizedReturn: '60.00',
      realizedOfficial: false,
      profit: '50.00',
    });
    expect(
      at({ status: 'WON', settledAt, settledTimeKnown: true, officialRealizedReturn: '58.00' }),
    ).toMatchObject({ realizedReturn: '58.00', realizedOfficial: true, profit: '48.00' });
    expect(at({ status: 'VOID', settledAt, settledTimeKnown: true })).toMatchObject({
      realizedReturn: '10.00',
      profit: '0.00',
    });
    expect(
      at({ status: 'CASHOUT', settledAt, settledTimeKnown: true, officialRealizedReturn: '12.00' }),
    ).toMatchObject({ realizedReturn: '12.00', profit: '2.00' });
  });

  it('Simple y Creada se derivan de la estructura', () => {
    expect(betTypeOfSelections([{ eventGroup: 0 }])).toBe('SIMPLE');
    expect(betTypeOfSelections([{ eventGroup: 0 }, { eventGroup: 0 }])).toBe('CREATED');
    expect(betTypeOfSelections([{ eventGroup: 0 }, { eventGroup: 1 }])).toBe('MULTIPLE');
  });
});

describe('reviewImpact', () => {
  it('pendiente: compromete el monto; liquidada: suma además el retorno; avisa si no alcanza', () => {
    const pending = buildBetReview(multipleWithCreated(), '2.00');
    expect(reviewImpact(pending, '100.00')).toEqual({
      availableAfter: '90.00',
      insufficient: false,
    });
    expect(reviewImpact(pending, '5.00').insufficient).toBe(true);
    const won = buildBetReview(
      multipleWithCreated({
        settlement: {
          status: 'WON',
          settledAt: '2026-10-10T22:00:00.000Z',
          settledTimeKnown: true,
        },
      }),
      '2.00',
    );
    expect(reviewImpact(won, '100.00').availableAfter).toBe('150.00');
  });
});

describe('samePayload', () => {
  it('ignora solo la clave de idempotencia', () => {
    const a = multipleWithCreated();
    expect(samePayload(a, { ...a, clientRequestId: '0195f7c0-0000-7000-8000-00000000bbbb' })).toBe(
      true,
    );
    expect(samePayload(a, { ...a, stake: '6' })).toBe(false);
  });
});
