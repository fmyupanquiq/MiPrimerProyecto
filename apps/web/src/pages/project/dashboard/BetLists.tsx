import { formatOdds, formatPEN, type BetSummary } from '@letfer/shared';
import type { ReactNode } from 'react';
import type { Loaded } from '../../../hooks/useLoad.js';
import { PlusIcon, TicketIcon } from '../../../icons.js';
import { BET_TYPE_LABELS, formatDate, formatDateTime, formatMoment } from '../../../labels.js';
import { signedPEN } from '../../../format.js';
import { BetStatusBadge } from '../BetStatusBadge.js';
import {
  CardLink,
  DashboardCard,
  EmptyState,
  LoadingBlock,
  PrimaryLink,
  SectionError,
} from './DashboardCard.js';

const RECENT_LIMIT = 6;
const PENDING_LIMIT = 5;

function StatusBadge({ bet }: { bet: BetSummary }) {
  return <BetStatusBadge status={bet.status} />;
}

/** Fecha arriba y hora debajo: se lee de un vistazo y no se corta a mitad. */
function PlacedAt({ iso, timeKnown }: { iso: string; timeKnown: boolean }) {
  const [date, time] = timeKnown
    ? formatDateTime(iso).split(', ')
    : [formatDate(iso), 'hora desconocida'];
  return (
    <span className="text-xs text-slate-500 md:text-sm">
      <span className="md:block">{date}</span>
      {time && <span className="md:block md:text-xs"> {time}</span>}
    </span>
  );
}

const title = (bet: BetSummary) => (bet.events.length > 0 ? bet.events.join(' + ') : 'Sin partido');

function Profit({ bet }: { bet: BetSummary }) {
  if (bet.profitLoss === null) return <span className="text-slate-400">-</span>;
  const tone = bet.profitLoss.startsWith('-')
    ? 'text-red-700'
    : bet.profitLoss === '0.00'
      ? 'text-slate-600'
      : 'text-green-700';
  return <span className={`font-medium ${tone}`}>{signedPEN(bet.profitLoss)}</span>;
}

/** Celda con su rótulo visible solo en móvil (en escritorio lo da la cabecera de columnas). */
function Cell({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex justify-between gap-2 md:block ${className}`}>
      <span className="text-xs text-slate-500 md:hidden">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

// Densidad reducida a propósito (Fase 11, §10.3): el Dashboard es un vistazo, no la lista
// completa de "Apuestas" — solo fecha, partido, importe, ganancia y estado; la cuota se añade
// como columna extra solo si hay espacio de verdad (`xl:`); stake y A+G quedan solo en "Apuestas".
const COLUMNS =
  'md:grid md:grid-cols-[6.5rem_minmax(0,1fr)_6.5rem_6.5rem_6rem] md:items-center md:gap-4 xl:grid-cols-[6.5rem_minmax(0,1fr)_5rem_6.5rem_6.5rem_6rem]';

/**
 * Las apuestas más recientes (por fecha de colocación, como ordena la API), compactas. Las
 * acciones de cada apuesta (ticket, estado, editar, liquidar…) siguen en "Apuestas".
 */
export function RecentBets({
  bets,
  betsPath,
  addBetPath,
}: {
  bets: Loaded<BetSummary[]>;
  betsPath: string;
  addBetPath: string | null;
}) {
  const recent = bets.data?.slice(0, RECENT_LIMIT) ?? [];

  return (
    <DashboardCard
      title="Apuestas recientes"
      description="Las últimas registradas en el proyecto"
      className="lg:col-span-2"
      action={<CardLink to={betsPath}>Ver todas</CardLink>}
    >
      {bets.loading && !bets.data ? (
        <LoadingBlock lines={4} label="Cargando las apuestas recientes…" />
      ) : !bets.data ? (
        <SectionError message={bets.error ?? 'No se pudieron cargar las apuestas.'} />
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title="Todavía no hay apuestas"
          text="Registra la primera apuesta y la verás aquí con su estado y su resultado."
          action={
            addBetPath && (
              <PrimaryLink to={addBetPath}>
                <PlusIcon className="h-4 w-4" /> Añadir apuesta
              </PrimaryLink>
            )
          }
        />
      ) : (
        <div>
          <div
            className={`hidden border-b border-slate-100 pb-2 text-xs font-medium uppercase tracking-wide text-slate-400 ${COLUMNS}`}
            aria-hidden="true"
          >
            <span>Fecha</span>
            <span>Partido</span>
            <span className="hidden xl:inline">Cuota</span>
            <span>Importe</span>
            <span>Ganancia</span>
            <span>Estado</span>
          </div>
          <ul aria-label="Apuestas recientes" className="divide-y divide-slate-100">
            {recent.map((bet) => (
              <li key={bet.id} className={`flex flex-col gap-1.5 py-3 text-sm ${COLUMNS}`}>
                <PlacedAt iso={bet.placedAt} timeKnown={bet.placedTimeKnown} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900" title={title(bet)}>
                    {title(bet)}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {BET_TYPE_LABELS[bet.betType]} · {bet.houseName}
                    {bet.sports.length > 0 && ` · ${bet.sports.join(', ')}`}
                  </p>
                </div>
                {/* Cuota (Fase 11, §10.3): solo si de verdad hay espacio (`xl:`); nunca en el
                    renglón "rótulo: valor" del móvil, donde el importe y la ganancia ya bastan
                    para escanear la apuesta en menos de un segundo. */}
                <div className="hidden tabular-nums xl:block">
                  {formatOdds(bet.visibleTotalOdds)}
                </div>
                <Cell label="Importe">{formatPEN(bet.effectiveAmount)}</Cell>
                <Cell label="Ganancia">
                  <Profit bet={bet} />
                </Cell>
                <div className="flex justify-between gap-2 md:block">
                  <span className="text-xs text-slate-500 md:hidden">Estado</span>
                  <StatusBadge bet={bet} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}

/** Apuestas pendientes, las más antiguas primero (llevan más tiempo comprometiendo saldo). */
export function PendingBets({ bets, betsPath }: { bets: Loaded<BetSummary[]>; betsPath: string }) {
  const pending = (bets.data ?? []).filter((bet) => bet.status === 'PENDING');
  const shown = [...pending].reverse().slice(0, PENDING_LIMIT);

  return (
    <DashboardCard
      title="Apuestas pendientes"
      description={
        bets.data && pending.length > 0
          ? `${pending.length} sin liquidar`
          : 'A la espera de resultado'
      }
      action={
        pending.length > PENDING_LIMIT ? <CardLink to={betsPath}>Ver todas</CardLink> : undefined
      }
    >
      {bets.loading && !bets.data ? (
        <LoadingBlock lines={3} label="Cargando las apuestas pendientes…" />
      ) : !bets.data ? (
        <SectionError message={bets.error ?? 'No se pudieron cargar las apuestas.'} />
      ) : pending.length === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title="No hay apuestas pendientes"
          text="Todas las apuestas registradas tienen resultado. Las nuevas aparecerán aquí hasta liquidarlas."
        />
      ) : (
        <ul aria-label="Apuestas pendientes" className="flex flex-col gap-2">
          {shown.map((bet) => (
            <li
              key={bet.id}
              className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-medium" title={title(bet)}>
                  {title(bet)}
                </p>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatPEN(bet.effectiveAmount)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {bet.houseName} · cuota {formatOdds(bet.visibleTotalOdds)} ·{' '}
                {formatMoment(bet.placedAt, bet.placedTimeKnown)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
