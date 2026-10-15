import type { CSSProperties } from 'react';

/**
 * Colores de los gráficos (Fase 10.3): variables del tema (`index.css`), así la cuadrícula, los
 * ejes y los tooltips se ven bien en claro y en oscuro sin colores fijos en cada componente.
 */
export const CHART = {
  brand: '#7c3aed',
  positive: '#16a34a',
  negative: '#dc2626',
  grid: 'var(--color-slate-200)',
  axis: 'var(--color-slate-400)',
  marker: 'var(--color-slate-300)',
  markerText: 'var(--color-slate-500)',
  /** Tooltip oscuro del Dashboard (igual en ambos temas, como en la referencia). */
  tooltipBg: '#0b1220',
  tooltipBorder: 'rgba(148, 163, 184, 0.25)',
};

/**
 * Colores de la dona «Estado de apuestas» del Dashboard (referencia 2026-10-15): tonos 500, iguales
 * en claro y oscuro; Anuladas es neutro y sigue el tema.
 */
export const DONUT_COLORS = {
  WON: '#22c55e',
  LOST: '#ef4444',
  PENDING: '#eab308',
  VOID: 'var(--color-slate-400)',
  CASHOUT: '#3b82f6',
} as const;

export const chartTooltipStyle: CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-slate-200)',
  borderRadius: 8,
  color: 'var(--color-slate-900)',
  fontSize: 12,
};
export const chartTooltipLabelStyle: CSSProperties = { color: 'var(--color-slate-600)' };
