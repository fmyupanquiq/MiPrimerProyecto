import {
  formatPEN,
  type BankrollChart,
  type DashboardAnalysis,
  type DashboardStatus,
} from '@letfer/shared';
import { useId, useMemo, type ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { formatPercent, signedPEN, signTone } from '../../../format.js';
import { type GlossaryKey, Help } from '../../../glossary.js';
import type { Loaded } from '../../../hooks/useLoad.js';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BankIcon,
  ChartBarsIcon,
  LockIcon,
  TrendIcon,
  WalletIcon,
} from '../../../icons.js';
import { zonedParts } from '../../../time-zone.js';
import { CHART } from '../chart-theme.js';
import { Skeleton } from './DashboardCard.js';

type Tone = 'violet' | 'blue' | 'orange' | 'green' | 'red';

const ICON_TONE: Record<Tone, string> = {
  violet: 'bg-violet-100 text-violet-700',
  blue: 'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
};

const VALUE_TONE = {
  positive: 'text-green-700',
  negative: 'text-red-700',
  neutral: 'text-slate-900',
} as const;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Valor de una cifra: esqueleto mientras carga, «No se pudo cargar» con reintento si falla. */
function Value<T>({
  loaded,
  label,
  skeleton,
  children,
}: {
  loaded: Loaded<T>;
  label: string;
  skeleton: string;
  children: (data: T) => ReactNode;
}) {
  if (loaded.data) return <>{children(loaded.data)}</>;
  if (loaded.loading) {
    return (
      <div aria-busy="true">
        <span className="sr-only">Cargando {label.toLowerCase()}…</span>
        <Skeleton className={skeleton} />
      </div>
    );
  }
  return (
    <p role="alert" className="flex items-center gap-2 text-xs text-red-700">
      No se pudo cargar
      <button
        type="button"
        onClick={loaded.reload}
        className="rounded font-medium underline focus-visible:outline-2 focus-visible:outline-violet-500"
      >
        Reintentar
      </button>
    </p>
  );
}

/** Una de las cuatro métricas de la fila inferior. */
function Metric({
  label,
  term,
  icon,
  tone,
  children,
}: {
  label: string;
  term?: GlossaryKey;
  icon: ReactNode;
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 py-1 @[60rem]:px-5 @[60rem]:first:pl-0 @[60rem]:last:pr-0">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ICON_TONE[tone]}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-sm text-slate-600">
          {label}
          {term && <Help term={term} />}
        </p>
        {children}
      </div>
    </div>
  );
}

/** Cifra de la fila inferior con su texto auxiliar. */
function MetricValue({
  label,
  value,
  tone = 'neutral',
  caption,
}: {
  label: string;
  value: string;
  tone?: keyof typeof VALUE_TONE;
  caption: ReactNode;
}) {
  return (
    <>
      <p
        className={`truncate text-xl font-semibold tracking-tight tabular-nums ${VALUE_TONE[tone]}`}
        aria-label={label}
      >
        {value}
      </p>
      <p className="truncate text-xs text-slate-500">{caption}</p>
    </>
  );
}

