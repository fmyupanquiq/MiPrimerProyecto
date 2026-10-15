import type { PermissionCode } from '@letfer/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BankIcon, BoltIcon, ClockIcon, PlusIcon, UploadIcon } from '../../../icons.js';
import { DashboardCard } from './DashboardCard.js';

export interface QuickAction {
  to: string;
  label: string;
  icon: ReactNode;
  primary?: boolean;
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

/**
 * Accesos directos (§4.5 del rediseño): solo los que la persona puede hacer. Los permisos de la web
 * solo mejoran la interfaz; la API vuelve a validar al usar cada pantalla.
 */
export function quickActions(
  projectId: string,
  setupComplete: boolean,
  can: (permission: PermissionCode) => boolean,
): QuickAction[] {
  const base = `/projects/${projectId}`;
  const actions: QuickAction[] = [];
  if (setupComplete && can('bets.create')) {
    actions.push({
      to: `${base}/bets?nueva=1`,
      label: 'Añadir apuesta',
      icon: <PlusIcon className="h-4 w-4" />,
      primary: true,
    });
  }
  if (setupComplete && can('import.run')) {
    actions.push({
      to: `${base}/imports/new`,
      label: 'Importar apuestas',
      icon: <UploadIcon className="h-4 w-4" />,
    });
  }
  if (can('bets.view')) {
    actions.push({
      to: `${base}/bets`,
      label: 'Ver historial',
      icon: <ClockIcon className="h-4 w-4" />,
    });
  }
  actions.push({
    to: `${base}/finance`,
    label: 'Gestionar casas',
    icon: <BankIcon className="h-4 w-4" />,
  });
  return actions;
}

/** Acciones rápidas: una fila de botones que se reparte el ancho (dos por fila si no caben). */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DashboardCard title="Acciones rápidas" icon={<BoltIcon />}>
      <div className="@container">
        <ul className="grid grid-cols-2 gap-2.5 @[30rem]:grid-cols-4" aria-label="Acciones rápidas">
          {actions.map((action) => (
            <li key={action.to} className="min-w-0">
              <Link
                to={action.to}
                className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium whitespace-nowrap transition-colors ${focusRing} ${
                  action.primary
                    ? 'bg-violet-600 text-white shadow-[0_0_18px_-6px_rgba(124,58,237,0.9)] hover:bg-violet-500'
                    : 'border border-slate-200 text-slate-700 hover:border-violet-300 hover:text-violet-700'
                }`}
              >
                {action.icon}
                <span className="truncate">{action.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </DashboardCard>
  );
}
