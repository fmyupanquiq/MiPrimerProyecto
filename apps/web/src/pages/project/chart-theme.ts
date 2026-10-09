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
};

export const chartTooltipStyle: CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-slate-200)',
  borderRadius: 8,
  color: 'var(--color-slate-900)',
  fontSize: 12,
};
export const chartTooltipLabelStyle: CSSProperties = { color: 'var(--color-slate-600)' };
