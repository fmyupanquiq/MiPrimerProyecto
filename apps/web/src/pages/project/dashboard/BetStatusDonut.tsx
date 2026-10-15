import type {
  BetStatus,
  BetStatusCounts,
  DashboardAnalysis,
  DashboardStatus,
} from '@letfer/shared';
import { useState, type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { Loaded } from '../../../hooks/useLoad.js';
import { ChevronDownIcon, DonutIcon, PlusIcon } from '../../../icons.js';
import { DONUT_COLORS } from '../chart-theme.js';
import { CardError, DashboardCard, PrimaryLink, Skeleton } from './DashboardCard.js';

const ORDER: { status: BetStatus; key: keyof Omit<BetStatusCounts, 'total'>; label: string }[] = [
  { status: 'WON', key: 'won', label: 'Ganadas' },
  { status: 'LOST', key: 'lost', label: 'Perdidas' },
  { status: 'PENDING', key: 'pending', label: 'Pendientes' },
  { status: 'VOID', key: 'void', label: 'Anuladas' },
  { status: 'CASHOUT', key: 'cashout', label: 'Cash Out' },
];

/** Porcentaje de un conteo (no es dinero), redondeado a entero como en la referencia. */
const share = (count: number, total: number) =>
  total === 0 ? '0%' : `${Math.round((count / total) * 100)}%`;

type Scope = 'ALL' | 'RANGE';

/** Select compacto de la cabecera de una tarjeta. */
export function CompactSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  icon,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  icon?: ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center">
      {icon && (
        <span className="pointer-events-none absolute left-2 text-slate-500" aria-hidden="true">
          {icon}
        </span>
      )}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={`h-8 appearance-none rounded-lg border border-slate-200 bg-surface pr-6 text-[0.6875rem] font-medium text-slate-700 transition-colors hover:border-violet-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${
          icon ? 'pl-6' : 'pl-2.5'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-slate-500"
        aria-hidden="true"
      />
    </span>
  );
}

/**
 * Estado de apuestas (§108.6): «Todo» usa los conteos de `/dashboard/status` (todo el proyecto) y
 * «Rango», los del análisis del rango de fechas. Cash Out es su propio grupo (D-M5). Solo cuenta lo
 * que dice la API; el porcentaje es presentación.
 */
export function BetStatusDonut({
  status,
  range,
  addBetPath,
}: {
  status: Loaded<DashboardStatus>;
  range: Loaded<DashboardAnalysis>;
  /** Ruta para añadir una apuesta, si la persona puede (estado vacío). */
  addBetPath: string | null;
}) {
  const [scope, setScope] = useState<Scope>('ALL');
  const source = scope === 'ALL' ? status : range;
  const counts: BetStatusCounts | null =
    scope === 'ALL' ? (status.data?.conteoApuestas ?? null) : (range.data?.counts ?? null);
  const rows = counts ? ORDER.map((o) => ({ ...o, count: counts[o.key] })) : [];
  const visible = rows.filter((r) => r.count > 0);
  const empty = counts !== null && counts.total === 0;

  return (
    <DashboardCard
      title="Estado de apuestas"
      icon={<DonutIcon />}
      action={
        <CompactSelect<Scope>
          ariaLabel="Apuestas consideradas"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'ALL', label: 'Todo' },
            { value: 'RANGE', label: 'Rango' },
          ]}
        />
      }
    >
      {source.loading && !counts ? (
        <div aria-busy="true" className="flex items-center gap-6">
          <span className="sr-only">Cargando el estado de las apuestas…</span>
          <Skeleton className="h-36 w-36 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-3">
            {ORDER.map((o) => (
              <Skeleton key={o.status} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ) : !counts ? (
        <CardError
          message={source.error ?? 'No se pudo cargar el estado de las apuestas.'}
          onRetry={source.reload}
        />
      ) : (
        <div className="@container">
          <div className="flex flex-col items-center gap-4 @[18rem]:flex-row">
            <div
              className="relative h-[8.25rem] w-[8.25rem] shrink-0"
              role="img"
              aria-label={
                empty
                  ? '0 apuestas'
                  : `Distribución de ${counts.total} apuestas por estado: ${rows
                      .map((r) => `${r.count} ${r.label.toLowerCase()}`)
                      .join(', ')}`
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={empty ? [{ status: 'EMPTY', count: 1 }] : visible}
                    dataKey="count"
                    nameKey="status"
                    innerRadius="76%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={visible.length > 1 ? 1.5 : 0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {empty ? (
                      <Cell fill="var(--color-slate-200)" />
                    ) : (
                      visible.map((r) => <Cell key={r.status} fill={DONUT_COLORS[r.status]} />)
                    )}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="text-3xl font-bold text-slate-900 tabular-nums"
                  aria-label="Total de apuestas del gráfico"
                >
                  {counts.total}
                </span>
                <span className="text-xs text-slate-500">apuestas</span>
              </div>
            </div>
            {empty ? (
              <div className="flex flex-1 flex-col items-center gap-2 text-center text-sm text-slate-500 sm:items-start sm:text-left">
                <p>{scope === 'ALL' ? 'Aún no hay apuestas.' : 'Sin apuestas en este rango.'}</p>
                {addBetPath && scope === 'ALL' && (
                  <PrimaryLink to={addBetPath}>
                    <PlusIcon className="h-4 w-4" /> Añadir apuesta
                  </PrimaryLink>
                )}
              </div>
            ) : null}
            {!empty && (
              <ul
                className="flex w-full min-w-0 flex-1 flex-col gap-3 text-sm"
                aria-label="Apuestas por estado"
              >
                {rows.map((r) => (
                  <li key={r.status} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: DONUT_COLORS[r.status] }}
                        aria-hidden="true"
                      />
                      {r.label}
                    </span>
                    <span className="shrink-0 text-slate-500 tabular-nums">
                      <strong className="font-semibold text-slate-900">{r.count}</strong>{' '}
                      <span className="inline-block min-w-[2.6rem] text-right text-xs">
                        ({share(r.count, counts.total)})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
