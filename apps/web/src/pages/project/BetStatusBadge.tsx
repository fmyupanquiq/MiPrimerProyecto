import type { BetStatus } from '@letfer/shared';
import type { ReactNode } from 'react';
import { BanIcon, CheckCircleIcon, ClockIcon, CoinsIcon, XCircleIcon } from '../../icons.js';
import { BET_STATUS_LABELS } from '../../labels.js';
import { BET_STATUS_SOFT } from './bet-status-style.js';

/** Icono de cada estado: el estado nunca se distingue solo por el color. */
export function betStatusIcon(status: BetStatus, className = 'h-3.5 w-3.5'): ReactNode {
  switch (status) {
    case 'PENDING':
      return <ClockIcon className={className} />;
    case 'WON':
      return <CheckCircleIcon className={className} />;
    case 'LOST':
      return <XCircleIcon className={className} />;
    case 'VOID':
      return <BanIcon className={className} />;
    case 'CASHOUT':
      return <CoinsIcon className={className} />;
  }
}

/** Insignia de estado de una apuesta: texto + icono + color. */
export function BetStatusBadge({ status }: { status: BetStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${BET_STATUS_SOFT[status]}`}
    >
      {betStatusIcon(status)}
      {BET_STATUS_LABELS[status]}
    </span>
  );
}
