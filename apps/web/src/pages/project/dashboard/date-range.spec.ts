import { describe, expect, it } from 'vitest';
import { formatPercent, signTone } from '../../../format.js';
import {
  addMonths,
  monthBounds,
  monthLabel,
  monthsBetween,
  presetRange,
  rangeFromSearch,
  rangeLabel,
  rangeToSearch,
} from './date-range.js';

const TODAY = '2026-10-15';
const params = (query: string) => new URLSearchParams(query);

describe('atajos del rango de fechas (días de la zona del proyecto)', () => {
  it('cada atajo cubre los días esperados, hasta hoy incluido', () => {
    expect(presetRange('7D', TODAY)).toMatchObject({ from: '2026-10-09', to: TODAY });
    expect(presetRange('30D', TODAY)).toMatchObject({ from: '2026-09-16', to: TODAY });
    expect(presetRange('MONTH', TODAY)).toMatchObject({ from: '2026-10-01', to: TODAY });
    expect(presetRange('PREV_MONTH', TODAY)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(presetRange('3M', TODAY)).toMatchObject({ from: '2026-07-16', to: TODAY });
    expect(presetRange('YEAR', TODAY)).toMatchObject({ from: '2026-01-01', to: TODAY });
    expect(presetRange('ALL', TODAY)).toMatchObject({ from: null, to: null });
  });

  it('«Últimos 3 meses» desde un 31 no se sale del mes más corto', () => {
    expect(presetRange('3M', '2026-05-31').from).toBe('2026-03-01');
    expect(presetRange('PREV_MONTH', '2026-03-31')).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('rango en la URL', () => {
  it('sin parámetros (o inválidos), los últimos 30 días', () => {
    expect(rangeFromSearch(params(''), TODAY)).toEqual(presetRange('30D', TODAY));
    expect(rangeFromSearch(params('desde=2026-02-30&hasta=2026-03-01'), TODAY).preset).toBe('30D');
    expect(rangeFromSearch(params('desde=2026-05-10&hasta=2026-05-01'), TODAY).preset).toBe('30D');
  });

  it('reconoce un atajo, un rango personalizado y «todo»', () => {
    expect(rangeFromSearch(params('desde=2026-10-09&hasta=2026-10-15'), TODAY).preset).toBe('7D');
    expect(rangeFromSearch(params('desde=2026-05-01&hasta=2026-05-20'), TODAY)).toEqual({
      preset: 'CUSTOM',
      from: '2026-05-01',
      to: '2026-05-20',
    });
    expect(rangeFromSearch(params('rango=todo'), TODAY).preset).toBe('ALL');
  });

  it('se escribe de vuelta: el rango por defecto no deja parámetros', () => {
    expect(rangeToSearch(presetRange('30D', TODAY), TODAY)).toEqual({});
    expect(rangeToSearch(presetRange('7D', TODAY), TODAY)).toEqual({
      desde: '2026-10-09',
      hasta: TODAY,
    });
    expect(rangeToSearch(presetRange('ALL', TODAY), TODAY)).toEqual({ rango: 'todo' });
  });
});

describe('textos de fechas y meses', () => {
  it('etiqueta del rango como en la referencia', () => {
    expect(rangeLabel({ preset: 'CUSTOM', from: '2024-09-20', to: '2024-10-12' })).toBe(
      '20 set. 2024 - 12 oct. 2024',
    );
    expect(rangeLabel(presetRange('ALL', TODAY))).toBe('Todo el proyecto');
  });

  it('meses: etiqueta, límites y lista del más reciente al más antiguo', () => {
    expect(monthLabel('2024-10')).toBe('Octubre 2024');
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
});

describe('porcentajes de la API (un decimal, signo explícito, sin coma flotante)', () => {
  it('redondea half-up sobre la cadena y pone el signo', () => {
    expect(formatPercent('12.85')).toBe('+12.9%');
    expect(formatPercent('18.90')).toBe('+18.9%');
    expect(formatPercent('-3.44')).toBe('-3.4%');
    expect(formatPercent('-0.04')).toBe('0.0%');
    expect(formatPercent('0.00')).toBe('0.0%');
    expect(formatPercent('50.00', { signed: false })).toBe('50.0%');
  });

  it('tono: verde, rojo o neutro', () => {
    expect(signTone('1.00')).toBe('positive');
    expect(signTone('-0.01')).toBe('negative');
    expect(signTone('0.00')).toBe('neutral');
    expect(signTone(null)).toBe('neutral');
  });
});
