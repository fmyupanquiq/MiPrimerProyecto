import { describe, expect, it } from 'vitest';
import { dashboardFiltersSchema } from './dashboard.js';

describe('dashboardFiltersSchema (§33, §108)', () => {
  it('todos los filtros son opcionales', () => {
    const result = dashboardFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('period por defecto es "month"', () => {
    const result = dashboardFiltersSchema.parse({});
    expect(result.period).toBe('month');
  });

  it('acepta un conjunto completo de filtros válidos', () => {
    const result = dashboardFiltersSchema.safeParse({
      stageId: '0195f7c0-0000-7000-8000-0000000000a1',
      houseId: '0195f7c0-0000-7000-8000-0000000000a2',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
      sport: 'Fútbol',
      market: '1X2',
      betType: 'MULTIPLE',
      userId: '0195f7c0-0000-7000-8000-0000000000a3',
      status: 'WON',
      period: 'week',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza un betType o status fuera del catálogo', () => {
    expect(dashboardFiltersSchema.safeParse({ betType: 'DESCONOCIDO' }).success).toBe(false);
    expect(dashboardFiltersSchema.safeParse({ status: 'DESCONOCIDO' }).success).toBe(false);
  });

  it('rechaza un period fuera de day/week/month', () => {
    expect(dashboardFiltersSchema.safeParse({ period: 'year' }).success).toBe(false);
  });

  it('rechaza un stageId/houseId/userId que no sea uuid', () => {
    expect(dashboardFiltersSchema.safeParse({ stageId: 'no-es-uuid' }).success).toBe(false);
    expect(dashboardFiltersSchema.safeParse({ houseId: 'no-es-uuid' }).success).toBe(false);
    expect(dashboardFiltersSchema.safeParse({ userId: 'no-es-uuid' }).success).toBe(false);
  });

  it('rechaza sport/market vacíos', () => {
    expect(dashboardFiltersSchema.safeParse({ sport: '' }).success).toBe(false);
    expect(dashboardFiltersSchema.safeParse({ market: '  ' }).success).toBe(false);
  });
});
