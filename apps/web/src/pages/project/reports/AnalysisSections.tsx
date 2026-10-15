import { formatPEN, type DashboardAnalysis } from '@letfer/shared';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dashboardApi } from '../../../api/dashboard.js';
import { type GlossaryKey, Help } from '../../../glossary.js';
import { useLoad } from '../../../hooks/useLoad.js';
import { ChartIcon } from '../../../icons.js';
import { formatShortDate } from '../../../labels.js';
import { EmptyState, LoadingBlock, Notice, Section } from '../../../ui.js';
import { CHART, chartTooltipLabelStyle, chartTooltipStyle } from '../chart-theme.js';

/*
 * Análisis detallado de Reportes (Fase 10.3, §108): los desgloses y la curva de rendimiento con su
 * drawdown que ya tenía la pantalla. Se conservan tal cual; el análisis ahora llega del reporte con
 * los MISMOS filtros aplicados del constructor (§108.11).
 */

const shortDate = (iso: string) => formatShortDate(iso, '2-digit');

/** Cifra en soles, o un guion si viene `null` (razón indefinida, p. ej. sin nada apostado). */
function money(value: string | null): string {
  return value === null ? '—' : formatPEN(value);
}

/** Porcentaje, o un guion si viene `null` (D-M1, §108.1: no es 0%, es "todavía no definido"). */
function percent(value: string | null): string {
  return value === null ? '—' : `${value} %`;
}

interface StatCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
  /** Concepto del glosario que explica la cifra. */
  term?: GlossaryKey;
  /** Cifra principal (más grande) o secundaria. */
  primary?: boolean;
}

function StatCard({ label, value, tone = 'default', term, primary = false }: StatCardProps) {
  const color =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
        ? 'text-red-700'
        : 'text-slate-900';
  return (
    <div
      className={`rounded-xl border border-slate-200 p-3 ${primary ? 'bg-surface shadow-sm' : 'bg-slate-50'}`}
    >
      <p className="flex items-center gap-1 text-xs text-slate-500">
        {label}
        {term && <Help term={term} />}
      </p>
      <p className={`font-semibold tabular-nums ${primary ? 'text-2xl' : 'text-lg'} ${color}`}>
        {value}
      </p>
    </div>
  );
}

function toneOf(value: string | null): 'default' | 'positive' | 'negative' {
  if (value === null) return 'default';
  return value.startsWith('-') ? 'negative' : value === '0.00' ? 'default' : 'positive';
}

interface BreakdownTableProps {
  title: string;
  items: {
    key: string;
    profitLoss: string;
    yield: string | null;
    totalStaked: string;
    count: number;
  }[];
}

