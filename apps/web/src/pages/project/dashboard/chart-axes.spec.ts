import { afterEach, describe, expect, it } from 'vitest';
import { setDisplayTimeZone, zonedParts } from '../../../time-zone.js';
import { dayTicks, TICK_SPACING_PX, valueAxis } from './chart-axes.js';

const DAY = 24 * 60 * 60 * 1000;
const day = (t: number) => zonedParts(new Date(t), 'America/Lima').date;

afterEach(() => setDisplayTimeZone(undefined));

describe('marcas del eje X (fechas)', () => {
  it('no amontona fechas: como máximo una cada TICK_SPACING_PX del ancho, días distintos', () => {
    setDisplayTimeZone('America/Lima');
    const end = Date.parse('2026-10-15T15:00:00Z');
    const start = end - 30 * DAY;
    const ticks = dayTicks(start, end, 480);
    expect(ticks.length).toBeLessThanOrEqual(Math.floor(480 / TICK_SPACING_PX));
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ticks.map(day)).size).toBe(ticks.length);
    // Orden cronológico, dentro del periodo, y el último día (hoy) rotulado.
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(ticks.every((t) => t >= start && t <= end)).toBe(true);
    expect(day(ticks.at(-1)!)).toBe('2026-10-15');
  });

  it('a más ancho, más fechas; nunca menos de dos marcas en un periodo de varios días', () => {
    setDisplayTimeZone('America/Lima');
    const end = Date.parse('2026-10-15T15:00:00Z');
    const start = end - 30 * DAY;
    expect(dayTicks(start, end, 900).length).toBeGreaterThan(dayTicks(start, end, 400).length);
    expect(dayTicks(start, end, 50).length).toBeGreaterThanOrEqual(1);
  });
});

describe('eje Y (cifras limpias, sin negativos inventados)', () => {
  it('pasos redondos que cubren los datos', () => {
    const { domain, ticks } = valueAxis([1004, 1120, 1262]);
    expect(domain[0]).toBeLessThanOrEqual(1004);
    expect(domain[1]).toBeGreaterThanOrEqual(1262);
    // Pasos de 100 (cifras como S/ 1,000, S/ 1,100…), de extremo a extremo del dominio.
    expect(ticks.every((t) => t % 100 === 0)).toBe(true);
    expect(ticks.slice(1).map((t, i) => t - ticks[i]!)).toEqual(Array(ticks.length - 1).fill(100));
    expect([ticks[0], ticks.at(-1)]).toEqual(domain);
  });

  it('con saldos no negativos no baja de 0; con negativos sí los incluye', () => {
    expect(valueAxis([0, 40, 1050]).domain[0]).toBe(0);
    expect(valueAxis([-120, 300]).domain[0]).toBeLessThan(-120);
  });

  it('un solo valor tiene un tramo visible', () => {
    const { domain } = valueAxis([700]);
    expect(domain[1]).toBeGreaterThan(domain[0]);
  });
});
