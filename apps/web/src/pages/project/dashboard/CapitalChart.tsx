import { formatPEN, type BankrollChart, type BankrollPoint } from '@letfer/shared';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { Loaded } from '../../../hooks/useLoad.js';
import { AreaChartIcon } from '../../../icons.js';
import { formatDate } from '../../../labels.js';
import { zonedParts } from '../../../time-zone.js';
import { CHART } from '../chart-theme.js';
import { CardError, DashboardCard, Skeleton } from './DashboardCard.js';
import { formatCalendarDate } from './date-range.js';

export const CHART_PERIODS = [
  { key: '7D', label: '7D', name: 'últimos 7 días', days: 7 },
  { key: '30D', label: '30D', name: 'últimos 30 días', days: 30 },
  { key: '3M', label: '3M', name: 'últimos 3 meses', days: 91 },
  { key: '1A', label: '1A', name: 'último año', days: 365 },
  { key: 'TODO', label: 'Todo', name: 'todo el proyecto', days: null },
] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

interface ChartPoint extends BankrollPoint {
  /** Solo para dibujar (posición vertical): el valor mostrado es siempre `balance`. */
  value: number;
  /** Instante en milisegundos: eje X de tiempo real (varios movimientos el mismo día). */
  t: number;
}

/** Puntos reales del periodo (no se inventa ninguno) y el último saldo anterior a él. */
function windowOf(points: readonly BankrollPoint[], days: number | null, now: number) {
  if (days === null) return { inWindow: [...points], opening: null as BankrollPoint | null };
  const cutoff = now - days * DAY_MS;
  const inWindow = points.filter((p) => new Date(p.occurredAt).getTime() >= cutoff);
  const before = points.filter((p) => new Date(p.occurredAt).getTime() < cutoff);
  return { inWindow, opening: before.at(-1) ?? null };
}

/** Control segmentado accesible (radiogroup con flechas). */
function PeriodTabs({
  value,
  onChange,
}: {
  value: ChartPeriod;
  onChange: (value: ChartPeriod) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step && !back) return;
    event.preventDefault();
    const index = CHART_PERIODS.findIndex((p) => p.key === value);
    const next = (index + step + back + CHART_PERIODS.length) % CHART_PERIODS.length;
    onChange(CHART_PERIODS[next]!.key);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Periodo del gráfico"
      onKeyDown={onKeyDown}
      className="inline-flex rounded-lg border border-slate-200 bg-surface-2 p-0.5"
    >
      {CHART_PERIODS.map((period, index) => {
        const checked = period.key === value;
        return (
          <button
            key={period.key}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={period.name.charAt(0).toUpperCase() + period.name.slice(1)}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(period.key)}
            className={`min-w-8 rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${
              checked
                ? 'bg-violet-600 text-white shadow-[0_0_14px_-4px_rgba(124,58,237,0.8)]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {period.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tooltip oscuro: fecha y capital del punto activo (y la etapa, si empezó ahí). */
function ChartTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{ background: CHART.tooltipBg, borderColor: CHART.tooltipBorder }}
    >
      <p style={{ color: '#cbd5e1' }}>{formatDate(point.occurredAt)}</p>
      <p className="mt-0.5 text-sm font-semibold text-white tabular-nums">
        {formatPEN(point.balance)}
      </p>
      {point.stageStarted && (
        <p className="mt-0.5" style={{ color: '#c4b5fd' }}>
          Inicio de {point.stageStarted.name}
        </p>
      )}
    </div>
  );
}

const axisMoney = (value: number) =>
  `S/ ${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

/**
 * Evolución del capital (§34, §108.3): la serie real de `GET /dashboard/bankroll-chart` (saldo
 * acumulado de banca, con los cambios de etapa marcados). El periodo solo elige qué puntos ya
 * calculados se ven; es independiente del rango de fechas de la página.
 */
export function CapitalChart({
  bankroll,
  className = '',
}: {
  bankroll: Loaded<BankrollChart>;
  className?: string;
}) {
  const [period, setPeriod] = useState<ChartPeriod>('30D');
  const [now] = useState(() => Date.now());
  const gradientId = useId();
  const points = bankroll.data?.points;

  const view = useMemo(() => {
    if (!points) return null;
    const { days, name } = CHART_PERIODS.find((p) => p.key === period)!;
    const { inWindow, opening } = windowOf(points, days, now);
    const data: ChartPoint[] = inWindow.map((p) => ({
      ...p,
      value: Number(p.balance),
      t: new Date(p.occurredAt).getTime(),
    }));
    const first = opening ?? inWindow[0] ?? null;
    const last = inWindow.at(-1) ?? null;
    return {
      data,
      summary:
        first && last
          ? `Capital de ${formatPEN(first.balance)} a ${formatPEN(last.balance)} en ${name === 'todo el proyecto' ? 'todo el proyecto' : `los ${name}`}`
          : null,
    };
  }, [points, period, now]);

  return (
    <DashboardCard
      title="Evolución del capital"
      subtitle="Saldo total de las casas en cada movimiento"
      icon={<AreaChartIcon />}
      action={<PeriodTabs value={period} onChange={setPeriod} />}
      className={className}
    >
      {bankroll.loading && !bankroll.data ? (
        <div aria-busy="true" className="h-48">
          <span className="sr-only">Cargando la evolución del capital…</span>
          <Skeleton className="h-full w-full" />
        </div>
      ) : !view ? (
        <CardError
          message={bankroll.error ?? 'No se pudo cargar la evolución del capital.'}
          onRetry={bankroll.reload}
        />
      ) : view.data.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
          Aún no hay movimientos en este periodo.
        </div>
      ) : (
        <div
          className="h-48 w-full"
          role="img"
          aria-label={view.summary ?? 'Gráfico de evolución del capital'}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={view.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke={CHART.grid}
                strokeDasharray="3 4"
                strokeOpacity={0.7}
                vertical={false}
              />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t: number) =>
                  formatCalendarDate(zonedParts(new Date(t)).date, false)
                }
                fontSize={11}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                stroke={CHART.axis}
                tickMargin={8}
              />
              <YAxis
                fontSize={11}
                width={60}
                tickLine={false}
                axisLine={false}
                stroke={CHART.axis}
                tickCount={5}
                domain={['auto', 'auto']}
                tickFormatter={axisMoney}
              />
              <Tooltip
                content={(props) => <ChartTooltip {...props} />}
                cursor={{ stroke: CHART.axis, strokeDasharray: '4 4' }}
              />
              {/* Cada punto es el saldo real tras un movimiento; la línea solo los une. */}
              <Area
                type="linear"
                isAnimationActive={false}
                dataKey="value"
                name="Capital"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: '#8b5cf6',
                  stroke: 'rgba(139, 92, 246, 0.35)',
                  strokeWidth: 8,
                }}
              />
              {view.data
                .filter((p) => p.stageStarted !== null)
                .map((p) => (
                  <ReferenceLine
                    key={p.occurredAt}
                    x={p.t}
                    stroke={CHART.marker}
                    strokeDasharray="2 4"
                    label={{
                      value: p.stageStarted!.name,
                      fontSize: 10,
                      position: 'insideTopLeft',
                      fill: CHART.markerText,
                    }}
                  />
                ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashboardCard>
  );
}
