import { Link } from 'react-router';
import { betsApi } from '../../api/bets.js';
import { dashboardApi } from '../../api/dashboard.js';
import { useLoad } from '../../hooks/useLoad.js';
import { AlertIcon, PlusIcon } from '../../icons.js';
import { Notice } from '../../ui.js';
import { BetStatusDonut } from './dashboard/BetStatusDonut.js';
import { PendingBets, RecentBets } from './dashboard/BetLists.js';
import { CapitalChart } from './dashboard/CapitalChart.js';
import { PrimaryLink } from './dashboard/DashboardCard.js';
import { GettingStarted } from './dashboard/GettingStarted.js';
import { KpiCards } from './dashboard/KpiCards.js';
import {
  HousesCard,
  ProjectInfoCard,
  QUICK_ACTION_ICONS,
  QuickActions,
  SportsCard,
  type QuickAction,
} from './dashboard/OverviewCards.js';
import { useProject } from './ProjectContext.js';

/**
 * Etiqueta de agrupación conceptual (Fase 11, §10.4): no es una tarjeta más, solo un rótulo
 * discreto — el mismo tratamiento que ya usa la navegación del proyecto para sus grupos — para
 * que el Dashboard se lea como "Rendimiento", "Apuestas" y "Actividad" en vez de once tarjetas
 * sueltas una debajo de otra sin ninguna relación visible entre ellas.
 */
function GroupLabel({ children }: { children: string }) {
  return (
    <p className="mt-2 px-1 text-xs font-medium tracking-wide text-slate-400 uppercase">
      {children}
    </p>
  );
}

/**
 * Dashboard del proyecto (§33, §34, §108; rediseño de la Fase 10.3): el estado financiero de un
 * vistazo, la evolución del capital, el estado de las apuestas, las recientes y las pendientes, las
 * casas, los deportes y los accesos directos. Solo presenta datos de la API (`/dashboard/status`,
 * `/dashboard/analysis` sin filtros, `/dashboard/bankroll-chart` y la lista de apuestas): no calcula
 * ninguna regla financiera. El análisis con filtros y el drawdown están en "Reportes".
 */
export function DashboardPage() {
  const { project, can } = useProject();

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-slate-500">
            ¿Cómo estás ahora? El dinero de {project.name}, tus apuestas y lo que queda por hacer.
          </p>
        </div>
        {project.setupComplete && can('bets.create') && (
          <PrimaryLink to={`/projects/${project.id}/bets?nueva=1`}>
            <PlusIcon className="h-4 w-4" /> Añadir apuesta
          </PrimaryLink>
        )}
      </div>
      {!project.setupComplete && (
        <GettingStarted
          projectId={project.id}
          setupComplete={false}
          counts={null}
          canSetup={can('project.setup')}
          canCreateBet={can('bets.create')}
          canSettle={can('bets.settle')}
        />
      )}
      {!project.setupComplete ? null : !can('bets.view') ? (
        <Notice tone="info">Tu rol no incluye la consulta de apuestas ni de métricas.</Notice>
      ) : (
        <DashboardContent />
      )}
      <GroupLabel>Accesos</GroupLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <QuickActions actions={quickActions(project.id, project.setupComplete, can)} />
        <ProjectInfoCard project={project} />
      </div>
    </>
  );
}

function quickActions(
  projectId: string,
  setupComplete: boolean,
  can: ReturnType<typeof useProject>['can'],
): QuickAction[] {
  const base = `/projects/${projectId}`;
  const actions: QuickAction[] = [];
  if (setupComplete && can('bets.create')) {
    actions.push({
      to: `${base}/bets?nueva=1`,
      title: 'Añadir apuesta',
      text: 'Registrar una apuesta, pendiente o ya liquidada',
      icon: QUICK_ACTION_ICONS.addBet,
    });
  }
  if (setupComplete && can('import.run')) {
    actions.push({
      to: `${base}/imports/new`,
      title: 'Importar apuestas',
      text: 'Subir el historial de una casa (.xlsx)',
      icon: QUICK_ACTION_ICONS.import,
    });
  }
  if (can('bets.view')) {
    actions.push({
      to: `${base}/reports`,
      title: 'Ver reportes',
      text: 'P/L, Yield, ROI y drawdown con filtros',
      icon: QUICK_ACTION_ICONS.reports,
    });
  }
  actions.push({
    to: `${base}/finance`,
    title: 'Gestionar casas',
    text: 'Saldos, movimientos, retiros y conciliación',
    icon: QUICK_ACTION_ICONS.houses,
  });
  return actions;
}

/** Secciones con datos: solo se montan (y piden sus datos) con el setup completo y `bets.view`. */
function DashboardContent() {
  const { project, can } = useProject();
  const status = useLoad(`dashboard-status:${project.id}`, () => dashboardApi.status(project.id));
  const analysis = useLoad(`dashboard-overview-analysis:${project.id}`, () =>
    dashboardApi.analysis(project.id),
  );
  const bankroll = useLoad(`dashboard-bankroll:${project.id}`, () =>
    dashboardApi.bankrollChart(project.id),
  );
  const bets = useLoad(`dashboard-bets:${project.id}`, () => betsApi.list(project.id));

  const base = `/projects/${project.id}`;
  const addBetPath = can('bets.create') ? `${base}/bets?nueva=1` : null;
  const pendingReturns = status.data?.retornosPorConfirmar ?? 0;

  return (
    <>
      <GettingStarted
        projectId={project.id}
        setupComplete
        counts={status.data?.conteoApuestas ?? null}
        canSetup={can('project.setup')}
        canCreateBet={can('bets.create')}
        canSettle={can('bets.settle')}
      />
      {pendingReturns > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"
        >
          <AlertIcon className="h-5 w-5 shrink-0 text-orange-600" />
          <p className="min-w-0 flex-1">
            <strong>
              Hay {pendingReturns} {pendingReturns === 1 ? 'apuesta ganada' : 'apuestas ganadas'}{' '}
              con retorno calculado, sin confirmar.
            </strong>{' '}
            Ya cuentan en la ganancia, el Yield y el ROI con su valor calculado, pero son
            provisionales hasta confirmar el retorno oficial.
          </p>
          <Link
            to={`${base}/returns`}
            className="w-full pl-8 font-medium underline sm:w-auto sm:pl-0"
          >
            Ver retornos por confirmar
          </Link>
        </div>
      )}

      <KpiCards status={status} analysis={analysis} />

      <GroupLabel>Rendimiento</GroupLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <CapitalChart bankroll={bankroll} />
        <BetStatusDonut status={status} addBetPath={addBetPath} />
      </div>

      <GroupLabel>Apuestas</GroupLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <RecentBets bets={bets} betsPath={`${base}/bets`} addBetPath={addBetPath} />
        <PendingBets bets={bets} betsPath={`${base}/bets`} />
      </div>

      <GroupLabel>Actividad</GroupLabel>
      <div className="grid gap-4 md:grid-cols-2">
        <HousesCard status={status} financePath={`${base}/finance`} />
        <SportsCard analysis={analysis} />
      </div>
    </>
  );
}
