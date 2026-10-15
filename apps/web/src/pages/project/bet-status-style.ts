import type { BetStatus } from '@letfer/shared';

/**
 * Colores de cada estado de apuesta (Fase 10.3), comunes a la lista de apuestas y al dashboard:
 * Pendiente neutro, Ganada verde, Perdida roja, Anulada gris y Cash out azul.
 */
export const BET_STATUS_STYLE: Record<BetStatus, string> = {
  PENDING: 'border-slate-300 bg-surface text-slate-700',
  WON: 'border-green-600 bg-green-600 text-white',
  LOST: 'border-red-600 bg-red-600 text-white',
  VOID: 'border-slate-300 bg-slate-200 text-slate-800',
  CASHOUT: 'border-blue-600 bg-blue-600 text-white',
};

/** Variante suave (fondo claro) para insignias dentro de listas compactas. */
export const BET_STATUS_SOFT: Record<BetStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700 ring-slate-200',
  WON: 'bg-green-50 text-green-700 ring-green-200',
  LOST: 'bg-red-50 text-red-700 ring-red-200',
  VOID: 'bg-slate-100 text-slate-500 ring-slate-200',
  CASHOUT: 'bg-blue-50 text-blue-700 ring-blue-200',
};

/**
 * Píldora del Dashboard (rediseño 2026-10-15, como la referencia): rectángulo redondeado con fondo
 * tintado; Pendiente en ámbar (en espera), igual que en la dona.
 */
export const BET_STATUS_PILL: Record<BetStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 ring-amber-300/60',
  WON: 'bg-green-100 text-green-800 ring-green-300/60',
  LOST: 'bg-red-100 text-red-800 ring-red-300/60',
  VOID: 'bg-slate-100 text-slate-600 ring-slate-300/60',
  CASHOUT: 'bg-blue-100 text-blue-800 ring-blue-300/60',
};

/**
 * Color de cada estado en gráficos (mismo significado que las insignias). Ganada/Perdida/Cash
 * out usan los 600 fijos (iguales en claro y oscuro, como los botones, §4); Pendiente/Anulada son
 * neutros y SÍ deben seguir el tema (variables de `index.css`, Fase 11): un hex fijo de gris
 * claro se volvía casi invisible sobre el fondo navy del tema oscuro.
 */
export const BET_STATUS_CHART: Record<BetStatus, string> = {
  PENDING: 'var(--color-slate-400)',
  WON: '#16a34a',
  LOST: '#dc2626',
  VOID: 'var(--color-slate-300)',
  CASHOUT: '#2563eb',
};
