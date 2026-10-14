import type { ReactNode } from 'react';

/** Tono del cuadro de icono de una tarjeta: violeta (por defecto), azul (manual), ámbar (aviso). */
export type CardTone = 'violet' | 'blue' | 'amber' | 'green' | 'slate';

const ICON_TONES: Record<CardTone, string> = {
  violet: 'bg-violet-100 text-violet-700 ring-violet-300/50',
  blue: 'bg-blue-100 text-blue-700 ring-blue-300/50',
  amber: 'bg-amber-100 text-amber-700 ring-amber-300/50',
  green: 'bg-green-100 text-green-700 ring-green-300/50',
  slate: 'bg-slate-100 text-slate-600 ring-slate-300/50',
};

/** Cuadro de icono de cabecera (36 px por defecto) con el tono de la tarjeta. */
export function CardIcon({
  icon,
  tone = 'violet',
  size = 'md',
}: {
  icon: ReactNode;
  tone?: CardTone;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'lg'
      ? 'h-11 w-11 [&>svg]:h-[22px] [&>svg]:w-[22px]'
      : size === 'sm'
        ? 'h-8 w-8 [&>svg]:h-[18px] [&>svg]:w-[18px]'
        : 'h-9 w-9 [&>svg]:h-[19px] [&>svg]:w-[19px]';
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg ring-1 ${box} ${ICON_TONES[tone]}`}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

/**
 * Tarjeta de sección del asistente "Añadir apuesta": cuadro de icono, título, descripción opcional y
 * un extremo derecho opcional (insignia, nota o botón). Todas las tarjetas del asistente comparten esta
 * cabecera; `dense` es la versión compacta de "Verificar datos", que debe caber sin desplazarse.
 */
export function WizardCard({
  icon,
  title,
  description,
  aside,
  ariaLabel,
  children,
  className = '',
  tone = 'violet',
  dense = false,
  compact = false,
  headingId,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
  tone?: CardTone;
  dense?: boolean;
  /** Columna estrecha: título más pequeño y cabecera en una sola línea (insignia/botón a la derecha). */
  compact?: boolean;
  headingId?: string;
}) {
  return (
    <section
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className={`flex flex-col rounded-xl border border-slate-200 bg-surface ${
        dense ? 'gap-2 px-3 py-2.5 sm:px-4' : 'gap-3 p-4'
      } ${className}`}
    >
      <header
        className={`flex items-center justify-between gap-x-3 gap-y-2 ${compact ? '' : 'flex-wrap'}`}
      >
        <div
          className={`flex min-w-0 ${compact ? 'gap-2.5' : 'gap-3'} ${description ? 'items-start' : 'items-center'}`}
        >
          <CardIcon icon={icon} tone={tone} size={dense || compact ? 'sm' : 'md'} />
          <div className="min-w-0">
            <h4
              id={headingId}
              className={`leading-snug font-semibold text-slate-900 ${
                compact ? 'truncate text-[0.88rem]' : 'text-[0.98rem]'
              }`}
            >
              {title}
            </h4>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
