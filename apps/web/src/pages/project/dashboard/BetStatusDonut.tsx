import type { BetStatus, DashboardStatus } from '@letfer/shared';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { Loaded } from '../../../hooks/useLoad.js';
import { PlusIcon, TicketIcon } from '../../../icons.js';
import { BET_STATUS_LABELS } from '../../../labels.js';
import { BET_STATUS_CHART } from '../bet-status-style.js';
import {
  DashboardCard,
  EmptyState,
  LoadingBlock,
  PrimaryLink,
  SectionError,
} from './DashboardCard.js';

const ORDER: { status: BetStatus; key: 'won' | 'lost' | 'pending' | 'void' | 'cashout' }[] = [
  { status: 'WON', key: 'won' },
  { status: 'LOST', key: 'lost' },
  { status: 'PENDING', key: 'pending' },
  { status: 'VOID', key: 'void' },
  { status: 'CASHOUT', key: 'cashout' },
];

/** Porcentaje solo para mostrar (cantidad ÷ total), con un decimal. */
const share = (count: number, total: number) =>
  total === 0 ? '0 %' : `${((count / total) * 100).toFixed(1).replace(/\.0$/, '')} %`;

/**
 * Distribución de las apuestas por estado (§108.6): los conteos de `GET /dashboard/status`
 * (Cash Out es su propio grupo, D-M5).
 */
export function BetStatusDonut({
  status,
  addBetPath,
}: {
  status: Loaded<DashboardStatus>;
  /** Ruta para añadir una apuesta, si la persona puede (estado vacío). */
  addBetPath: string | null;
}) {
  const counts = status.data?.conteoApuestas;
  const rows = counts ? ORDER.map((o) => ({ ...o, count: counts[o.key] })) : [];
  const visible = rows.filter((r) => r.count > 0);

  return (
    <DashboardCard title="Estado de apuestas" description="Todas las apuestas del proyecto">
      {status.loading && !status.data ? (
        <LoadingBlock lines={4} label="Cargando el estado de las apuestas…" />
      ) : !counts ? (
        <SectionError message={status.error ?? 'No se pudo cargar el estado de las apuestas.'} />
      ) : counts.total === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title="Todavía no hay apuestas"
          text="Aquí verás cuántas apuestas están ganadas, perdidas o pendientes."
          action={
            addBetPath && (
              <PrimaryLink to={addBetPath}>
                <PlusIcon className="h-4 w-4" /> Añadir apuesta
              </PrimaryLink>
            )
          }
        />
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
          <div
            className="relative h-40 w-40 shrink-0"
            role="img"
            aria-label="Distribución de apuestas por estado"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visible}
                  dataKey="count"
                  nameKey="status"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={visible.length > 1 ? 2 : 0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {visible.map((r) => (
                    <Cell key={r.status} fill={BET_STATUS_CHART[r.status]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold" aria-label="Total de apuestas">
                {counts.total}
              </span>
              <span className="text-xs text-slate-500">apuestas</span>
            </div>
          </div>
          <ul className="flex w-full flex-col gap-2 text-sm" aria-label="Apuestas por estado">
            {rows.map((r) => (
              <li key={r.status} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: BET_STATUS_CHART[r.status] }}
                    aria-hidden="true"
                  />
                  {BET_STATUS_LABELS[r.status]}
                </span>
                <span className="tabular-nums text-slate-600">
                  <strong className="text-slate-900">{r.count}</strong>{' '}
                  <span className="text-xs">({share(r.count, counts.total)})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}
