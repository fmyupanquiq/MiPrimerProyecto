import { formatOdds, formatPEN, type BetSummary } from '@letfer/shared';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { signedPEN, signTone } from '../../../format.js';
import type { Loaded } from '../../../hooks/useLoad.js';
import {
  ClockIcon,
  DotsIcon,
  HourglassIcon,
  PlusIcon,
  SoccerBallIcon,
  SportIcon,
} from '../../../icons.js';
import {
  getDisplayTimeZone,
  todayInZone,
  addCalendarDays,
  zonedParts,
} from '../../../time-zone.js';
import { BetStatusBadge } from '../BetStatusBadge.js';
import { DropdownMenu } from '../DropdownMenu.js';
import { CardError, DashboardCard, OutlineLink, PrimaryLink, Skeleton } from './DashboardCard.js';
import { formatCalendarDate } from './date-range.js';

const RECENT_LIMIT = 5;
const PENDING_LIMIT = 3;

const TONE = {
  positive: 'text-green-700',
  negative: 'text-red-700',
  neutral: 'text-slate-700',
} as const;

const matchOf = (bet: BetSummary) =>
  bet.events.length > 0 ? bet.events.join(' + ') : 'Sin partido';

const isFootball = (sport: string | undefined) =>
  !!sport && /^(f[uú]tbol|soccer|football)$/i.test(sport.trim());

/** Icono del deporte (no hay escudos ni banderas de equipos): balón para Fútbol. */
export function SportGlyph({
  bet,
  className = 'h-5 w-5',
}: {
  bet: BetSummary;
  className?: string;
}) {
  const sport = bet.sports[0];
  return (
    <span className="shrink-0 text-slate-500" title={sport ?? 'Deporte sin indicar'}>
      {isFootball(sport) ? (
        <SoccerBallIcon className={className} />
      ) : (
        <SportIcon className={className} />
      )}
    </span>
  );
}

/** Hora (HH:mm) de un instante en la zona del proyecto. */
const timeOf = (iso: string) => zonedParts(new Date(iso), getDisplayTimeZone()).time;

/** «Hoy, 19:00», «Ayer, 18:45» o «10 oct., 21:00», en la zona del proyecto. */
export function relativeMoment(iso: string, timeKnown: boolean): string {
  const day = zonedParts(new Date(iso)).date;
  const today = todayInZone();
  const label =
    day === today
      ? 'Hoy'
      : day === addCalendarDays(today, -1)
        ? 'Ayer'
        : formatCalendarDate(day, day.slice(0, 4) !== today.slice(0, 4));
  return timeKnown ? `${label}, ${timeOf(iso)}` : label;
}

/** «1X2 - Real Madrid»; en una Múltiple, «Múltiple · n selecciones». */
function typeOf(bet: BetSummary): string {
  if (!bet.headline) return `Múltiple · ${bet.events.length} selecciones`;
  const { market, selection } = bet.headline;
  return market ? `${market} - ${selection}` : selection;
}

function Profit({ bet }: { bet: BetSummary }) {
  if (bet.profitLoss === null) return <span className="text-slate-400">-</span>;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={`font-semibold tabular-nums ${TONE[signTone(bet.profitLoss)]}`}>
        {signedPEN(bet.profitLoss)}
      </span>
      {bet.returnSource === 'CALCULATED' && (
        <span
          className="text-[11px] text-orange-700"
          title="Retorno calculado por LetFer, sin confirmar con la casa"
        >
          provisional
        </span>
      )}
    </span>
  );
}

/**
 * Celda con su rótulo visible solo en móvil (en escritorio lo da la cabecera). `stacked`: rótulo
 * encima del valor (las tres cifras que comparten fila en móvil).
 */
function Cell({
  label,
  children,
  className = '',
  stacked = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  stacked?: boolean;
}) {
  return (
    <div
      className={`flex gap-2 @[44rem]:block ${
        stacked ? 'flex-col gap-0' : 'items-center justify-between'
      } ${className}`}
    >
      <span className="text-xs text-slate-500 @[44rem]:hidden">{label}</span>
      <span className="min-w-0 tabular-nums">{children}</span>
    </div>
  );
}

const COLUMNS =
  '@[44rem]:grid @[44rem]:grid-cols-[5.25rem_minmax(0,1fr)_4.75rem_2.75rem_6.25rem_5.25rem_1.75rem] @[60rem]:grid-cols-[5.25rem_minmax(0,1.7fr)_minmax(0,1.2fr)_4.75rem_2.75rem_6.25rem_5.25rem_1.75rem] @[44rem]:items-center @[44rem]:gap-2.5';

/**
 * Apuestas recientes: las cinco últimas por fecha de colocación (como ordena la API). Solo el
 * partido y el menú ⋮ son interactivos; el resto de acciones sigue en «Apuestas».
 */
