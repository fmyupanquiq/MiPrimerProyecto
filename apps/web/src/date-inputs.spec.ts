import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fromDateTimeParts,
  nowDateTimeParts,
  nowLocalInput,
  toDateTimeParts,
  toLocalInput,
} from './date-inputs.js';

afterEach(() => vi.useRealTimers());

describe('date-inputs (convención de fecha y hora de la Fase 10.3)', () => {
  it('crear u operar: el valor inicial es el momento actual, en hora local', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 17, 20)); // 30/09/2026 17:20 local
    expect(nowDateTimeParts()).toEqual({ date: '2026-09-30', time: '17:20' });
    expect(nowLocalInput()).toBe('2026-09-30T17:20');
  });

  it('editar: el valor inicial es el guardado, no el actual', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0)); // "mañana" 01/10/2026 10:00
    const saved = new Date(2026, 8, 30, 17, 20).toISOString(); // guardado el 30/09 17:20
    expect(toDateTimeParts(saved)).toEqual({ date: '2026-09-30', time: '17:20' });
    expect(toLocalInput(saved)).toBe('2026-09-30T17:20');
  });

  it('sin valor guardado, los campos quedan vacíos', () => {
    expect(toDateTimeParts(null)).toEqual({ date: '', time: '' });
    expect(toLocalInput(null)).toBe('');
  });

  it('fecha y hora locales vuelven al mismo instante', () => {
    const saved = new Date(2026, 8, 30, 17, 20).toISOString();
    expect(fromDateTimeParts(toDateTimeParts(saved))).toBe(saved);
  });

  it('falta la fecha o la hora, o no es válida: sin instante', () => {
    expect(fromDateTimeParts({ date: '', time: '10:00' })).toBeNull();
    expect(fromDateTimeParts({ date: '2026-09-30', time: '' })).toBeNull();
    expect(fromDateTimeParts({ date: '2026-13-45', time: '10:00' })).toBeNull();
  });
});
