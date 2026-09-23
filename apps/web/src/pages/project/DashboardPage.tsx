import { formatPEN, type BetStatus, type BetType, type DashboardPeriod } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dashboardApi, type DashboardAnalysisFilters } from '../../api/dashboard.js';
import { housesApi, stagesApi } from '../../api/finance.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  BET_STATUS_LABELS,
  BET_TYPE_LABELS,
  DATE_FORMAT_LABELS,
  formatDate,
  roleLabel,
} from '../../labels.js';
import { inputClass, Notice, Section } from '../../ui.js';
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
}

interface StatCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}

function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  const color =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
        ? 'text-red-700'
        : 'text-slate-900';
  return (
    <div className="rounded border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
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
      <h3 className="text-sm font-medium text-slate-700">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Sin apuestas liquidadas en este filtro.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-2 font-normal">Grupo</th>
                <th className="py-1 pr-2 font-normal">P/L</th>
                <th className="py-1 pr-2 font-normal">Yield</th>
                <th className="py-1 pr-2 font-normal">Apostado</th>
                <th className="py-1 font-normal">Apuestas</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-2">{item.key}</td>
                  <td
                    className={`py-1 pr-2 ${toneOf(item.profitLoss) === 'negative' ? 'text-red-700' : ''}`}
                  >
                    {money(item.profitLoss)}
                  </td>
                  <td className="py-1 pr-2">{percent(item.yield)}</td>
                  <td className="py-1 pr-2">{money(item.totalStaked)}</td>
                  <td className="py-1">{item.count}</td>
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
  const clear = () => {
    setDraft(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm">
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
      <label className="flex flex-col gap-1 text-sm">
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
      <label className="flex flex-col gap-1 text-sm">
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
      <label className="flex flex-col gap-1 text-sm">
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
      <label className="flex flex-col gap-1 text-sm">
        Deporte
        <input
          className={inputClass}
          value={draft.sport ?? ''}
          onChange={(e) => setDraft({ ...draft, sport: e.target.value || undefined })}
          placeholder="p. ej. Fútbol"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Mercado
        <input
          className={inputClass}
          value={draft.market ?? ''}
          onChange={(e) => setDraft({ ...draft, market: e.target.value || undefined })}
          placeholder="p. ej. 1X2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Desde
        <input
          type="date"
          className={inputClass}
          value={draft.from?.slice(0, 10) ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              from: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Hasta
        <input
          type="date"
          className={inputClass}
          value={draft.to?.slice(0, 10) ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              to: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined,
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
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
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Aplicar filtros
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}

/**
 * Dashboard y métricas (§33, §34, §108, ADR 0015). Amplía la pantalla "Resumen" existente
 * (D-M2): la tarjeta de datos del proyecto se conserva; debajo se añaden el estado financiero
 * actual, los filtros y los indicadores del análisis, y los gráficos de evolución de banca y
 * curva de rendimiento (Recharts, D-M9).
 */
export function DashboardPage() {
  const { project } = useProject();
  const [filters, setFilters] = useState<DashboardAnalysisFilters>(EMPTY_FILTERS);

  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const stages = useLoad(`stages:${project.id}`, () => stagesApi.list(project.id));
  const status = useLoad(`dashboard-status:${project.id}`, () => dashboardApi.status(project.id));
  const analysis = useLoad(`dashboard-analysis:${project.id}:${JSON.stringify(filters)}`, () =>
    dashboardApi.analysis(project.id, filters),
  );
  const bankroll = useLoad(`dashboard-bankroll:${project.id}`, () =>
    dashboardApi.bankrollChart(project.id),
  );
  const performance = useLoad(`dashboard-performance:${project.id}`, () =>
    dashboardApi.performanceChart(project.id),
  );

  return (
    <>
      <Section title="Resumen">
        {project.description ? (
          <p className="whitespace-pre-line">{project.description}</p>
        ) : (
          <p className="text-slate-500">Este proyecto todavía no tiene descripción.</p>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Propietario</dt>
            <dd>{project.ownerName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Tu rol</dt>
            <dd>
              {project.isOwner && 'Propietario · '}
              {project.myRole ? roleLabel(project.myRole) : 'Acceso como administrador global'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Moneda</dt>
            <dd>{project.currency}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Zona horaria</dt>
            <dd>{project.timezone}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Formato de fecha</dt>
            <dd>{DATE_FORMAT_LABELS[project.dateFormat]}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Creado</dt>
            <dd>{formatDate(project.createdAt)}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Estado financiero actual">
        {status.error && <Notice tone="error">{status.error}</Notice>}
        {status.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Capital actual" value={formatPEN(status.data.capitalActual)} />
              <StatCard label="Disponible" value={formatPEN(status.data.disponible)} />
              <StatCard label="Comprometido" value={formatPEN(status.data.comprometido)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-1 pr-2 font-normal">Casa</th>
                    <th className="py-1 pr-2 font-normal">Saldo</th>
                    <th className="py-1 pr-2 font-normal">Comprometido</th>
                    <th className="py-1 font-normal">Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {status.data.porCasa.map((house) => (
                    <tr key={house.houseId} className="border-b border-slate-100 last:border-0">
                      <td className="py-1 pr-2">{house.houseName}</td>
                      <td className="py-1 pr-2">{formatPEN(house.balance)}</td>
                      <td className="py-1 pr-2">{formatPEN(house.committed)}</td>
                      <td className="py-1">{formatPEN(house.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500">
              Pendientes: {status.data.conteoApuestas.pending} · Ganadas:{' '}
              {status.data.conteoApuestas.won} · Perdidas: {status.data.conteoApuestas.lost} ·
              Anuladas: {status.data.conteoApuestas.void} · Cash Out:{' '}
              {status.data.conteoApuestas.cashout}
            </p>
          </>
        )}
      </Section>

      <Section title="Análisis filtrado">
        <AnalysisFilters
          houses={houses.data ?? []}
          stages={stages.data ?? []}
          onApply={setFilters}
        />
        {analysis.error && <Notice tone="error">{analysis.error}</Notice>}
        {analysis.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="P/L"
                value={money(analysis.data.profitLoss)}
                tone={toneOf(analysis.data.profitLoss)}
              />
              <StatCard
                label="Yield"
                value={percent(analysis.data.yield)}
                tone={toneOf(analysis.data.yield)}
              />
              <StatCard
                label="ROI"
                value={percent(analysis.data.roi)}
                tone={toneOf(analysis.data.roi)}
              />
              <StatCard label="Apostado" value={money(analysis.data.totalStaked)} />
              <StatCard label="Capital invertido" value={money(analysis.data.capitalInvested)} />
              <StatCard label="Depósitos del periodo" value={money(analysis.data.deposits)} />
              <StatCard label="Retiros del periodo" value={money(analysis.data.withdrawals)} />
              <StatCard
                label="Extraordinarios del periodo"
                value={money(analysis.data.extraordinary)}
              />
            </div>
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
          </>
        )}
      </Section>

      <Section title="Evolución de banca">
        {bankroll.error && <Notice tone="error">{bankroll.error}</Notice>}
        {bankroll.data && bankroll.data.points.length === 0 && (
          <p className="text-sm text-slate-500">Todavía no hay movimientos.</p>
        )}
        {bankroll.data && bankroll.data.points.length > 0 && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={bankroll.data.points.map((p) => ({ ...p, balanceNumber: Number(p.balance) }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="occurredAt" tickFormatter={shortDate} fontSize={12} />
                <YAxis fontSize={12} width={70} tickFormatter={(v: number) => v.toFixed(0)} />
                <Tooltip
                  labelFormatter={(label) => (typeof label === 'string' ? shortDate(label) : '')}
                  formatter={(value) =>
                    typeof value === 'number' ? formatPEN(value.toFixed(2)) : ''
                  }
                />
                <Line
                  type="monotone"
                  dataKey="balanceNumber"
                  name="Banca"
                  stroke="#0f172a"
                  dot={false}
                />
                {bankroll.data.points
                  .filter((p) => p.stageStarted !== null)
                  .map((p) => (
                    <ReferenceLine
                      key={p.occurredAt}
                      x={p.occurredAt}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{ value: p.stageStarted!.name, fontSize: 10, position: 'top' }}
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Curva de rendimiento y drawdown">
        {performance.error && <Notice tone="error">{performance.error}</Notice>}
        {performance.data && performance.data.points.length === 0 && (
          <p className="text-sm text-slate-500">Todavía no hay apuestas liquidadas.</p>
        )}
        {performance.data && performance.data.points.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Drawdown máximo" value={formatPEN(performance.data.maxDrawdown)} />
              <StatCard
                label="Drawdown máximo (%)"
                value={percent(performance.data.maxDrawdownPercent)}
              />
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={performance.data.points.map((p) => ({
                    ...p,
                    cumulative: Number(p.cumulativeProfitLoss),
                    drawdownNumber: Number(p.drawdown),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="occurredAt" tickFormatter={shortDate} fontSize={12} />
                  <YAxis fontSize={12} width={70} tickFormatter={(v: number) => v.toFixed(0)} />
                  <Tooltip
                    labelFormatter={(label) => (typeof label === 'string' ? shortDate(label) : '')}
                    formatter={(value) =>
                      typeof value === 'number' ? formatPEN(value.toFixed(2)) : ''
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulative"
                    name="P/L acumulado"
                    stroke="#0f172a"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="drawdownNumber"
                    name="Drawdown"
                    stroke="#b91c1c"
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