export function RecentBets({
  bets,
  projectPath,
  addBetPath,
  className = '',
}: {
  bets: Loaded<BetSummary[]>;
  projectPath: string;
  addBetPath: string | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const recent = bets.data?.slice(0, RECENT_LIMIT) ?? [];

  return (
    <DashboardCard
      title="Apuestas recientes"
      subtitle="Tus últimas apuestas registradas"
      icon={<ClockIcon />}
      action={<OutlineLink to={`${projectPath}/bets`}>Ver todas</OutlineLink>}
      className={className}
    >
      {bets.loading && !bets.data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Cargando las apuestas recientes…</span>
          {Array.from({ length: RECENT_LIMIT }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : !bets.data ? (
        <CardError
          message={bets.error ?? 'No se pudieron cargar las apuestas.'}
          onRetry={bets.reload}
        />
      ) : recent.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          <p>Todavía no hay apuestas. Registra la primera y la verás aquí.</p>
          {addBetPath && (
            <PrimaryLink to={addBetPath}>
              <PlusIcon className="h-4 w-4" /> Añadir apuesta
            </PrimaryLink>
          )}
        </div>
      ) : (
        <div className="-mx-1 @[44rem]:mx-0">
          <div
            className={`hidden rounded-lg bg-slate-100/60 px-3 py-2 text-xs text-slate-500 ${COLUMNS}`}
            aria-hidden="true"
          >
            <span>Fecha</span>
            <span>Partido</span>
            <span className="hidden @[60rem]:inline">Tipo</span>
            <span>Monto</span>
            <span>Cuota</span>
            <span>Resultado</span>
            <span>Ganancia</span>
            <span />
          </div>
          <ul aria-label="Apuestas recientes" className="divide-y divide-slate-200/70">
            {recent.map((bet) => (
              <li
                key={bet.id}
                className={`flex flex-col gap-1.5 rounded-lg px-3 py-3 text-sm transition-colors hover:bg-slate-100/50 @[44rem]:min-h-[52px] @[44rem]:py-1.5 ${COLUMNS}`}
              >
                <div className="flex items-start justify-between gap-2 @[44rem]:block">
                  <span className="text-xs leading-tight text-slate-700">
                    <span className="@[44rem]:block">
                      {formatCalendarDate(zonedParts(new Date(bet.placedAt)).date)}
                    </span>
                    <span className="text-slate-500 @[44rem]:block">
                      {' '}
                      {bet.placedTimeKnown ? timeOf(bet.placedAt) : 'hora desconocida'}
                    </span>
                  </span>
                  <span className="@[44rem]:hidden">
                    <BetStatusBadge status={bet.status} variant="pill" />
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-2.5">
                  <SportGlyph bet={bet} />
                  <Link
                    to={`${projectPath}/bets/${bet.id}`}
                    title={matchOf(bet)}
                    className="min-w-0 truncate font-medium text-slate-900 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-violet-500"
                  >
                    {matchOf(bet)}
                  </Link>
                </div>
                {/* «Tipo» solo cuando hay sitio de verdad; en móvil va como línea propia. */}
                <Cell label="Tipo" className="min-w-0 @[44rem]:hidden @[60rem]:block">
                  <span className="block truncate text-xs text-slate-600" title={typeOf(bet)}>
                    {typeOf(bet)}
                  </span>
                </Cell>
                {/* En móvil, monto, cuota y ganancia en una sola fila; en la tabla, celdas propias. */}
                <div className="grid grid-cols-3 gap-2 @[44rem]:contents">
                  <Cell label="Monto" stacked>
                    {formatPEN(bet.effectiveAmount)}
                  </Cell>
                  <Cell label="Cuota" stacked>
                    {formatOdds(bet.visibleTotalOdds)}
                  </Cell>
                  <div className="hidden @[44rem]:block">
                    <BetStatusBadge status={bet.status} variant="pill" />
                  </div>
                  <Cell label="Ganancia" stacked>
                    <Profit bet={bet} />
                  </Cell>
                </div>
                <div className="hidden justify-end @[44rem]:flex">
                  <DropdownMenu
                    label={`Más acciones de ${matchOf(bet)}`}
                    buttonContent={<DotsIcon className="h-4 w-4" />}
                    buttonClassName="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-violet-500"
                    items={[
                      {
                        label: 'Ver detalle',
                        onSelect: () => void navigate(`${projectPath}/bets/${bet.id}`),
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}

/**
 * Apuestas pendientes: las tres más recientes, con su casa y la fecha de colocación. El total de la
 * insignia es el conteo de `/dashboard/status` (o el de la lista, si aún no llegó).
 */
export function PendingBets({
  bets,
  pendingTotal,
  projectPath,
}: {
  bets: Loaded<BetSummary[]>;
  pendingTotal: number | null;
  projectPath: string;
}) {
  const pending = (bets.data ?? []).filter((bet) => bet.status === 'PENDING');
  const total = pendingTotal ?? (bets.data ? pending.length : null);

  return (
    <DashboardCard
      title="Apuestas pendientes"
      icon={<HourglassIcon />}
      titleExtra={
        total !== null && (
          <span
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-700 tabular-nums"
            aria-label={`${total} pendientes`}
          >
            {total}
          </span>
        )
      }
      action={<OutlineLink to={`${projectPath}/bets?estado=PENDING`}>Ver todos</OutlineLink>}
    >
      {bets.loading && !bets.data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Cargando las apuestas pendientes…</span>
          {Array.from({ length: PENDING_LIMIT }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !bets.data ? (
        <CardError
          message={bets.error ?? 'No se pudieron cargar las apuestas.'}
          onRetry={bets.reload}
        />
      ) : pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          No tienes apuestas pendientes.
        </p>
      ) : (
        <ul aria-label="Apuestas pendientes" className="-my-1 divide-y divide-slate-200/70">
          {pending.slice(0, PENDING_LIMIT).map((bet) => (
            <li key={bet.id} className="flex items-center gap-3 py-2">
              <SportGlyph bet={bet} />
              <div className="min-w-0 flex-1">
                <Link
                  to={`${projectPath}/bets/${bet.id}`}
                  title={matchOf(bet)}
                  className="block truncate text-sm font-semibold text-slate-900 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-violet-500"
                >
                  {matchOf(bet)}
                </Link>
                <p className="truncate text-xs text-slate-500">
                  {[bet.sports[0], bet.houseName].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-600 tabular-nums">
                {relativeMoment(bet.placedAt, bet.placedTimeKnown)}
              </span>
              <BetStatusBadge status="PENDING" variant="pill" />
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
