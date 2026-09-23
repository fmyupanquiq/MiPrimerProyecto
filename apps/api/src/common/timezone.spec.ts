import { describe, expect, it } from 'vitest';
import { startOfDayInTimeZone } from './timezone.js';

describe('startOfDayInTimeZone (§88, §93)', () => {
  it('América/Lima (UTC-5, sin horario de verano): medianoche local = 05:00 UTC', () => {
    // 2026-06-15 14:30 UTC es 2026-06-15 09:30 en Lima (UTC-5): mismo día.
    const instant = new Date('2026-06-15T14:30:00.000Z');
    const start = startOfDayInTimeZone(instant, 'America/Lima');
    expect(start.toISOString()).toBe('2026-06-15T05:00:00.000Z');
  });

  it('cruza la medianoche UTC pero no la del proyecto: mismo día en Lima', () => {
    // 2026-06-16 02:00 UTC es todavía 2026-06-15 21:00 en Lima: el "día" del proyecto no cambió.
    const instant = new Date('2026-06-16T02:00:00.000Z');
    const start = startOfDayInTimeZone(instant, 'America/Lima');
    expect(start.toISOString()).toBe('2026-06-15T05:00:00.000Z');
  });

  it('zona con horario de verano (Europe/Madrid): el desfase cambia según la época del año', () => {
    // Verano (CEST, UTC+2): medianoche local del 15 de junio = 22:00 UTC del 14.
    const summer = startOfDayInTimeZone(new Date('2026-06-15T10:00:00.000Z'), 'Europe/Madrid');
    expect(summer.toISOString()).toBe('2026-06-14T22:00:00.000Z');
    // Invierno (CET, UTC+1): medianoche local del 15 de enero = 23:00 UTC del 14.
    const winter = startOfDayInTimeZone(new Date('2026-01-15T10:00:00.000Z'), 'Europe/Madrid');
    expect(winter.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('UTC: la medianoche local coincide exactamente con la medianoche UTC', () => {
    const start = startOfDayInTimeZone(new Date('2026-03-10T18:45:00.000Z'), 'UTC');
    expect(start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});
