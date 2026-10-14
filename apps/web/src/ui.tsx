import type { InvitationStatus, ProjectStatus } from '@letfer/shared';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertIcon, CheckCircleIcon, CloseIcon, HelpIcon, InfoIcon, XCircleIcon } from './icons.js';
import { INVITATION_STATUS_LABELS, PROJECT_STATUS_LABELS } from './labels.js';

/*
 * Sistema de diseño de LetFer (Fase 10.3). Las clases de botón y campo son cadenas para poder
 * usarlas en `<button>`, `<Link>` o `<a>` por igual; los colores salen de los tokens de
 * `index.css`, así que todo funciona en el tema claro y en el oscuro.
 */

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
// `min-h-10` (40px): la MISMA altura que `inputClass`, a propósito (Fase 11, §3) — un botón y un
// campo en la misma fila deben quedar perfectamente alineados, nunca con un botón más bajo.
// `active:scale-[0.98]` (Fase 11, §25): respuesta táctil sutil al pulsar; `motion-safe:` la
// omite por completo con `prefers-reduced-motion` en vez de solo acortarla a 0.01ms.
const buttonBase = `inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${focusRing}`;

/** Botón secundario (acción normal). */
export const btn = `${buttonBase} border border-slate-300 bg-surface text-slate-800 hover:bg-slate-100`;
/** Acción principal de la pantalla o del formulario (una por bloque). */
export const btnPrimary = `${buttonBase} bg-violet-600 text-white shadow-sm hover:bg-violet-500`;
/** Acción destructiva o irreversible. */
export const btnDanger = `${buttonBase} bg-red-600 text-white shadow-sm hover:bg-red-500`;
/** Acción terciaria, sin borde (cancelar, ver más). */
export const btnGhost = `${buttonBase} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
/** Botón de icono solo (editar, eliminar…): mismo alto, ancho fijo cuadrado. */
export const btnIcon = `${btn} w-10 px-0`;

export const inputClass =
  'min-h-10 w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

/** Rótulo de campo y su ayuda breve debajo. */
export const labelClass = 'flex flex-col gap-1.5 text-sm font-medium text-slate-800';
export const hintClass = 'text-xs font-normal text-slate-500';

/*
 * Escala tipográfica (Fase 11, §7): título/dato/rótulo/ayuda no deben pesar lo mismo. Cadenas de
 * clases para que cualquier pantalla use la MISMA jerarquía en vez de inventar un tamaño cada vez.
 */
/** Cifra protagonista de una pantalla (el capital del dashboard, el importe de un resumen). */
export const displayValueClass = 'text-4xl font-bold tracking-tight tabular-nums sm:text-5xl';
/** Cifra importante pero no protagonista (una métrica secundaria, el total de una tarjeta). */
export const metricValueClass = 'text-xl font-semibold tracking-tight tabular-nums';
/** Rótulo discreto encima de un dato (nunca compite con el dato). */
export const fieldLabelClass = 'text-xs font-medium text-slate-500';
/** Texto de apoyo, el más pequeño de la jerarquía. */
export const captionClass = 'text-xs text-slate-500';

/** Opción de un selector segmentado (p. ej. tipo de movimiento): activa en violeta. */
export const chipClass = (active: boolean) =>
  `${buttonBase} border ${
    active
      ? 'border-violet-600 bg-violet-600 text-white shadow-sm'
      : 'border-slate-300 bg-surface text-slate-700 hover:border-violet-400 hover:text-slate-900'
  }`;

/**
 * Control segmentado (Fase 11, §3, §6.2): un grupo de opciones excluyentes en una sola fila
 * compacta ("píldora" con una opción resaltada), el mismo patrón que ya usaban por separado el
 * periodo del gráfico de capital y el formato de apuesta — centralizado aquí para que cualquier
 * selector de este tipo se vea y se comporte exactamente igual en toda la aplicación.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className = '',
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; ariaLabel?: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex rounded-lg border border-slate-200 bg-surface-2 p-0.5 text-xs ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
          onClick={() => onChange(option.value)}
          // `min-w-10 justify-center` (Fase 11, §33): opciones de distinta longitud ("Todo" vs.
          // "7D") deben seguir viéndose como una fila pareja, no una más ancha que el resto.
          className={`flex min-h-8 min-w-10 items-center justify-center rounded-md px-2.5 py-1.5 font-medium transition-colors ${focusRing} ${
            value === option.value
              ? 'bg-surface text-violet-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const BADGE_TONES = {
  green: 'bg-green-50 text-green-700 ring-green-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
} as const;
export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = 'slate',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

