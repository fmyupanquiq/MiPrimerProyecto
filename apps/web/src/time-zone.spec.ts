import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dayOfInstant,
  endOfDayInstant,
  fromDateTimeParts,
  fromLocalInput,
  nowDateTimeParts,
  startOfDayInstant,
  toDateTimeParts,
  toLocalInput,
} from './date-inputs.js';
import { formatDate, formatDateTime, formatMoment } from './labels.js';
import {
  addCalendarDays,
  getDisplayTimeZone,
  setDisplayTimeZone,
  todayInZone,
  zonedInstant,
  zonedParts,
} from './time-zone.js';

afterEach(() => {
  setDisplayTimeZone(undefined);
  vi.useRealTimers();
});

describe('zona horaria del proyecto (§93, H-20)', () => {
  it('convierte fecha y hora de la zona a un instante UTC, y vuelve', () => {
    // Lima UTC-5 (sin horario de verano), Tokio UTC+9.
    expect(zonedInstant('2026-06-01', '20:00', 'America/Lima')!.toISOString()).toBe(
      '2026-06-02T01:00:00.000Z',
    );
    expect(zonedInstant('2026-06-01', '10:00', 'Asia/Tokyo')!.toISOString()).toBe(
      '2026-06-01T01:00:00.000Z',
    );
    expect(zonedParts(new Date('2026-06-02T01:00:00.000Z'), 'America/Lima')).toEqual({
      date: '2026-06-01',
      time: '20:00',
    });
  });

  it('acierta en los días de cambio de horario (Madrid)', () => {
    // 29/03/2026: Madrid pasa de UTC+1 a UTC+2.
    expect(zonedInstant('2026-03-28', '12:00', 'Europe/Madrid')!.toISOString()).toBe(
      '2026-03-28T11:00:00.000Z',
    );
    expect(zonedInstant('2026-03-30', '12:00', 'Europe/Madrid')!.toISOString()).toBe(
      '2026-03-30T10:00:00.000Z',
    );
  });

  it('rechaza fechas u horas imposibles', () => {
    expect(zonedInstant('2026-02-31', '10:00', 'America/Lima')).toBeNull();
    expect(zonedInstant('2026-13-01', '10:00', 'America/Lima')).toBeNull();
    expect(zonedInstant('2026-06-01', '25:00', 'America/Lima')).toBeNull();
    expect(zonedInstant('', '10:00', 'America/Lima')).toBeNull();
  });

  it('una zona no válida vuelve a la del navegador; fuera de un proyecto no hay zona', () => {
    setDisplayTimeZone('Marte/Olimpo');
    expect(getDisplayTimeZone()).toBeUndefined();
    setDisplayTimeZone('Asia/Tokyo');
    expect(getDisplayTimeZone()).toBe('Asia/Tokyo');
  });

  it('suma días de calendario sin depender de horas', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('formularios y filtros en la zona del proyecto, no en la del navegador', () => {
  it('"Desde/Hasta": el día completo del proyecto (el fallo de H-20 usaba el día UTC)', () => {
    setDisplayTimeZone('America/Lima');
    expect(startOfDayInstant('2026-06-01')).toBe('2026-06-01T05:00:00.000Z');
    expect(endOfDayInstant('2026-06-01')).toBe('2026-06-02T04:59:59.999Z');
    expect(dayOfInstant('2026-06-01T05:00:00.000Z')).toBe('2026-06-01');
    expect(dayOfInstant('2026-06-02T04:59:59.999Z')).toBe('2026-06-01');
    setDisplayTimeZone('Asia/Tokyo');
    expect(startOfDayInstant('2026-06-01')).toBe('2026-05-31T15:00:00.000Z');
  });

  it('crear: fecha y hora actuales del proyecto; editar: las guardadas, en la misma zona', () => {
    setDisplayTimeZone('Asia/Tokyo');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T20:30:00.000Z')); // 02/06 05:30 en Tokio
    expect(nowDateTimeParts()).toEqual({ date: '2026-06-02', time: '05:30' });
    expect(todayInZone()).toBe('2026-06-02');
    const saved = '2026-06-01T01:00:00.000Z';
    expect(toDateTimeParts(saved)).toEqual({ date: '2026-06-01', time: '10:00' });
    expect(toLocalInput(saved)).toBe('2026-06-01T10:00');
    expect(fromDateTimeParts({ date: '2026-06-01', time: '10:00' })).toBe(saved);
    expect(fromLocalInput('2026-06-01T10:00')).toBe(saved);
  });

  it('se muestra en la zona del proyecto; una hora desconocida no se inventa', () => {
    setDisplayTimeZone('Asia/Tokyo');
    const instant = '2026-06-01T20:00:00.000Z'; // 02/06 05:00 en Tokio
    expect(formatDate(instant)).toMatch(/2 jun/);
    expect(formatDateTime(instant)).toMatch(/5:00/);
    expect(formatMoment(instant, false)).toMatch(/2 jun.*\(hora desconocida\)/);
    expect(formatMoment(instant, false)).not.toMatch(/5:00/);
  });
});
