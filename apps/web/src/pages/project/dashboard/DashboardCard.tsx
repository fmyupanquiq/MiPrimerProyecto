import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRightIcon } from '../../../icons.js';

/**
 * Tarjeta del Dashboard (rediseño 2026-10-15): la misma cabecera en todas — cuadro de icono violeta
 * de 36 px, título, subtítulo opcional y, a la derecha, los controles de la tarjeta. Es una
 * `<section>` con su título como nombre accesible. El resto de primitivos se reexporta para no
 * reescribir los imports de cada pieza.
 */
export function DashboardCard({
  title,
  subtitle,
  icon,
  titleExtra,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  /** Junto al título (p. ej. la insignia con el total de pendientes). */
  titleExtra?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-200/70 bg-surface p-5 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* El título cede (se trunca) antes que los controles: solo bajan de línea sin espacio. */}
        <div className="flex min-w-[11rem] flex-1 basis-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 [&>svg]:h-5 [&>svg]:w-5"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id={headingId} className="truncate text-base font-semibold text-slate-900">
                {title}
              </h2>
              {titleExtra}
            </div>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

/** Enlace con contorno de la cabecera de una tarjeta: «Ver todas →». */
export function OutlineLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700 ${focusRing}`}
    >
      {children}
      <ArrowRightIcon className="h-3.5 w-3.5" />
    </Link>
  );
}

/** Error de una tarjeta, con «Reintentar»: nunca tumba las demás. */
export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className={`rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium hover:bg-red-100 ${focusRing}`}
      >
        Reintentar
      </button>
    </div>
  );
}

export {
  CardLink,
  SectionError,
  PrimaryLink,
  EmptyState,
  LoadingBlock,
  Skeleton,
} from '../../../ui.js';