/** Curva decorativa del capital detrás del contenido (la cifra real está en el gráfico). */
function Sparkline({ bankroll }: { bankroll: BankrollChart | null }) {
  const gradientId = useId();
  const data = useMemo(() => {
    // Solo para dibujar: el último saldo REAL de cada día (posición vertical), nunca un cálculo.
    const byDay = new Map<string, number>();
    for (const p of bankroll?.points ?? []) {
      byDay.set(zonedParts(new Date(p.occurredAt)).date, Number(p.balance));
    }
    return [...byDay.values()].slice(-45).map((value) => ({ value }));
  }, [bankroll]);
  if (data.length < 2) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-3 right-[41.5%] left-[48%] hidden h-[5.5rem] [mask-image:linear-gradient(to_right,transparent,black_30%,black_85%,transparent)] @[72rem]:block"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="linear"
            dataKey="value"
            stroke="#8b5cf6"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** ROI y Yield del rango, y el stake unitario de la etapa activa. */
function RangeMetrics({
  range,
  unitStake,
}: {
  range: Loaded<DashboardAnalysis>;
  unitStake: string | null;
}) {
  const ratio = (label: 'ROI' | 'Yield', pick: (a: DashboardAnalysis) => string | null) => (
    <div className="min-w-0 px-2.5 first:pl-0 @[40rem]:px-5">
      <p className="flex items-center gap-1 text-sm text-slate-600">
        {label}
        <Help term={label === 'ROI' ? 'roi' : 'yield'} />
      </p>
      <Value loaded={range} label={`${label} del rango`} skeleton="mt-1 h-7 w-16">
        {(a) => {
          const value = pick(a);
          return (
            <p
              className={`text-lg font-semibold tabular-nums @[40rem]:text-xl ${VALUE_TONE[signTone(value)]}`}
              aria-label={`${label} del rango`}
            >
              {value === null ? '—' : formatPercent(value)}
            </p>
          );
        }}
      </Value>
      <p className="text-[11px] text-slate-500">del rango</p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200/80 bg-surface/40 px-3 py-3 @[40rem]:px-5">
      {ratio('ROI', (a) => a.roi)}
      {ratio('Yield', (a) => a.yield)}
      <div className="min-w-0 px-2.5 @[40rem]:px-5">
        <p className="flex items-center gap-1 text-sm text-slate-600">
          <span className="truncate">Stake unitario</span>
          <Help term="unit" />
        </p>
        <p
          className="text-lg font-semibold whitespace-nowrap text-slate-900 tabular-nums @[40rem]:text-xl"
          aria-label="Stake unitario"
        >
          {unitStake ? formatPEN(unitStake) : '—'}
        </p>
        <p className="text-[11px] text-slate-500">etapa activa</p>
      </div>
    </div>
  );
}

/**
 * Tarjeta principal de capital (rediseño 2026-10-15, §33, §92, §108.10). Todo sale de la API: el
 * capital, el disponible y el comprometido de `/dashboard/status`; el ROI y la ganancia desde el
 * inicio del análisis SIN filtros; el ROI, el Yield y el total de apuestas del análisis del RANGO;
 * el stake unitario, de la etapa activa. Aquí solo se da formato.
 */
export function CapitalHero({
  status,
  overall,
  range,
  bankroll,
  unitStake,
}: {
  status: Loaded<DashboardStatus>;
  /** Análisis sin filtros: desde el inicio del proyecto. */
  overall: Loaded<DashboardAnalysis>;
  /** Análisis del rango de fechas elegido. */
  range: Loaded<DashboardAnalysis>;
  bankroll: Loaded<BankrollChart>;
  unitStake: string | null;
}) {
  const profitTone = signTone(overall.data?.profitLoss ?? null);

  return (
    <section
      aria-label="Estado financiero"
      className="relative overflow-hidden rounded-2xl border border-violet-200/70 bg-linear-to-r from-violet-50 via-surface to-surface shadow-sm"
    >
      <Sparkline bankroll={bankroll.data} />
      <div className="relative flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-4 @[72rem]:flex-row @[72rem]:items-center @[72rem]:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 shadow-[0_0_24px_-6px_rgba(139,92,246,0.55)]"
              aria-hidden="true"
            >
              <WalletIcon className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-sm font-medium text-slate-600">
                Capital actual
                <Help term="capital" />
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Value loaded={status} label="Capital actual" skeleton="mt-1 h-12 w-56">
                  {(s) => (
                    <p
                      className="text-4xl font-bold tracking-tight text-slate-900 tabular-nums @[40rem]:text-5xl"
                      aria-label="Capital actual"
                    >
                      {formatPEN(s.capitalActual)}
                    </p>
                  )}
                </Value>
                <Value loaded={overall} label="Ganancia desde el inicio" skeleton="h-7 w-48">
                  {(a) => (
                    <div className="flex items-center gap-2.5 text-sm">
                      {a.roi !== null && (
                        <span
                          title="ROI desde el inicio del proyecto"
                          aria-label={`ROI desde el inicio: ${formatPercent(a.roi)}`}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums ${
                            signTone(a.roi) === 'negative'
                              ? 'bg-red-100 text-red-700'
                              : signTone(a.roi) === 'positive'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {signTone(a.roi) === 'negative' ? (
                            <ArrowDownIcon className="h-3.5 w-3.5" />
                          ) : signTone(a.roi) === 'positive' ? (
                            <ArrowUpIcon className="h-3.5 w-3.5" />
                          ) : null}
                          {formatPercent(a.roi)}
                        </span>
                      )}
                      <span className="text-slate-500">
                        <span
                          className={`font-semibold tabular-nums ${VALUE_TONE[signTone(a.profitLoss)]}`}
                        >
                          {signedPEN(a.profitLoss)}
                        </span>{' '}
                        desde el inicio
                      </span>
                    </div>
                  )}
                </Value>
              </div>
            </div>
          </div>
          <div className="w-full @[72rem]:w-auto @[72rem]:min-w-[30rem]">
            <RangeMetrics range={range} unitStake={unitStake} />
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-200/80 pt-4 @[34rem]:grid-cols-2 @[60rem]:grid-cols-4 @[60rem]:gap-0 @[60rem]:divide-x @[60rem]:divide-slate-200/80">
          <Metric label="Disponible" term="available" icon={<BankIcon />} tone="blue">
            <Value loaded={status} label="Disponible" skeleton="mt-1 h-7 w-28">
              {(s) => (
                <MetricValue
                  label="Disponible"
                  value={formatPEN(s.disponible)}
                  caption="Lo que puedes usar ahora"
                />
              )}
            </Value>
          </Metric>
          <Metric label="Comprometido" term="committed" icon={<LockIcon />} tone="orange">
            <Value loaded={status} label="Comprometido" skeleton="mt-1 h-7 w-28">
              {(s) => (
                <MetricValue
                  label="Comprometido"
                  value={formatPEN(s.comprometido)}
                  caption={plural(
                    s.conteoApuestas.pending,
                    'apuesta pendiente',
                    'apuestas pendientes',
                  )}
                />
              )}
            </Value>
          </Metric>
          <Metric
            label="Ganancia / Pérdida total"
            term="pl"
            icon={<TrendIcon />}
            tone={profitTone === 'negative' ? 'red' : 'green'}
          >
            <Value loaded={overall} label="Ganancia / Pérdida total" skeleton="mt-1 h-7 w-28">
              {(a) => (
                <MetricValue
                  label="Ganancia / Pérdida total"
                  value={signedPEN(a.profitLoss)}
                  tone={signTone(a.profitLoss)}
                  caption="Desde el inicio del proyecto"
                />
              )}
            </Value>
          </Metric>
          <Metric label="Total de apuestas" icon={<ChartBarsIcon />} tone="blue">
            <Value loaded={range} label="Total de apuestas" skeleton="mt-1 h-7 w-16">
              {(a) => (
                <MetricValue
                  label="Total de apuestas"
                  value={String(a.counts.total)}
                  caption={`${a.counts.won} ganadas • ${a.counts.lost} perdidas • ${a.counts.pending} pendientes`}
                />
              )}
            </Value>
          </Metric>
        </div>
      </div>
    </section>
  );
}