function BreakdownTable({ title, items }: BreakdownTableProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Sin apuestas liquidadas en este filtro.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Grupo</th>
                <th className="py-1 pr-2 font-medium">P/L</th>
                <th className="py-1 pr-2 font-medium">Yield</th>
                <th className="py-1 pr-2 font-medium">Apostado</th>
                <th className="py-1 font-medium">Apuestas</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-2">{item.key}</td>
                  <td
                    className={`py-1.5 pr-2 font-medium tabular-nums ${
                      toneOf(item.profitLoss) === 'negative'
                        ? 'text-red-700'
                        : toneOf(item.profitLoss) === 'positive'
                          ? 'text-green-700'
                          : ''
                    }`}
                  >
                    {money(item.profitLoss)}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{percent(item.yield)}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{money(item.totalStaked)}</td>
                  <td className="py-1.5 tabular-nums">{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Cifras y desgloses del análisis con los filtros aplicados. */
export function AnalysisBreakdowns({
  analysis,
  loading,
}: {
  analysis: DashboardAnalysis;
  loading: boolean;
}) {
  const data = analysis;
  return (
    <Section
      title="Análisis detallado"
      description="P/L, Yield, ROI, movimientos del periodo y desgloses de las apuestas liquidadas, con los filtros aplicados."
    >
      {
        <div
          className={`flex flex-col gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`}
          aria-busy={loading}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="P/L"
              term="pl"
              primary
              value={money(data.profitLoss)}
              tone={toneOf(data.profitLoss)}
            />
            <StatCard
              label="Yield"
              term="yield"
              primary
              value={percent(data.yield)}
              tone={toneOf(data.yield)}
            />
            <StatCard
              label="ROI"
              term="roi"
              primary
              value={percent(data.roi)}
              tone={toneOf(data.roi)}
            />
            <StatCard label="Apostado" term="amount" primary value={money(data.totalStaked)} />
            <StatCard label="Capital invertido" value={money(data.capitalInvested)} />
            <StatCard label="Depósitos del periodo" value={money(data.deposits)} />
            <StatCard label="Retiros del periodo" value={money(data.withdrawals)} />
            <StatCard label="Extraordinarios del periodo" value={money(data.extraordinary)} />
          </div>
          {data.unconfirmedReturns.count > 0 && (
            <Notice tone="warning">
              Este análisis incluye {data.unconfirmedReturns.count}{' '}
              {data.unconfirmedReturns.count === 1
                ? 'apuesta ganada con retorno calculado'
                : 'apuestas ganadas con retorno calculado'}{' '}
              (sin confirmar), con una ganancia provisional de{' '}
              {formatPEN(data.unconfirmedReturns.profitLoss)}.
            </Notice>
          )}
          <p className="text-sm text-slate-500">
            Total: {data.counts.total} · Pendientes: {data.counts.pending} · Ganadas:{' '}
            {data.counts.won} · Perdidas: {data.counts.lost} · Anuladas: {data.counts.void} · Cash
            Out: {data.counts.cashout}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <BreakdownTable title="Por casa" items={data.byHouse} />
            <BreakdownTable title="Por etapa" items={data.byStage} />
            <BreakdownTable title="Por deporte" items={data.bySport} />
            <BreakdownTable title="Por mercado" items={data.byMarket} />
          </div>
          <BreakdownTable title="Por periodo" items={data.byPeriod} />
        </div>
      }
    </Section>
  );
}

/** Curva de rendimiento y drawdown de toda la historia del proyecto (no usa los filtros). */
export function PerformanceSection({ projectId }: { projectId: string }) {
  const performance = useLoad(`dashboard-performance:${projectId}`, () =>
    dashboardApi.performanceChart(projectId),
  );
  return (
    <Section
      title="Curva de rendimiento y drawdown"
      description={
        <>
          Ganancia acumulada de las apuestas liquidadas en toda la historia del proyecto (no usa los
          filtros de arriba) y su peor caída. <Help term="drawdown" />
        </>
      }
    >
      {performance.error && <Notice tone="error">{performance.error}</Notice>}
      {performance.loading && !performance.data && (
        <LoadingBlock lines={3} label="Cargando la curva de rendimiento…" />
      )}
      {performance.data && performance.data.points.length === 0 && (
        <EmptyState
          icon={<ChartIcon />}
          title="Todavía no hay apuestas liquidadas."
          text="La curva aparecerá cuando liquides la primera apuesta."
        />
      )}
      {performance.data && performance.data.points.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              label="Drawdown máximo"
              term="drawdown"
              value={formatPEN(performance.data.maxDrawdown)}
            />
            <StatCard
              label="Drawdown máximo (%)"
              value={percent(performance.data.maxDrawdownPercent)}
            />
          </div>
          <div className="h-64 sm:h-72" role="img" aria-label="Curva de rendimiento y drawdown">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={performance.data.points.map((p) => ({
                  ...p,
                  cumulative: Number(p.cumulativeProfitLoss),
                  drawdownNumber: Number(p.drawdown),
                }))}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="occurredAt"
                  tickFormatter={shortDate}
                  fontSize={11}
                  stroke={CHART.axis}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  fontSize={11}
                  width={64}
                  stroke={CHART.axis}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipLabelStyle}
                  labelFormatter={(label) => (typeof label === 'string' ? shortDate(label) : '')}
                  formatter={(value) =>
                    typeof value === 'number' ? formatPEN(value.toFixed(2)) : ''
                  }
                />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  isAnimationActive={false}
                  name="P/L acumulado"
                  stroke={CHART.brand}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="drawdownNumber"
                  isAnimationActive={false}
                  name="Drawdown"
                  stroke={CHART.negative}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Section>
  );
}
