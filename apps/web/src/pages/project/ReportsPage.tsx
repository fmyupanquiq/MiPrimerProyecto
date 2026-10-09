import { formatPEN, type BetStatus, type BetType, type DashboardPeriod } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
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
import { dashboardApi, type DashboardAnalysisFilters } from '../../api/dashboard.js';
import { housesApi, stagesApi } from '../../api/finance.js';
import { useLoad } from '../../hooks/useLoad.js';
import { dayOfInstant, endOfDayInstant, startOfDayInstant } from '../../date-inputs.js';
import { BET_STATUS_LABELS, BET_TYPE_LABELS, formatShortDate } from '../../labels.js';
import { addCalendarDays, getDisplayTimeZone, todayInZone } from '../../time-zone.js';
import { type GlossaryKey, Help } from '../../glossary.js';
import { ChartIcon } from '../../icons.js';
import {
  btn,
  btnPrimary,
  chipClass,
  EmptyState,
  inputClass,
  LoadingBlock,
  Notice,
  PageHeader,
  Section,
} from '../../ui.js';
import { CHART, chartTooltipLabelStyle, chartTooltipStyle } from './chart-theme.js';
import { useProject } from './ProjectContext.js';

const PERIOD_LABELS: Record<DashboardPeriod, string> = { day: 'Día', week: 'Semana', month: 'Mes' };

/** Cifra en soles, o un guion si viene `null` (razón indefinida, p. ej. sin nada apostado). */
function money(value: string | null): string {
  return value === null ? '—' : formatPEN(value);
}

/** Porcentaje, o un guion si viene `null` (D-M1, §108.1: no es 0%, es "todavía no definido"). */
function percent(value: string | null): string {
  return value === null ? '—' : `${value} %`;
}

const shortDate = (iso: string) => formatShortDate(iso, '2-digit');

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

const EMPTY_FILTERS: DashboardAnalysisFilters = {};

const QUICK_RANGES: { label: string; days: number | null }[] = [
  { label: 'Últimos 7 días', days: 7 },
  { label: 'Últimos 30 días', days: 30 },
  { label: 'Últimos 90 días', days: 90 },
  { label: 'Último año', days: 365 },
  { label: 'Todo', days: null },
];

