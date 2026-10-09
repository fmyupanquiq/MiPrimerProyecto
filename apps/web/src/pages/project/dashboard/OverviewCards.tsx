import {
  formatPEN,
  type DashboardAnalysis,
  type DashboardStatus,
  type ProjectDetail,
} from '@letfer/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Loaded } from '../../../hooks/useLoad.js';
import {
  ArrowRightIcon,
  BankIcon,
  ChartIcon,
  PlusIcon,
  TicketIcon,
  UploadIcon,
} from '../../../icons.js';
import { DATE_FORMAT_LABELS, formatDate, roleLabel } from '../../../labels.js';
import {
  CardLink,
  DashboardCard,
  EmptyState,
  LoadingBlock,
  SectionError,
} from './DashboardCard.js';

const HOUSES_LIMIT = 5;
const SPORTS_LIMIT = 6;

/** Porcentaje solo para mostrar, con un decimal como máximo. */
const percentOf = (part: number, total: number) =>
  total <= 0 ? 0 : Math.round((part / total) * 1000) / 10;

/** Saldo de cada casa (§33, §92), de `GET /dashboard/status`, de mayor a menor. */
export function HousesCard({
  status,
  financePath,
}: {
  status: Loaded<DashboardStatus>;
  financePath: string;
}) {
  const houses = [...(status.data?.porCasa ?? [])].sort(
    (a, b) => Number(b.balance) - Number(a.balance),
  );
  const capital = Number(status.data?.capitalActual ?? '0');

  return (
    <DashboardCard
      title="Casas de apuestas"
      description={
        status.data
          ? `Saldo de ${houses.length} ${houses.length === 1 ? 'casa' : 'casas'}`
          : undefined
      }
      action={<CardLink to={financePath}>Ver todas</CardLink>}
    >
      {status.loading && !status.data ? (
        <LoadingBlock lines={3} label="Cargando las casas…" />
      ) : !status.data ? (
        <SectionError message={status.error ?? 'No se pudieron cargar las casas.'} />
      ) : houses.length === 0 ? (
        <EmptyState
          icon={<BankIcon />}
          title="Sin casas de apuestas"
          text="Añade una casa en Casas y Finanzas para registrar su saldo y sus apuestas."
        />
      ) : (
        <ul aria-label="Saldo por casa" className="flex flex-col gap-3">
          {houses.slice(0, HOUSES_LIMIT).map((house) => {
            const weight = percentOf(Number(house.balance), capital);
            return (
              <li key={house.houseId} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-sm font-semibold text-violet-700"
                    aria-hidden="true"
                  >
                    {house.houseName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{house.houseName}</p>
                    <p className="text-xs text-slate-500">
                      Disponible {formatPEN(house.available)}
                      {house.committed !== '0.00' &&
                        ` · Comprometido ${formatPEN(house.committed)}`}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatPEN(house.balance)}</span>
                </div>
                {capital > 0 && (
                  <div className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
                    <div
                      className="h-1.5 rounded-full bg-violet-500"
                      style={{ width: `${Math.max(0, Math.min(100, weight))}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
          {houses.length > HOUSES_LIMIT && (
            <li className="text-xs text-slate-500">
              Y {houses.length - HOUSES_LIMIT} más en Casas y Finanzas.
            </li>
          )}
        </ul>
      )}
    </DashboardCard>
  );
}

/**
 * Deportes más jugados: el desglose por deporte de `GET /dashboard/analysis` (§108.5), que cuenta
 * las apuestas liquidadas; una múltiple con deportes distintos cuenta como "Mixto" (D-M4).
 */
export function SportsCard({ analysis }: { analysis: Loaded<DashboardAnalysis> }) {
  const sports = [...(analysis.data?.bySport ?? [])].sort((a, b) => b.count - a.count);
  const total = sports.reduce((sum, item) => sum + item.count, 0);

  return (
    <DashboardCard title="Deportes más jugados" description="Según las apuestas liquidadas">
      {analysis.loading && !analysis.data ? (
        <LoadingBlock lines={3} label="Cargando los deportes…" />
      ) : !analysis.data ? (
        <SectionError message={analysis.error ?? 'No se pudieron cargar los deportes.'} />
      ) : sports.length === 0 ? (
        <EmptyState
          icon={<ChartIcon />}
          title="Aún no hay datos suficientes"
          text="Cuando liquides apuestas verás aquí en qué deportes se concentra la actividad."
        />
      ) : (
        <ul aria-label="Apuestas liquidadas por deporte" className="flex flex-col gap-3">
          {sports.slice(0, SPORTS_LIMIT).map((item) => {
            const pct = percentOf(item.count, total);
            return (
              <li key={item.key} className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{item.key}</span>
                  <span className="tabular-nums text-slate-600">
                    <strong className="text-slate-900">{item.count}</strong>{' '}
                    <span className="text-xs">({pct} %)</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

export interface QuickAction {
  to: string;
  title: string;
  text: string;
  icon: ReactNode;
}

/** Accesos directos a las tareas habituales; solo los que la persona puede hacer. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DashboardCard
      title="Acciones rápidas"
      description="Lo más habitual, a un clic"
      className="lg:col-span-2"
    >
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Acciones rápidas">
        {actions.map((action) => (
          <li key={action.to}>
            <Link
              to={action.to}
              className="group flex h-full items-center gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-violet-300 hover:bg-violet-50/50 focus-visible:outline-2 focus-visible:outline-violet-500"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                {action.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-900">{action.title}</span>
                <span className="block text-xs text-slate-500">{action.text}</span>
              </span>
              <ArrowRightIcon className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-violet-600" />
            </Link>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

export const QUICK_ACTION_ICONS = {
  addBet: <PlusIcon />,
  import: <UploadIcon />,
  reports: <ChartIcon />,
  houses: <BankIcon />,
  bets: <TicketIcon />,
};

/** Datos del proyecto (los que antes mostraba "Resumen"); se editan en Configuración. */
export function ProjectInfoCard({ project }: { project: ProjectDetail }) {
  return (
    <DashboardCard title="Sobre el proyecto">
      {project.description ? (
        <p className="whitespace-pre-line text-sm text-slate-700">{project.description}</p>
      ) : (
        <p className="text-sm text-slate-500">Este proyecto todavía no tiene descripción.</p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Propietario</dt>
          <dd>{project.ownerName}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Tu rol</dt>
          <dd>
            {project.isOwner && 'Propietario · '}
            {project.myRole ? roleLabel(project.myRole) : 'Acceso como administrador global'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Moneda</dt>
          <dd>{project.currency}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Zona horaria</dt>
          <dd>{project.timezone}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Formato de fecha</dt>
          <dd>{DATE_FORMAT_LABELS[project.dateFormat]}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Creado</dt>
          <dd>{formatDate(project.createdAt)}</dd>
        </div>
      </dl>
    </DashboardCard>
  );
}
