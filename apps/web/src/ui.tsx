import type { InvitationStatus, ProjectStatus } from '@letfer/shared';
import type { ReactNode } from 'react';
import { INVITATION_STATUS_LABELS, PROJECT_STATUS_LABELS } from './labels.js';

export const inputClass = 'w-full rounded border border-slate-300 px-3 py-2';
export const btn = 'rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50';
export const btnPrimary =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';
export const btnDanger =
  'rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';

const BADGE_TONES = {
  green: 'bg-green-100 text-green-800',
  slate: 'bg-slate-200 text-slate-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
} as const;

export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
}) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

const PROJECT_TONES: Record<ProjectStatus, keyof typeof BADGE_TONES> = {
  ACTIVE: 'green',
  CLOSED: 'amber',
  TRASHED: 'red',
};

export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => (
  <Badge tone={PROJECT_TONES[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>
);

const INVITATION_TONES: Record<InvitationStatus, keyof typeof BADGE_TONES> = {
  ACTIVE: 'green',
  ACCEPTED: 'blue',
  EXPIRED: 'amber',
  DISABLED: 'red',
};

export const InvitationStatusBadge = ({ status }: { status: InvitationStatus }) => (
  <Badge tone={INVITATION_TONES[status]}>{INVITATION_STATUS_LABELS[status]}</Badge>
);

export function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const classes = {
    error: 'border-red-300 bg-red-50 text-red-800',
    success: 'border-green-300 bg-green-50 text-green-800',
    info: 'border-slate-300 bg-slate-50 text-slate-700',
  }[tone];
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded border p-3 text-sm ${classes}`}
    >
      {children}
    </p>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
