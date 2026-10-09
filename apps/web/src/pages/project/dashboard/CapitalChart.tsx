import { formatPEN, subtractMoney, type BankrollChart, type BankrollPoint } from '@letfer/shared';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Loaded } from '../../../hooks/useLoad.js';
import { ChartIcon } from '../../../icons.js';
import { formatDateTime, formatShortDate } from '../../../labels.js';
import { SegmentedControl } from '../../../ui.js';
import { CHART, chartTooltipLabelStyle, chartTooltipStyle } from '../chart-theme.js';
import { DashboardCard, EmptyState, LoadingBlock, SectionError } from './DashboardCard.js';

const PERIODS = [
  { key: '7D', label: '7 días', days: 7 },
  { key: '30D', label: '30 días', days: 30 },
  { key: '3M', label: '3 meses', days: 91 },
  { key: '1A', label: '1 año', days: 365 },
  { key: 'TODO', label: 'Todo', days: null },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

const shortDate = (iso: string) => formatShortDate(iso);

/**
 * Puntos reales del periodo. No se inventa ninguno: si el periodo empieza entre dos movimientos,
 * el capital vigente al inicio es el del último punto anterior (`opening`), que se informa aparte.
 */
function windowOf(points: BankrollPoint[], days: number | null, now: number) {
  if (days === null) return { inWindow: points, opening: null as BankrollPoint | null };
  const cutoff = now - days * DAY_MS;
  const inWindow = points.filter((p) => new Date(p.occurredAt).getTime() >= cutoff);
  const before = points.filter((p) => new Date(p.occurredAt).getTime() < cutoff);
  return { inWindow, opening: before.at(-1) ?? null };
}

/**
 * Evolución del capital (§34, §108.3): la serie real de `GET /dashboard/bankroll-chart` (saldo
 * acumulado de banca, con los cambios de etapa marcados). El periodo solo elige qué tramo de esa
 * serie se ve; la variación es la diferencia entre dos saldos reales de la serie.
 */
export function CapitalChart({ bankroll }: { bankroll: Loaded<BankrollChart> }) {
  const [period, setPeriod] = useState<PeriodKey>('TODO');
  const [now] = useState(() => Date.now());
  const points = bankroll.data?.points;

  const view = useMemo(() => {
    if (!points || points.length === 0) return null;
    const { days } = PERIODS.find((p) => p.key === period)!;
    const { inWindow, opening } = windowOf(points, days, now);
    const last = points.at(-1)!;
    const start = opening ?? inWindow[0] ?? null;
    return {
      inWindow,
      opening,
      current: last.balance,
      change: start ? subtractMoney(last.balance, start.balance) : null,
      data: inWindow.map((p) => ({ ...p, value: Number(p.balance) })),
    };
  }, [points, period, now]);

  const periodSelector = (
    <SegmentedControl
      ariaLabel="Periodo del gráfico"
      value={period}
      onChange={setPeriod}
      options={PERIODS.map((p) => ({
        value: p.key,
        label: p.key === 'TODO' ? 'Todo' : p.key,
        ariaLabel: p.label,
      }))}
    />
  );

  return (
    <DashboardCard
      title="Evolución del capital"
      description="Saldo total de las casas en cada movimiento"
      action={view ? periodSelector : undefined}
      className="lg:col-span-2"
    >
      {bankroll.loading && !bankroll.data ? (
        <LoadingBlock lines={4} label="Cargando la evolución del capital…" />
      ) : !bankroll.data ? (
        <SectionError message={bankroll.error ?? 'No se pudo cargar la evolución del capital.'} />
      ) : !view ? (
        <EmptyState
          icon={<ChartIcon />}
          title="Todavía no hay movimientos"
          text="El gráfico aparecerá con el primer movimiento de banca: el capital inicial, un depósito o una apuesta liquidada."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
            <p>
              <span className="block text-xs text-slate-500">Capital ahora</span>
              <span className="text-2xl font-bold tracking-tight">{formatPEN(view.current)}</span>
            </p>
            {view.change !== null && (
              <p
                className={`text-sm font-medium ${
                  view.change.startsWith('-')
                    ? 'text-red-700'
                    : view.change === '0.00'
                      ? 'text-slate-500'
                      : 'text-green-700'
                }`}
              >
                {view.change.startsWith('-') || view.change === '0.00' ? '' : '+'}
                {formatPEN(view.change)}{' '}
                <span className="font-normal text-slate-500">
                  {period === 'TODO' ? 'desde el primer movimiento' : 'en el periodo'}
                </span>
              </p>
            )}
          </div>
          {view.inWindow.length === 0 ? (
            <EmptyState
              icon={<ChartIcon />}
              title="Sin movimientos en este periodo"
              text={`El capital no cambió en este periodo: sigue en ${formatPEN(view.opening?.balance ?? view.current)}.`}
            />
          ) : (
            <div
              className="h-64 w-full sm:h-72"
              role="img"
              aria-label="Gráfico de evolución del capital"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={view.data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="capitalFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="occurredAt"
                    tickFormatter={shortDate}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    stroke={CHART.axis}
                  />
                  <YAxis
                    fontSize={11}
                    width={64}
                    tickLine={false}
                    axisLine={false}
                    stroke={CHART.axis}
                    tickFormatter={(v: number) => v.toLocaleString('es-PE')}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    labelFormatter={(label) =>
                      typeof label === 'string' ? formatDateTime(label) : ''
                    }
                    formatter={(value) =>
                      typeof value === 'number' ? [formatPEN(value.toFixed(2)), 'Capital'] : ''
                    }
                  />
                  {/* stepAfter: el saldo cambia de golpe en cada movimiento, no entre ellos. */}
                  <Area
                    type="stepAfter"
                    isAnimationActive={false}
                    dataKey="value"
                    name="Capital"
                    stroke={CHART.brand}
                    strokeWidth={2}
                    fill="url(#capitalFill)"
                  />
                  {view.data
                    .filter((p) => p.stageStarted !== null)
                    .map((p) => (
                      <ReferenceLine
                        key={p.occurredAt}
                        x={p.occurredAt}
                        stroke={CHART.marker}
                        strokeDasharray="4 4"
                        label={{
                          value: p.stageStarted!.name,
                          fontSize: 10,
                          position: 'top',
                          fill: CHART.markerText,
                        }}
                      />
                    ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </DashboardCard>
  );
}