const PROJECT_TONES: Record<ProjectStatus, BadgeTone> = {
  ACTIVE: 'green',
  CLOSED: 'amber',
  TRASHED: 'red',
};

export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => (
  <Badge tone={PROJECT_TONES[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>
);

const INVITATION_TONES: Record<InvitationStatus, BadgeTone> = {
  ACTIVE: 'green',
  ACCEPTED: 'blue',
  EXPIRED: 'amber',
  DISABLED: 'red',
};

export const InvitationStatusBadge = ({ status }: { status: InvitationStatus }) => (
  <Badge tone={INVITATION_TONES[status]}>{INVITATION_STATUS_LABELS[status]}</Badge>
);

const NOTICE_STYLES = {
  error: { box: 'border-red-200 bg-red-50 text-red-800', icon: <XCircleIcon /> },
  success: { box: 'border-green-200 bg-green-50 text-green-800', icon: <CheckCircleIcon /> },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: <AlertIcon /> },
  info: { box: 'border-slate-200 bg-slate-100/60 text-slate-700', icon: <InfoIcon /> },
} as const;

/** Aviso en línea. Los errores se anuncian (`alert`); el resto, como estado (`status`). */
export function Notice({
  tone,
  action,
  children,
}: {
  tone: keyof typeof NOTICE_STYLES;
  /** Acción asociada al aviso (p. ej. "Completar configuración"): debajo del texto. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const style = NOTICE_STYLES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-start gap-2.5 rounded-xl border p-3 text-sm ${style.box}`}
    >
      <span className="mt-px shrink-0 [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </div>
  );
}

/**
 * Única tarjeta con título de LetFer (Fase 11, §5): antes existían `Section` (aquí) y
 * `DashboardCard` (duplicado en el dashboard) con el mismo aspecto y un padding ligeramente
 * distinto. Un solo primitivo, usado en toda la aplicación — de Finanzas a Reportes al Dashboard.
 */
export function Section({
  title,
  description,
  action,
  children,
  className = '',
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Para anclar la sección desde un `SubNav` (p. ej. `href="#id"`); no es el id del título. */
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Enlace secundario de la cabecera de una tarjeta ("Ver todas"). */
export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`rounded-md text-sm font-medium text-violet-700 hover:text-violet-900 ${focusRing}`}
    >
      {children}
    </Link>
  );
}

/** Error de una sección: se queda dentro de su tarjeta, nunca tumba el resto de la pantalla. */
export function SectionError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {message}
    </p>
  );
}

/** Acción principal dentro de un estado vacío o una cabecera. */
export function PrimaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={btnPrimary}>
      {children}
    </Link>
  );
}

/**
 * Navegación interna de una pantalla larga (Fase 11, §17): una fila de anclas para saltar
 * directo a un bloque en vez de obligar a un scroll largo para encontrarlo (p. ej. Finanzas:
 * Casas, Movimientos, Retiros, Conciliación). Enlaces de verdad (`href="#id"`): funcionan con
 * teclado y lectores de pantalla sin JavaScript adicional para resaltar la sección activa.
 */
