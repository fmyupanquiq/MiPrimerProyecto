import { describe, expect, it } from 'vitest';
import {
  findTimelineConflicts,
  newTimelineConflicts,
  type TimelineEntry,
} from './bet-ledger-timeline.js';

const at = (iso: string) => new Date(`2026-06-${iso}:00.000Z`);
const credit = (id: string, when: string, houseId: string, amount: string): TimelineEntry => ({
  id,
  occurredAt: at(when),
  effects: [{ houseId, direction: 'CREDIT', amount }],
});
const debit = (id: string, when: string, houseId: string, amount: string): TimelineEntry => ({
  id,
  occurredAt: at(when),
  effects: [{ houseId, direction: 'DEBIT', amount }],
});

describe('findTimelineConflicts (§74, D-A5)', () => {
  it('una historia sin saldos negativos no tiene conflictos', () => {
    const entries = [
      credit('d', '01T10:00', 'A', '100.00'),
      debit('p', '02T10:00', 'A', '80.00'),
      credit('s', '03T10:00', 'A', '39.00'),
    ];
    expect(findTimelineConflicts(entries)).toEqual([]);
    expect(findTimelineConflicts([])).toEqual([]);
  });

  it('detecta el instante en que el saldo bruto queda negativo y qué filas lo provocan', () => {
    const entries = [
      credit('d', '01T10:00', 'A', '100.00'),
      debit('p', '02T10:00', 'A', '80.00'),
      debit('w', '03T10:00', 'A', '30.00'),
    ];
    expect(findTimelineConflicts(entries)).toEqual([
      {
        houseId: 'A',
        occurredAt: at('03T10:00'),
        balance: '-10.00',
        entryIds: ['w'],
      },
    ]);
  });

  it('no depende del orden en que llegan las filas', () => {
    const entries = [
      debit('w', '03T10:00', 'A', '30.00'),
      debit('p', '02T10:00', 'A', '80.00'),
      credit('d', '01T10:00', 'A', '100.00'),
    ];
    expect(findTimelineConflicts(entries).map((c) => c.balance)).toEqual(['-10.00']);
  });

  it('agrupa las filas del mismo instante: el orden dentro de un instante no tiene autoridad', () => {
    // Depósito y retiro a la vez: el saldo se evalúa después de ambos (§107.6).
    const entries = [debit('w', '01T10:00', 'A', '50.00'), credit('d', '01T10:00', 'A', '50.00')];
    expect(findTimelineConflicts(entries)).toEqual([]);
    // Pero si el neto del instante es negativo, sí es un conflicto.
    expect(
      findTimelineConflicts([debit('w', '01T10:00', 'A', '50.01'), ...entries.slice(1)]),
    ).toHaveLength(1);
  });

  it('cada casa tiene su propia línea de tiempo', () => {
    const entries = [
      credit('d', '01T10:00', 'A', '10.00'),
      debit('w', '02T10:00', 'B', '1.00'),
      debit('x', '03T10:00', 'A', '10.00'),
    ];
    expect(findTimelineConflicts(entries)).toEqual([
      { houseId: 'B', occurredAt: at('02T10:00'), balance: '-1.00', entryIds: ['w'] },
    ]);
  });

  it('una transferencia debita el origen y acredita el destino en el mismo instante', () => {
    const transfer: TimelineEntry = {
      id: 't',
      occurredAt: at('02T10:00'),
      effects: [
        { houseId: 'A', direction: 'DEBIT', amount: '60.00' },
        { houseId: 'B', direction: 'CREDIT', amount: '60.00' },
      ],
    };
    const entries = [credit('d', '01T10:00', 'A', '50.00'), transfer];
    const conflicts = findTimelineConflicts(entries);
    expect(conflicts).toEqual([
      { houseId: 'A', occurredAt: at('02T10:00'), balance: '-10.00', entryIds: ['t'] },
    ]);
  });

  it('informa cada instante negativo, en orden cronológico', () => {
    const entries = [debit('a', '02T10:00', 'A', '5.00'), debit('b', '03T10:00', 'A', '5.00')];
    expect(findTimelineConflicts(entries).map((c) => [c.occurredAt, c.balance])).toEqual([
      [at('02T10:00'), '-5.00'],
      [at('03T10:00'), '-10.00'],
    ]);
  });

  it('puede limitarse a un conjunto de casas', () => {
    const entries = [debit('a', '02T10:00', 'A', '5.00'), debit('b', '02T10:00', 'B', '5.00')];
    expect(findTimelineConflicts(entries, new Set(['B'])).map((c) => c.houseId)).toEqual(['B']);
  });

  it('suma decimales exactos, sin coma flotante', () => {
    const entries = [
      credit('d', '01T10:00', 'A', '0.30'),
      debit('a', '02T10:00', 'A', '0.10'),
      debit('b', '02T10:00', 'A', '0.20'),
    ];
    // 0.30 - 0.10 - 0.20 es exactamente 0.00 (no -5.5e-17): sin conflicto.
    expect(findTimelineConflicts(entries)).toEqual([]);
  });
});

describe('newTimelineConflicts: solo lo que la corrección introduce', () => {
  it('ignora un saldo negativo que ya existía en la historia real', () => {
    const before = [debit('old', '02T10:00', 'A', '5.00')];
    const after = [...before, debit('planned', '03T10:00', 'B', '1.00')];
    expect(newTimelineConflicts(before, after).map((c) => c.houseId)).toEqual(['B']);
  });

  it('informa el conflicto nuevo aunque haya otro anterior en la misma casa', () => {
    const before = [credit('d', '01T10:00', 'A', '10.00'), debit('w', '05T10:00', 'A', '10.00')];
    const after = [...before, debit('plan:x', '02T10:00', 'A', '20.00')];
    // Antes no había conflictos; después el saldo queda negativo desde el día 2 y sigue el día 5.
    expect(newTimelineConflicts(before, after).map((c) => c.occurredAt)).toEqual([
      at('02T10:00'),
      at('05T10:00'),
    ]);
  });

  it('sin cambios no hay conflictos nuevos', () => {
    const entries = [credit('d', '01T10:00', 'A', '10.00')];
    expect(newTimelineConflicts(entries, entries)).toEqual([]);
  });
});
