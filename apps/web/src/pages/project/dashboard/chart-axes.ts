import { addCalendarDays, zonedInstant, zonedParts } from '../../../time-zone.js';

/*
 * Ejes del gráfico «Evolución del capital» (refinamiento 2026-10-15). Solo presentación: eligen qué
 * fechas se rotulan y qué tramo vertical se dibuja; nunca crean ni mueven puntos.
 */

/** Ancho mínimo por etiqueta de fecha («28 set.» con aire a los lados), en px. */
export const TICK_SPACING_PX = 64;

/**
 * Marcas del eje X: inicios de día (zona del proyecto) repartidos uniformemente entre `start` y
 * `end`, como máximo uno cada `TICK_SPACING_PX` del ancho disponible. Nunca dos el mismo día.
 */
export function dayTicks(start: number, end: number, widthPx: number): number[] {
  if (!(end > start)) return [start];
  const maxTicks = Math.max(2, Math.floor(widthPx / TICK_SPACING_PX));
  const firstDay = zonedParts(new Date(start)).date;
  const lastDay = zonedParts(new Date(end)).date;
  const days: string[] = [];
  for (let day = firstDay; day <= lastDay && days.length < 4000; day = addCalendarDays(day, 1)) {
    days.push(day);
  }
  const step = Math.max(1, Math.ceil(days.length / maxTicks));
  const ticks: number[] = [];
  // Se cuenta desde el final: el último día (hoy) siempre lleva su fecha.
  for (let i = days.length - 1; i >= 0; i -= step) {
    const instant = zonedInstant(days[i]!, '00:00')?.getTime();
    if (instant !== undefined && instant >= start && instant <= end) ticks.unshift(instant);
  }
  return ticks.length > 0 ? ticks : [start];
}

/**
 * Eje Y: tramo de los datos con un pequeño margen, redondeado a un paso «limpio» (1, 2, 2.5 o 5 por
 * potencia de 10) para que las marcas sean cifras legibles (S/ 1,000, S/ 1,050…). Si ningún saldo es
 * negativo, no baja de 0 (no se dibujan tramos negativos que no existen).
 */
export function valueAxis(values: readonly number[]): {
  domain: [number, number];
  ticks: number[];
} {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max > min ? max - min : Math.max(Math.abs(max) * 0.1, 1);
  const raw = (span * 1.1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= raw)!;
  let low = Math.floor((min - span * 0.05) / step) * step;
  if (min >= 0) low = Math.max(0, low);
  const high = Math.ceil((max + span * 0.05) / step) * step;
  const ticks: number[] = [];
  for (let i = 0; low + i * step <= high + step / 2 && i < 12; i++) ticks.push(low + i * step);
  return { domain: [low, high], ticks };
}