export function SubNav({ items }: { items: readonly { id: string; label: string }[] }) {
  return (
    <nav
      aria-label="Ir a una sección de esta página"
      // El desplazamiento (`top`) debe despejar la barra superior entera: a menos de 640px esa
      // barra mide ~97px (título + insignia + "Etapa… · Tu rol…" en otra línea, QA responsiva
      // Fase 11 §8 — antes `top-16`/64px dejaba este nav parcialmente tapado); de 640px en
      // adelante la barra mide ~69px, ya cubierto.
      className="sticky top-[100px] z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-slate-50/95 px-1 py-1 backdrop-blur sm:top-[70px]"
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`shrink-0 rounded-full border border-slate-200 bg-surface px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-violet-300 hover:text-violet-700 ${focusRing}`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** Encabezado de una pantalla: qué es y, a la derecha, su acción principal. */
export function PageHeader({
  title,
  description,
  help,
  actions,
}: {
  title: string;
  /** Una sola frase (Fase 11, §23): lo que explica más se mueve a `help`, no a un párrafo largo. */
  description?: ReactNode;
  /** "[?]" junto al título para quien quiera el porqué completo, sin ocupar espacio permanente. */
  help?: { label: string; text: ReactNode };
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-3xl">
        <h2 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight text-slate-900">
          {title}
          {help && <HelpTip label={help.label}>{help.text}</HelpTip>}
        </h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Ayuda contextual "[?]" junto a un concepto: se abre al pasar el ratón, al enfocar con el
 * teclado o al tocar (móvil), y se cierra con Escape. Va fuera del `<label>` del campo para no
 * alterar su nombre accesible.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  // Desplazamiento horizontal (Fase 11, §32) para que el globo nunca se salga del viewport: por
  // defecto centrado sobre el disparador (0), y solo se corrige si no cabe así.
  const [shiftPx, setShiftPx] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useEffect(() => {
    // Sin reinicio al cerrar (regla `react-hooks/set-state-in-effect`): no hace falta, el globo
    // no se pinta mientras está cerrado, y al reabrir esta misma rama vuelve a medir y corregir.
    if (!open) return;
    const el = tooltipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 16;
    const overflowRight = rect.right - (window.innerWidth - margin);
    const overflowLeft = margin - rect.left;
    if (overflowRight > 0) setShiftPx(-overflowRight);
    else if (overflowLeft > 0) setShiftPx(overflowLeft);
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`¿Qué es ${label}?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`rounded-full text-slate-400 transition-colors hover:text-violet-600 ${focusRing}`}
      >
        <HelpIcon className="h-4 w-4" />
      </button>
      {open && (
        <span
          ref={tooltipRef}
          role="tooltip"
          id={id}
          style={{ transform: `translateX(calc(-50% + ${shiftPx}px))` }}
          className="absolute bottom-full left-1/2 z-50 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-surface p-3 text-left text-xs leading-relaxed font-normal tracking-normal text-slate-700 normal-case shadow-lg"
        >
          <strong className="mb-0.5 block text-slate-900">{label}</strong>
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * Cuadro flotante centrado (Fase 10.4): overlay oscuro + panel compacto. El contenido (p. ej. un
 * `<form>`) aporta su propio encabezado, cuerpo y pie; este componente solo da el overlay, el
 * tamaño, el desplazamiento interno y el cierre con Escape o al hacer clic fuera del panel. En
 * móvil el panel ocupa toda la pantalla; en escritorio queda centrado y con alto máximo.
 */
export function Modal({
  onClose,
  ariaLabel,
  children,
  widthClassName = 'sm:max-w-xl',
  variant = 'default',
}: {
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  widthClassName?: string;
  /** `wizard`: el asistente "Añadir apuesta" (fondo desenfocado, panel hundido con halo violeta). */
  variant?: 'default' | 'wizard';
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center sm:p-4 ${
        variant === 'wizard' ? 'bg-[#020611]/75 backdrop-blur-[3px]' : 'bg-black/60'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`flex h-full w-full flex-col overflow-hidden shadow-xl sm:h-auto ${
          variant === 'wizard'
            ? 'wizard-skin bg-slate-50 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85),0_0_50px_-24px_rgba(101,8,255,0.5)] sm:rounded-2xl sm:border sm:border-slate-300'
            : 'bg-surface sm:max-h-[min(42rem,90vh)] sm:rounded-2xl sm:border sm:border-slate-200'
        } ${widthClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Visor de imagen a pantalla casi completa (Fase 11, §16: el ticket se veía abriendo una pestaña
 * nueva del navegador; ahora es parte de la app). Fondo oscuro, cierra con X, Escape o clic fuera
 * de la imagen; en móvil la imagen se ajusta al viewport sin recortarse.
 */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    // Escape cierra SOLO el visor: se escucha en `window` en fase de captura (antes que el
    // `keydown` de `document` de un `<Modal>` que lo contenga, p. ej. "Añadir apuesta") y no se
    // propaga — si no, el mismo Escape cerraba también el formulario y se perdía lo escrito.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className={`absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 ${focusRing}`}
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Bloques grises mientras llegan los datos: nunca se muestra un "0" provisional. */
export function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

export function LoadingBlock({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon}
      </span>
      <p className="font-medium text-slate-800">{title}</p>
      <div className="max-w-md text-sm text-slate-500">{text}</div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
