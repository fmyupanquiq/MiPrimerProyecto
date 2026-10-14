import type { ReactNode } from 'react';

/** Tarjeta de sección del asistente "Añadir apuesta": icono violeta, título y un extremo opcional. */
export function WizardCard({
  icon,
  title,
  aside,
  ariaLabel,
  children,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className={`flex flex-col gap-2 rounded-xl border border-slate-200 bg-surface px-3 py-2.5 sm:px-4 ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-300/50 [&>svg]:h-[18px] [&>svg]:w-[18px]"
            aria-hidden="true"
          >
            {icon}
          </span>
          <h4 className="text-[0.98rem] font-semibold text-slate-900">{title}</h4>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