/** Filtros y análisis del tablero (§33, §108): un formulario simple que aplica al enviarse. */
function AnalysisFilters({
  houses,
  stages,
  onApply,
}: {
  houses: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  onApply: (filters: DashboardAnalysisFilters) => void;
}) {
  const [draft, setDraft] = useState<DashboardAnalysisFilters>(EMPTY_FILTERS);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(draft);
  };
  // Rango rápido: rellena "Desde" y "Hasta" con días del proyecto (§93, H-20) y aplica.
  // "Últimos 7 días" = hoy y los 6 anteriores.
  const applyRange = (days: number | null) => {
    const today = todayInZone();
    const next: DashboardAnalysisFilters =
      days === null
        ? { ...draft, from: undefined, to: undefined }
        : {
            ...draft,
            from: startOfDayInstant(addCalendarDays(today, -(days - 1))),
            to: endOfDayInstant(today),
          };
    setDraft(next);
    onApply(next);
  };
  const clear = () => {
    setDraft(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
        <span className="text-sm font-medium">Periodo</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rango rápido">
          {QUICK_RANGES.map((range) => (
            <button
              key={range.label}
              type="button"
              className={chipClass(false)}
              onClick={() => applyRange(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Etapa
        <select
          className={inputClass}
          value={draft.stageId ?? ''}
          onChange={(e) => setDraft({ ...draft, stageId: e.target.value || undefined })}
        >
          <option value="">Todas</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Casa
        <select
          className={inputClass}
          value={draft.houseId ?? ''}
          onChange={(e) => setDraft({ ...draft, houseId: e.target.value || undefined })}
        >
          <option value="">Todas</option>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Tipo de apuesta
        <select
          className={inputClass}
          value={draft.betType ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, betType: (e.target.value || undefined) as BetType | undefined })
          }
        >
          <option value="">Todos</option>
          {(Object.keys(BET_TYPE_LABELS) as BetType[]).map((t) => (
            <option key={t} value={t}>
              {BET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Resultado
        <select
          className={inputClass}
          value={draft.status ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, status: (e.target.value || undefined) as BetStatus | undefined })
          }
        >
          <option value="">Todos</option>
          {(Object.keys(BET_STATUS_LABELS) as BetStatus[]).map((s) => (
            <option key={s} value={s}>
              {BET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Deporte
        <input
          className={inputClass}
          value={draft.sport ?? ''}
          onChange={(e) => setDraft({ ...draft, sport: e.target.value || undefined })}
          placeholder="p. ej. Fútbol"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Mercado
        <input
          className={inputClass}
          value={draft.market ?? ''}
          onChange={(e) => setDraft({ ...draft, market: e.target.value || undefined })}
          placeholder="p. ej. 1X2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Desde
        <input
          type="date"
          className={inputClass}
          value={dayOfInstant(draft.from)}
          onChange={(e) =>
            setDraft({
              ...draft,
              from: e.target.value ? startOfDayInstant(e.target.value) : undefined,
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Hasta
        <input
          type="date"
          className={inputClass}
          value={dayOfInstant(draft.to)}
          onChange={(e) =>
            setDraft({
              ...draft,
              to: e.target.value ? endOfDayInstant(e.target.value) : undefined,
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Agrupar por periodo
        <select
          className={inputClass}
          value={draft.period ?? 'month'}
          onChange={(e) => setDraft({ ...draft, period: e.target.value as DashboardPeriod })}
        >
          {(Object.keys(PERIOD_LABELS) as DashboardPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={btnPrimary}>
          Aplicar filtros
        </button>
        <button type="button" onClick={clear} className={btn}>
          Limpiar
        </button>
      </div>
    </form>
  );
}

/**
 * Reportes (§33, §108, ADR 0015; Fase 10.3): el análisis filtrado (P/L, Yield, ROI, conteos y
 * desgloses) y la curva de rendimiento con su drawdown, que antes vivían en el resumen del
 * proyecto. Se movieron sin cambios de lógica cuando el dashboard pasó a ser una vista general.
 */
export function ReportsPage() {
  const { project } = useProject();
  const [filters, setFilters] = useState<DashboardAnalysisFilters>(EMPTY_FILTERS);

  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const stages = useLoad(`stages:${project.id}`, () => stagesApi.list(project.id));
  const analysis = useLoad(`dashboard-analysis:${project.id}:${JSON.stringify(filters)}`, () =>
    dashboardApi.analysis(project.id, filters),
  );
  const performance = useLoad(`dashboard-performance:${project.id}`, () =>
    dashboardApi.performanceChart(project.id),
  );

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Analiza cómo rindió tu proyecto por fechas, casa, etapa o deporte."
        help={{
          label: 'Reportes',
          text: 'Analiza el rendimiento de las apuestas liquidadas por fechas, casa, etapa o deporte. Los filtros no cambian la realidad financiera: solo eligen qué se analiza.',
        }}
      />
      <Section
        title="Análisis filtrado"
        description={`Elige un periodo y, si quieres, otros filtros; luego pulsa Aplicar filtros. Los días se cuentan en la zona horaria del proyecto (${getDisplayTimeZone() ?? 'del navegador'}).`}
      >
        <AnalysisFilters
          houses={houses.data ?? []}
          stages={stages.data ?? []}
          onApply={setFilters}
        />
        {analysis.error && <Notice tone="error">{analysis.error}</Notice>}
        {analysis.loading && !analysis.data && (
          <LoadingBlock lines={3} label="Calculando el análisis…" />
        )}
        {analysis.data && (
          <div
            className={`flex flex-col gap-4 transition-opacity ${analysis.loading ? 'opacity-60' : ''}`}
            aria-busy={analysis.loading}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="P/L"
                term="pl"
                primary
                value={money(analysis.data.profitLoss)}
                tone={toneOf(analysis.data.profitLoss)}
              />
              <StatCard
                label="Yield"
                term="yield"
                primary
                value={percent(analysis.data.yield)}
                tone={toneOf(analysis.data.yield)}
              />
              <StatCard
                label="ROI"
                term="roi"
                primary
                value={percent(analysis.data.roi)}
                tone={toneOf(analysis.data.roi)}
              />
              <StatCard
                label="Apostado"
                term="amount"
                primary
                value={money(analysis.data.totalStaked)}
              />
              <StatCard label="Capital invertido" value={money(analysis.data.capitalInvested)} />
              <StatCard label="Depósitos del periodo" value={money(analysis.data.deposits)} />
              <StatCard label="Retiros del periodo" value={money(analysis.data.withdrawals)} />
              <StatCard
                label="Extraordinarios del periodo"
                value={money(analysis.data.extraordinary)}
              />
            </div>
            {analysis.data.unconfirmedReturns.count > 0 && (
              <Notice tone="warning">
                Este análisis incluye {analysis.data.unconfirmedReturns.count}{' '}
                {analysis.data.unconfirmedReturns.count === 1
                  ? 'apuesta ganada con retorno calculado'
                  : 'apuestas ganadas con retorno calculado'}{' '}
                (sin confirmar), con una ganancia provisional de{' '}
                {formatPEN(analysis.data.unconfirmedReturns.profitLoss)}.
              </Notice>
            )}
            <p className="text-sm text-slate-500">
              Total: {analysis.data.counts.total} · Pendientes: {analysis.data.counts.pending} ·
              Ganadas: {analysis.data.counts.won} · Perdidas: {analysis.data.counts.lost} ·
              Anuladas: {analysis.data.counts.void} · Cash Out: {analysis.data.counts.cashout}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <BreakdownTable title="Por casa" items={analysis.data.byHouse} />
              <BreakdownTable title="Por etapa" items={analysis.data.byStage} />
              <BreakdownTable title="Por deporte" items={analysis.data.bySport} />
              <BreakdownTable title="Por mercado" items={analysis.data.byMarket} />
            </div>
            <BreakdownTable title="Por periodo" items={analysis.data.byPeriod} />
          </div>
        )}
      </Section>

      <Section
        title="Curva de rendimiento y drawdown"
        description={
          <>
            Ganancia acumulada de las apuestas liquidadas en toda la historia del proyecto (no usa
            los filtros de arriba) y su peor caída. <Help term="drawdown" />
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
    </>
  );
}
