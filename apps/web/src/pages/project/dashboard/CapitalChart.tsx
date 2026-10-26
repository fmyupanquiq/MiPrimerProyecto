import { formatPEN, type BankrollChart, type BankrollPoint } from '@letfer/shared';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Loaded } from '../../../hooks/useLoad.js';
import { AreaChartIcon } from '../../../icons.js';
import type { ChartPoint } from './CapitalPlot.js';
import { CardError, DashboardCard, Skeleton } from './DashboardCard.js';
import { valueAxis } from './chart-axes.js';

export const CHART_PERIODS = [
  { key: '7D', label: '7D', name: 'últimos 7 días', days: 7 },
  { key: '30D', label: '30D', name: 'últimos 30 días', days: 30 },
  { key: '3M', label: '3M', name: 'últimos 3 meses', days: 91 },
  { key: '1A', label: '1A', name: 'último año', days: 365 },
  { key: 'TODO', label: 'Todo', name: 'todo el proyecto', days: null },
] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

// El trazado usa Recharts (el módulo más pesado del Dashboard): se descarga después de pintar las cifras.
const CapitalPlot = lazy(() =>
  import('./CapitalPlot.js').then((module) => ({ default: module.CapitalPlot })),
);

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
  // Ancho real del gráfico: decide cuántas fechas caben en el eje sin amontonarse.
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState(480);
  useEffect(() => {
    const el = plotEl;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPlotWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [plotEl]);

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
    // El eje X cubre el periodo elegido completo (hasta hoy): los puntos quedan en su fecha real,
    // aunque los movimientos se concentren en pocos días.
    const start = days === null ? (data[0]?.t ?? now) : now - days * DAY_MS;
    return {
      data,
      xDomain: [Math.min(start, data[0]?.t ?? start), now] as [number, number],
      yAxis: valueAxis(data.length > 0 ? data.map((p) => p.value) : [0]),
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
        <div aria-busy="true" className="h-[10.5rem]">
          <span className="sr-only">Cargando la evolución del capital…</span>
          <Skeleton className="h-full w-full" />
        </div>
      ) : !view ? (
        <CardError
          message={bankroll.error ?? 'No se pudo cargar la evolución del capital.'}
          onRetry={bankroll.reload}
        />
      ) : view.data.length === 0 ? (
        <div className="flex h-[10.5rem] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
          Aún no hay movimientos en este periodo.
        </div>
      ) : (
        <div
          ref={setPlotEl}
          className="h-[10.5rem] w-full"
          role="img"
          aria-label={view.summary ?? 'Gráfico de evolución del capital'}
        >
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <CapitalPlot
              data={view.data}
              xDomain={view.xDomain}
              yAxis={view.yAxis}
              plotWidth={plotWidth}
              gradientId={gradientId}
            />
          </Suspense>
        </div>
      )}
    </DashboardCard>
  );
}
