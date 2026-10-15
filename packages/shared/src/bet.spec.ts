import { describe, expect, it } from 'vitest';
import {
  betHeadline,
  createBetSchema,
  isStakeString,
  moveBetStageSchema,
  confirmBetReturnSchema,
  correctSettlementSchema,
  reopenBetSchema,
  restoreBetSchema,
  settleBetSchema,
  trashBetSchema,
  updateBetSchema,
} from './bet.js';

const validSelection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};

const validBet = {
  houseId: '0195f7c0-0000-7000-8000-0000000000a1',
  stake: '1.5',
  visibleTotalOdds: '1.95',
  placedAt: '2026-06-01T20:00:00.000Z',
  selections: [validSelection],
};

describe('isStakeString (regla crítica 1: multiplicador, nunca porcentaje)', () => {
  it('acepta un decimal positivo con hasta 4 decimales', () => {
    for (const value of ['1', '1.5', '0.25', '10.1234'])
      expect(isStakeString(value), value).toBe(true);
  });

  it('rechaza cero, negativos y más de 4 decimales', () => {
    for (const value of ['0', '-1', '1.23456']) expect(isStakeString(value), value).toBe(false);
  });
});

describe('createBetSchema', () => {
  it('acepta una apuesta simple válida', () => {
    const result = createBetSchema.safeParse(validBet);
    expect(result.success).toBe(true);
  });

  it('exige al menos una selección', () => {
    const result = createBetSchema.safeParse({ ...validBet, selections: [] });
    expect(result.success).toBe(false);
  });

  it('placedTimeKnown por defecto es true', () => {
    const result = createBetSchema.parse(validBet);
    expect(result.placedTimeKnown).toBe(true);
  });

  it('stageId es opcional (se usa la etapa activa, §93)', () => {
    expect(createBetSchema.safeParse(validBet).success).toBe(true);
  });

  it('rechaza un monto oficial no positivo', () => {
    const result = createBetSchema.safeParse({ ...validBet, officialAmount: '0.00' });
    expect(result.success).toBe(false);
  });

  // Fase 10.6: una Creada puede mostrar varias selecciones con solo la cuota total (§90). El
  // esquema admite que falte `visibleOdds`; qué tipos la exigen de verdad lo decide la API
  // (`BetsService.assertSelectionOddsRequired`, según `betType` derivado de la estructura real).
  describe('visibleOdds de una selección (Fase 10.6, Creada sin cuotas individuales)', () => {
    it('la cuota individual es opcional: puede faltar sin invalidar la apuesta', () => {
      const withoutOdds = {
        eventGroup: validSelection.eventGroup,
        position: validSelection.position,
        event: validSelection.event,
        selection: validSelection.selection,
      };
      const result = createBetSchema.safeParse({ ...validBet, selections: [withoutOdds] });
      expect(result.success).toBe(true);
      expect(result.success && result.data.selections[0]!.visibleOdds).toBeUndefined();
    });

    it('si se indica, sigue debiendo ser una cuota válida (no se acepta cualquier texto)', () => {
      const result = createBetSchema.safeParse({
        ...validBet,
        selections: [{ ...validSelection, visibleOdds: 'no es una cuota' }],
      });
      expect(result.success).toBe(false);
    });

    it('una cadena vacía no equivale a "ausente": sigue siendo inválida', () => {
      const result = createBetSchema.safeParse({
        ...validBet,
        selections: [{ ...validSelection, visibleOdds: '' }],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('updateBetSchema', () => {
  it('todos los campos son opcionales salvo version', () => {
    const result = updateBetSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });

  it('exige version', () => {
    expect(updateBetSchema.safeParse({ reason: 'Nota' }).success).toBe(false);
  });
});

describe('settleBetSchema (§21, §78, D-B2)', () => {
  const base = { settledAt: '2026-06-02T22:00:00.000Z', version: 1 };

  it('LOST no admite officialRealizedReturn', () => {
    expect(
      settleBetSchema.safeParse({ ...base, status: 'LOST', officialRealizedReturn: '50.00' })
        .success,
    ).toBe(false);
    expect(settleBetSchema.safeParse({ ...base, status: 'LOST' }).success).toBe(true);
  });

  it('solo el cash out exige officialRealizedReturn; WON y VOID lo admiten opcional (§112.2, D-A3)', () => {
    expect(settleBetSchema.safeParse({ ...base, status: 'CASHOUT' }).success).toBe(false);
    for (const status of ['WON', 'VOID', 'CASHOUT'] as const) {
      expect(
        settleBetSchema.safeParse({ ...base, status, officialRealizedReturn: '50.00' }).success,
      ).toBe(true);
    }
    // Sin retorno oficial: una ganada queda con retorno calculado y una anulada, con el monto.
    for (const status of ['WON', 'VOID'] as const) {
      expect(settleBetSchema.safeParse({ ...base, status }).success).toBe(true);
    }
  });

  it('confirmBetReturnSchema exige un retorno positivo y una versión', () => {
    const ok = { officialRealizedReturn: '38.50', version: 2 };
    expect(confirmBetReturnSchema.parse(ok)).toMatchObject({ acknowledgeDifference: false });
    expect(
      confirmBetReturnSchema.safeParse({ ...ok, officialRealizedReturn: '0.00' }).success,
    ).toBe(false);
    expect(confirmBetReturnSchema.safeParse({ ...ok, acknowledgeDifference: 'sí' }).success).toBe(
      false,
    );
    expect(confirmBetReturnSchema.safeParse({ officialRealizedReturn: '38.50' }).success).toBe(
      false,
    );
  });

  it('settledTimeKnown por defecto es true', () => {
    const result = settleBetSchema.parse({ ...base, status: 'LOST' });
    expect(result.settledTimeKnown).toBe(true);
  });
});

describe('moveBetStageSchema', () => {
  it('exige stageId y version', () => {
    expect(
      moveBetStageSchema.safeParse({
        stageId: '0195f7c0-0000-7000-8000-0000000000e1',
        version: 1,
      }).success,
    ).toBe(true);
    expect(moveBetStageSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});

describe('trashBetSchema', () => {
  it('el motivo es opcional', () => {
    expect(trashBetSchema.safeParse({}).success).toBe(true);
    expect(trashBetSchema.safeParse({ reason: 'Duplicada' }).success).toBe(true);
  });
});

describe('correctSettlementSchema (§112.3, D-A8)', () => {
  const base = { reason: 'Se liquidó por error', version: 3 };

  it('exige motivo, versión y al menos un cambio', () => {
    expect(correctSettlementSchema.safeParse({ ...base, status: 'LOST' }).success).toBe(true);
    expect(correctSettlementSchema.safeParse({ ...base }).success).toBe(false);
    expect(correctSettlementSchema.safeParse({ status: 'LOST', version: 3 }).success).toBe(false);
    expect(
      correctSettlementSchema.safeParse({ ...base, reason: '   ', status: 'LOST' }).success,
    ).toBe(false);
    expect(correctSettlementSchema.safeParse({ reason: 'x', status: 'LOST' }).success).toBe(false);
  });

  it('acepta cada campo corregible por separado y no el retorno en una perdida', () => {
    for (const change of [
      { officialAmount: '25.00' },
      { officialRealizedReturn: '41.00' },
      { settledAt: '2026-06-01T14:00:00.000Z' },
      { placedAt: '2026-06-01T13:00:00.000Z' },
      { placedTimeKnown: false },
      { settledTimeKnown: false },
    ]) {
      expect(correctSettlementSchema.safeParse({ ...base, ...change }).success).toBe(true);
    }
    expect(
      correctSettlementSchema.safeParse({ ...base, status: 'LOST', officialRealizedReturn: '5.00' })
        .success,
    ).toBe(false);
    expect(correctSettlementSchema.safeParse({ ...base, officialAmount: '0.00' }).success).toBe(
      false,
    );
  });

  it('reabrir exige motivo; restaurar admite un cuerpo vacío', () => {
    expect(reopenBetSchema.safeParse({ reason: 'Error', version: 2 }).success).toBe(true);
    expect(reopenBetSchema.safeParse({ reason: '  ', version: 2 }).success).toBe(false);
    expect(reopenBetSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(restoreBetSchema.parse(undefined)).toEqual({});
    expect(restoreBetSchema.parse({ reason: ' Era correcta ' })).toEqual({
      reason: 'Era correcta',
    });
  });
});

describe('betHeadline (§108.10)', () => {
  const row = (eventGroup: number, position: number, market: string | null, selection: string) => ({
    eventGroup,
    position,
    market,
    selection,
  });

  it('Simple: mercado y pronóstico de su única selección', () => {
    expect(betHeadline('SIMPLE', [row(0, 0, '1X2', 'Real Madrid')])).toEqual({
      market: '1X2',
      selection: 'Real Madrid',
    });
  });

  it('sin mercado indicado, el mercado queda vacío (no se inventa)', () => {
    expect(betHeadline('SIMPLE', [row(0, 0, null, 'Real Madrid')])).toEqual({
      market: '',
      selection: 'Real Madrid',
    });
  });

  it('Creada de un solo evento: «Creada» y la cantidad de pronósticos', () => {
    expect(
      betHeadline('CREATED', [row(0, 0, '1X2', 'Real Madrid'), row(0, 1, 'Goles', 'Más de 2.5')]),
    ).toEqual({ market: 'Creada', selection: '2 pronósticos' });
  });

  it('Múltiple (o varios legs, o sin selecciones): sin titular', () => {
    expect(betHeadline('MULTIPLE', [row(0, 0, '1X2', 'A'), row(1, 0, '1X2', 'B')])).toBeNull();
    expect(betHeadline('MULTIPLE', [row(0, 0, '1X2', 'A')])).toBeNull();
    expect(betHeadline('SIMPLE', [row(0, 0, '1X2', 'A'), row(1, 0, '1X2', 'B')])).toBeNull();
    expect(betHeadline('SIMPLE', [])).toBeNull();
  });
});
