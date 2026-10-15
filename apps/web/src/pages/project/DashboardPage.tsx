import { formatPEN } from '@letfer/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { betsApi } from '../../api/bets.js';
import { dashboardApi } from '../../api/dashboard.js';
import { useLoad } from '../../hooks/useLoad.js';
import { AlertIcon, PlusIcon } from '../../icons.js';
import { todayInZone, zonedParts } from '../../time-zone.js';
import { Notice } from '../../ui.js';
import { PendingBets, RecentBets } from './dashboard/BetLists.js';
import { BetStatusDonut } from './dashboard/BetStatusDonut.js';
import { CapitalChart } from './dashboard/CapitalChart.js';
import { CapitalHero } from './dashboard/CapitalHero.js';
import {
  monthBounds,
  monthsBetween,
  rangeFilters,
  rangeFromSearch,
  rangeToSearch,
  type DateRange,
} from './dashboard/date-range.js';
import { DateRangePicker } from './dashboard/DateRangePicker.js';
import { GettingStarted } from './dashboard/GettingStarted.js';
import { MonthPerformance } from './dashboard/MonthPerformance.js';
import { quickActions, QuickActions } from './dashboard/QuickActions.js';
import { useProject } from './ProjectContext.js';

const addBetButton =
  'inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-[0_0_22px_-6px_rgba(124,58,237,0.95)] transition-colors hover:bg-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-safe:active:scale-[0.98]';

/**
 * Dashboard del proyecto (§33, §34, §108; rediseño de alta fidelidad 2026-10-15, §108.10, ADR 0015).
 * Solo presenta datos de la API (`/dashboard/status`, `/dashboard/analysis` sin filtros, del rango y
 * del mes, `/dashboard/bankroll-chart` y la lista de apuestas): ninguna cifra financiera se calcula
 * aquí. El rango de fechas vive en la URL (`?desde&hasta`, `?rango=todo`) para compartir y recargar.
 */
export function DashboardPage() {
  const { project, can } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  // Hoy en la zona del proyecto (la fija `ProjectLayout`), nunca la del navegador.
  const today = todayInZone();
  const range = rangeFromSearch(searchParams, today);
  const withData = project.setupComplete && can('bets.view');
  const actions = quickActions(project.id, project.setupComplete, can);

  const setRange = (next: DateRange) => setSearchParams(rangeToSearch(next, today));

  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-500">
            Aquí tienes un resumen de tu proyecto{' '}
            <span className="font-semibold text-slate-700">{project.name}</span>. El dinero, tus
            apuestas y lo que queda por hacer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {withData && <DateRangePicker value={range} today={today} onChange={setRange} />}
          {project.setupComplete && can('bets.create') && (
            <Link to={`/projects/${project.id}/bets?nueva=1`} className={addBetButton}>
              <PlusIcon className="h-4 w-4" /> Añadir apuesta
            </Link>
          )}
        </div>
      </div>
      {!project.setupComplete ? (
        <>
          <GettingStarted
            projectId={project.id}
            setupComplete={false}
            counts={null}
            canSetup={can('project.setup')}
            canCreateBet={can('bets.create')}
            canSettle={can('bets.settle')}
          />
          <QuickActions actions={actions} />
        </>
      ) : !can('bets.view') ? (
        <>
          <Notice tone="info">Tu rol no incluye la consulta de apuestas ni de métricas.</Notice>
          <QuickActions actions={actions} />
        </>
      ) : (
        <DashboardContent range={range} today={today} />
      )}
    </div>
  );
}

/** Secciones con datos: solo se montan (y piden sus datos) con el setup completo y `bets.view`. */
function DashboardContent({ range, today }: { range: DateRange; today: string }) {
  const { project, can } = useProject();
  const id = project.id;
  const filters = rangeFilters(range);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const monthFilters = rangeFilters({ preset: 'CUSTOM', ...monthBounds(month) });

  const status = useLoad(`dashboard-status:${id}`, () => dashboardApi.status(id));
  const overall = useLoad(`dashboard-overall:${id}`, () => dashboardApi.analysis(id));
  const ranged = useLoad(`dashboard-range:${id}:${filters.from ?? ''}:${filters.to ?? ''}`, () =>
    dashboardApi.analysis(id, filters),
  );
  const monthly = useLoad(`dashboard-month:${id}:${month}`, () =>
    dashboardApi.analysis(id, monthFilters),
  );
  const bankroll = useLoad(`dashboard-bankroll:${id}`, () => dashboardApi.bankrollChart(id));
  const bets = useLoad(`dashboard-bets:${id}`, () => betsApi.list(id));

  // Meses elegibles: desde el de la apuesta más antigua (la lista viene de la más reciente a la
  // más antigua) hasta el actual. Solo es una lista de opciones; las cifras las da la API.
  const months = useMemo(() => {
    const oldest = bets.data?.at(-1);
    const first = oldest ? zonedParts(new Date(oldest.placedAt)).date.slice(0, 7) : currentMonth;
    const list = monthsBetween(first < currentMonth ? first : currentMonth, currentMonth);
    return list.includes(month) ? list : [month, ...list];
  }, [bets.data, currentMonth, month]);

  const base = `/projects/${id}`;
  const addBetPath = can('bets.create') ? `${base}/bets?nueva=1` : null;
  const pendingReturns = status.data?.retornosPorConfirmar ?? 0;

  return (
    <>
      <GettingStarted
        projectId={id}
        setupComplete
        counts={status.data?.conteoApuestas ?? null}
        canSetup={can('project.setup')}
        canCreateBet={can('bets.create')}
        canSettle={can('bets.settle')}
      />
      {pendingReturns > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          <AlertIcon className="h-4.5 w-4.5 shrink-0 text-amber-700" />
          <p className="min-w-0 flex-1">
            <strong className="font-semibold">
              Hay {pendingReturns} {pendingReturns === 1 ? 'apuesta ganada' : 'apuestas ganadas'}{' '}
              con retorno calculado, sin confirmar
            </strong>
            {/* §112.6: cuántas y qué monto (la ganancia provisional, del análisis sin filtros). */}
            {overall.data && overall.data.unconfirmedReturns.count > 0 && (
              <>
                {' '}
                (ganancia provisional de {formatPEN(overall.data.unconfirmedReturns.profitLoss)})
              </>
            )}
            . Ya cuentan en la ganancia, el Yield y el ROI, pero son provisionales.
          </p>
          <Link
            to={`${base}/returns`}
            className="font-medium underline focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            Ver retornos por confirmar
          </Link>
        </div>
      )}

      <CapitalHero
        status={status}
        overall={overall}
        range={ranged}
        bankroll={bankroll}
        unitStake={project.activeStage?.unitStake ?? null}
      />

      <div className="grid gap-4 @[40rem]:grid-cols-2 @[72rem]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
        <CapitalChart bankroll={bankroll} className="@[40rem]:col-span-2 @[72rem]:col-span-1" />
        <BetStatusDonut status={status} range={ranged} addBetPath={addBetPath} />
        <MonthPerformance month={month} months={months} onMonth={setMonth} analysis={monthly} />
      </div>

      <div className="grid gap-4 @[72rem]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentBets bets={bets} projectPath={base} addBetPath={addBetPath} />
        <div className="grid content-start gap-4 @[40rem]:grid-cols-2 @[72rem]:grid-cols-1">
          <PendingBets
            bets={bets}
            pendingTotal={status.data?.conteoApuestas.pending ?? null}
            projectPath={base}
          />
          <QuickActions actions={quickActions(id, true, can)} />
        </div>
      </div>
    </>
  );
}
