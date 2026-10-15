import { formatOdds, formatPEN, sortReportBets, type ReportBet } from '@letfer/shared';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { signedPEN, signTone } from '../../../format.js';
import { ArrowRightIcon, ChevronDownIcon, DocumentIcon } from '../../../icons.js';
import { BET_TYPE_LABELS } from '../../../labels.js';
import { zonedParts } from '../../../time-zone.js';
import { BetStatusBadge } from '../BetStatusBadge.js';
import { CardError, Skeleton } from '../dashboard/DashboardCard.js';
import type { ReportOptions } from './report-query.js';

const PREVIEW_ROWS = 10;
const PAGE_ROWS = 50;
const TONE = {
  positive: 'text-green-700',
  negative: 'text-red-700',
  neutral: 'text-slate-600',
} as const;
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const dmy = (iso: string) => {
  const { date, time } = zonedParts(new Date(iso));
  return { date: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`, time };
};

/** «1X2 - Real Madrid», «Creada · 2 pronósticos» o «Múltiple · 4 selecciones». */
function pickOf(b: ReportBet): string {
  if (b.legs.length > 1) return `${BET_TYPE_LABELS[b.betType]} · ${b.legs.length} selecciones`;
  const conds = b.legs[0]?.conditions ?? [];
  if (conds.length > 1) return `Creada · ${conds.length} pronósticos`;
  const c = conds[0];
  return c ? (c.market ? `${c.market} - ${c.selection}` : c.selection) : '—';
}

/**
 * Apuestas incluidas en el reporte (§108.11): las mismas que irán al PDF, en el mismo orden
 * (`sortReportBets`). Muestra 10 de vista previa; «Ver todas» despliega el resto. Las Múltiples y
 * Creadas se abren para ver sus legs (cuota una vez por leg) y condiciones.
 */
export function ReportBetsTable({
  bets,
  loading,
  error,
  onRetry,
  options,
  onSort,
  projectPath,
}: {
  bets: readonly ReportBet[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  options: ReportOptions;
  onSort: (sortBy: ReportOptions['sortBy']) => void;
  projectPath: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(PAGE_ROWS);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const sorted = bets ? sortReportBets(bets, options.sortBy, options.direction) : [];
  const visible = showAll ? sorted.slice(0, limit) : sorted.slice(0, PREVIEW_ROWS);

  const sortButton = (label: string, key: ReportOptions['sortBy'], align = 'text-left') => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={`inline-flex items-center gap-1 ${align} hover:text-slate-900 ${focusRing}`}
      aria-label={`Ordenar por ${label.toLowerCase()}`}
    >
      {label}
      <span
        className={options.sortBy === key ? 'text-violet-600' : 'text-slate-400'}
        aria-hidden="true"
      >
        {options.sortBy === key ? (options.direction === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  );

  return (
    <section
      aria-labelledby="report-bets-title"
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200/70 bg-surface p-4 shadow-sm @[40rem]:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
            aria-hidden="true"
          >
            <DocumentIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="report-bets-title" className="text-[0.9375rem] font-semibold text-slate-900">
              Apuestas incluidas en el reporte
            </h2>
            <p className="text-xs text-slate-500">
              {showAll
                ? 'Todas las apuestas que se incluirán en el PDF.'
                : `Vista previa de las apuestas que se incluirán en el PDF (máx. ${PREVIEW_ROWS} mostradas).`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {bets && (
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800 tabular-nums">
              {bets.length} {bets.length === 1 ? 'apuesta seleccionada' : 'apuestas seleccionadas'}
            </span>
          )}
          {bets && bets.length > PREVIEW_ROWS && (
            <button
              type="button"
              onClick={() => {
                setShowAll(!showAll);
                setLimit(PAGE_ROWS);
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:border-violet-300 hover:text-violet-700 ${focusRing}`}
            >
              {showAll ? 'Ver menos' : 'Ver todas'} <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading && !bets ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Cargando las apuestas del reporte…</span>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error && !bets ? (
        <CardError message={error} onRetry={onRetry} />
      ) : bets && bets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          No hay apuestas con estos filtros. El PDF se generará igualmente, indicando que el periodo
          no tiene apuestas.
        </p>
      ) : (
        <div className={`-mx-1 overflow-x-auto px-1 ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full min-w-[46rem] text-[0.8125rem]">
            <thead>
              <tr className="bg-slate-100/60 text-left text-xs text-slate-500">
                <th className="w-10 rounded-l-lg px-3 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{sortButton('Fecha', 'date')}</th>
                <th className="px-2 py-2 font-medium">Partido</th>
                <th className="px-2 py-2 font-medium">Casa</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 text-right font-medium">
                  {sortButton('Monto', 'amount')}
                </th>
                <th className="px-2 py-2 text-right font-medium">{sortButton('Cuota', 'odds')}</th>
                <th className="px-2 py-2 font-medium">Resultado</th>
                <th className="rounded-r-lg px-3 py-2 text-right font-medium">
                  {sortButton('Ganancia', 'profit')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {visible.map((b, i) => {
                const when = dmy(b.placedAt);
                const match = b.legs.map((l) => l.event).join(' + ') || 'Sin partido';
                const expandable = b.legs.length > 1 || (b.legs[0]?.conditions.length ?? 0) > 1;
                const isOpen = open.has(b.id);
                return (
                  <Fragment key={b.id}>
                    <tr className="transition-colors hover:bg-slate-100/40">
                      <td className="px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums text-slate-700">
                        {when.date}{' '}
                        <span className="text-slate-500">{b.placedTimeKnown ? when.time : ''}</span>
                      </td>
                      <td className="max-w-[18rem] px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          {expandable && (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Ocultar' : 'Ver'} selecciones de ${match}`}
                              onClick={() =>
                                setOpen((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(b.id)) next.delete(b.id);
                                  else next.add(b.id);
                                  return next;
                                })
                              }
                              className={`shrink-0 rounded text-slate-500 hover:text-violet-700 ${focusRing}`}
                            >
                              <ChevronDownIcon
                                className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                              />
                            </button>
                          )}
                          <Link
                            to={`${projectPath}/bets/${b.id}`}
                            title={match}
                            className={`truncate font-medium text-slate-900 hover:text-violet-700 ${focusRing}`}
                          >
                            {match}
                          </Link>
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{b.houseName}</td>
                      <td
                        className="max-w-[12rem] truncate px-2 py-2 text-slate-600"
                        title={pickOf(b)}
                      >
                        {pickOf(b)}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                        {formatPEN(b.amount)}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={
                          b.totalOddsSource === 'CALCULATED'
                            ? 'Cuota calculada por LetFer (referencia, no oficial)'
                            : undefined
                        }
                      >
                        {formatOdds(b.visibleTotalOdds)}
                        {b.totalOddsSource === 'CALCULATED' && (
                          <span className="ml-1 text-[10px] text-slate-500">calc.</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <BetStatusBadge status={b.status} variant="pill" />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums ${TONE[signTone(b.profitLoss)]}`}
                      >
                        {b.profitLoss === null ? '-' : signedPEN(b.profitLoss)}
                        {b.provisional && (
                          <span className="block text-[10px] font-normal text-orange-700">
                            provisional
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-100/30">
                        <td />
                        <td colSpan={8} className="px-2 pb-3">
                          <ol className="flex flex-col gap-1.5 text-xs">
                            {b.legs.map((leg, li) => (
                              <li
                                key={li}
                                className="rounded-lg border border-slate-200/70 bg-surface-2 px-3 py-2"
                              >
                                <p className="flex items-center justify-between gap-3 font-semibold text-slate-900">
                                  <span>
                                    {b.legs.length > 1 ? `${li + 1}. ` : ''}
                                    {leg.event}
                                  </span>
                                  {leg.odds !== null && (
                                    <span className="text-violet-700 tabular-nums">
                                      @ {formatOdds(leg.odds)}
                                    </span>
                                  )}
                                </p>
                                <ul className="mt-0.5 text-slate-600">
                                  {leg.conditions.map((c, ci) => (
                                    <li key={ci}>
                                      {leg.conditions.length > 1 ? '· ' : ''}
                                      {c.selection}
                                      {c.market ? ` (${c.market})` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {showAll && sorted.length > limit && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit(limit + PAGE_ROWS)}
                className={`h-9 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:border-violet-300 ${focusRing}`}
              >
                Mostrar {Math.min(PAGE_ROWS, sorted.length - limit)} más ({limit} de {sorted.length}
                )
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
