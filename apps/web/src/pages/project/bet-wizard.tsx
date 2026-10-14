import { formatOdds, isOddsString, type TicketSummary, type VisibleResult } from '@letfer/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { ticketFileUrl } from '../../api/client.js';
import {
  CheckCircleIcon,
  CheckIcon,
  CloseIcon,
  ExpandIcon,
  InfoIcon,
  LayersIcon,
  PencilIcon,
  StarIcon,
  TicketIcon,
} from '../../icons.js';
import { Badge, Lightbox } from '../../ui.js';
import type { BetLeg } from './bet-legs.js';
import { TicketThumbnail } from './TicketPanel.js';
import { CardIcon, WizardCard } from './WizardCard.js';

export { WizardCard };

/*
 * Piezas visuales del asistente "Añadir apuesta" (Paso 1 Añadir, Paso 2 Verificar datos, Paso 3
 * Confirmar). Solo presentan: el estado y las reglas viven en `NewBetForm` y en `bet-draft.ts`; las
 * cifras que muestran ya vienen calculadas y rotuladas (oficial / calculada / sin datos).
 */

const showOdds = (value: string): string => (isOddsString(value) ? formatOdds(value) : value);

// --- Botones y píldoras comunes -----------------------------------------------------------------

const buttonBase =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0';
/** Botones del asistente: primario con resplandor, contorno, contorno violeta, peligro y texto. */
export const wizardButton = {
  primary: `${buttonBase} bg-violet-600 px-5 font-semibold text-white shadow-[0_0_22px_-4px_rgba(101,8,255,0.75)] hover:bg-violet-500`,
  outline: `${buttonBase} border border-slate-300 bg-surface px-4 font-medium text-slate-800 hover:border-violet-400 hover:bg-violet-50`,
  violet: `${buttonBase} border border-violet-500 bg-surface px-4 font-medium text-violet-700 hover:bg-violet-50`,
  danger: `${buttonBase} border border-red-300 bg-red-50 px-4 font-medium text-red-700 hover:border-red-500`,
  text: `${buttonBase} px-3 font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900`,
  small: `${buttonBase} min-h-8 shrink-0 border border-slate-300 bg-surface px-2.5 text-xs font-medium whitespace-nowrap text-slate-800 hover:border-violet-400 hover:bg-violet-50 [&>svg]:h-3.5 [&>svg]:w-3.5`,
} as const;

export type PillTone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate';
const PILL_TONES: Record<PillTone, string> = {
  green: 'border-green-300/70 bg-green-50 text-green-700',
  red: 'border-red-300/70 bg-red-50 text-red-700',
  amber: 'border-amber-300/70 bg-amber-50 text-amber-700',
  blue: 'border-blue-300/70 bg-blue-50 text-blue-700',
  violet: 'border-violet-300/70 bg-violet-50 text-violet-700',
  slate: 'border-slate-300 bg-slate-100 text-slate-700',
};

/** Píldora de estado: icono + texto (nunca solo color). */
export function Pill({
  tone,
  icon,
  children,
  title,
}: {
  tone: PillTone;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0 ${PILL_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Franja informativa (azul) o de éxito (verde), con su icono. */
export function Strip({
  tone,
  children,
  className = '',
  live = false,
}: {
  tone: 'info' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
  /** `role="status"`: se anuncia a los lectores de pantalla. */
  live?: boolean;
}) {
  const look =
    tone === 'success'
      ? 'border-green-300/60 bg-green-50 text-green-800 [&>svg]:text-green-600'
      : tone === 'warning'
        ? 'border-amber-300/70 bg-amber-50 text-amber-800 [&>svg]:text-amber-600'
        : 'border-blue-300/60 bg-blue-50 text-blue-800 [&>svg]:text-blue-600';
  return (
    <div
      role={live ? 'status' : undefined}
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-1.5 text-sm sm:items-center ${look} ${className}`}
    >
      {tone === 'success' ? (
        <CheckCircleIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 sm:mt-0" />
      ) : (
        <InfoIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 sm:mt-0" />
      )}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

// --- Cabecera y progreso -------------------------------------------------------------------------

export function WizardHeader({
  subtitle,
  onClose,
  disabled,
}: {
  subtitle: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 sm:px-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-[0_0_20px_-6px_rgba(101,8,255,0.8)]"
          aria-hidden="true"
        >
          <TicketIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg leading-tight font-semibold text-slate-900 sm:text-xl">
            Añadir apuesta
          </h3>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">{subtitle}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        aria-label="Cerrar"
        className="shrink-0 rounded-xl p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50"
      >
        <CloseIcon className="h-6 w-6" />
      </button>
    </header>
  );
}

/**
 * Progreso de los tres pasos: completado (círculo violeta con check y el rótulo con su número),
 * activo (violeta con halo) y pendiente (círculo apagado). La línea es violeta desde el paso activo
 * hacia atrás. Solo se puede ir a los pasos que `canSelect` permite ("Confirmar" nunca: a él solo se
 * llega registrando); un paso no navegable queda deshabilitado pero conserva `aria-current`. En móvil
 * solo el paso activo muestra su rótulo.
 */
export function WizardStepper({
  labels,
  current,
  onSelect,
  canSelect,
}: {
  labels: readonly string[];
  current: number;
  onSelect: (index: number) => void;
  canSelect: (index: number) => boolean;
}) {
  return (
    <ol
      className="flex items-center px-4 pt-1 pb-2 sm:px-6"
      aria-label="Pasos para añadir una apuesta"
    >
      {labels.map((label, index) => {
        const active = index === current;
        const complete = index < current;
        const selectable = canSelect(index);
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              disabled={!selectable}
              onClick={() => onSelect(index)}
              className="group flex items-center gap-1.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500 disabled:cursor-default sm:gap-3"
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-violet-600 text-white shadow-[0_0_18px_rgba(101,8,255,0.6)]'
                    : complete
                      ? 'bg-violet-600 text-white'
                      : 'border border-slate-300 bg-slate-100 text-slate-600'
                }`}
                aria-hidden="true"
              >
                {complete ? <CheckIcon className="h-4 w-4" /> : index + 1}
              </span>
              <span
                className={`text-xs font-medium whitespace-nowrap sm:text-[0.95rem] ${
                  active || complete ? 'text-violet-700' : 'text-slate-700'
                } ${active ? '' : 'max-sm:sr-only'}`}
              >
                {complete && (
                  <span className="mr-1.5 hidden sm:inline" aria-hidden="true">
                    {index + 1}
                  </span>
                )}
                {label}
              </span>
            </button>
            {index < labels.length - 1 && (
              <span
                className={`mx-1.5 h-0.5 min-w-2 flex-1 rounded-full sm:mx-5 ${
                  index <= current ? 'bg-violet-600' : 'bg-slate-300'
                }`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// --- Franja superior de "Verificar datos" ------------------------------------------------------------

export type BannerKind = 'ai-complete' | 'ai-partial' | 'ticket-unanalyzed' | 'manual';

/**
 * Franja de "Verificar datos". Cuenta LEGS (filas del ticket), nunca condiciones: una Creada con 2
 * pronósticos es 1 selección del ticket. Solo dice "leído por IA" si de verdad se aplicó una lectura.
 */
export function WizardBanner({
  kind,
  legs,
  hasResult,
  missing,
}: {
  kind: BannerKind;
  legs: number;
  hasResult: boolean;
  missing: readonly string[];
}) {
  const legsText = legs === 1 ? '1 selección' : `${legs} selecciones`;
  if (kind === 'ai-complete') {
    return (
      <Strip tone="success" live className="mx-4 sm:mx-6">
        <strong className="font-semibold">Ticket leído por IA.</strong> Se han detectado {legsText}
        {hasResult ? ' y el resultado de la apuesta' : ''}. Verifica los datos y confirma el
        registro.
      </Strip>
    );
  }
  if (kind === 'ai-partial') {
    return (
      <Strip tone="warning" live className="mx-4 sm:mx-6">
        <strong className="font-semibold">Ticket leído por IA con datos incompletos.</strong> Se han
        detectado {legsText}. Revisa: {missing.join(', ')}.
      </Strip>
    );
  }
  if (kind === 'ticket-unanalyzed') {
    return (
      <Strip tone="info" live className="mx-4 sm:mx-6">
        <strong className="font-semibold">Ticket adjunto sin analizar.</strong> Los datos son los
        que introduces: verifícalos con la imagen antes de confirmar.
      </Strip>
    );
  }
  return (
    <Strip tone="info" live className="mx-4 sm:mx-6">
      <strong className="font-semibold">Registro manual.</strong> Completa los datos de la apuesta y
      confirma el registro.
    </Strip>
  );
}

// --- Tarjetas -------------------------------------------------------------------------------------

/** Insignia "Detectado por IA. Verifica antes de confirmar." (solo si hubo una lectura aplicada). */
export function AiDetectedBadge() {
  const explanation =
    'La IA propuso estos datos a partir del ticket. Compáralos con la imagen: nada se registra hasta que pulses «Confirmar apuesta».';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/60 bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-800">
      <StarIcon className="h-3.5 w-3.5 text-violet-700" />
      Detectado por IA. Verifica antes de confirmar.
      <span title={explanation} className="inline-flex">
        <InfoIcon className="h-3.5 w-3.5 text-violet-600" />
        <span className="sr-only">{explanation}</span>
      </span>
    </span>
  );
}

// --- Tabla de selecciones -------------------------------------------------------------------------

const VISIBLE_RESULT_LABELS: Record<VisibleResult, string> = {
  WON: 'Ganó',
  LOST: 'Perdió',
  VOID: 'Anulada',
  PENDING: 'Pendiente',
};
const VISIBLE_RESULT_TONES: Record<VisibleResult, 'green' | 'red' | 'slate' | 'amber'> = {
  WON: 'green',
  LOST: 'red',
  VOID: 'slate',
  PENDING: 'amber',
};

const REVIEW_GRID =
  '@[40rem]:grid @[40rem]:grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1.15fr)_minmax(0,1.3fr)_2.75rem_auto] @[40rem]:items-center @[40rem]:gap-x-3';
const REGISTERED_GRID =
  '@[40rem]:grid @[40rem]:grid-cols-[2.5rem_minmax(0,1.3fr)_minmax(0,1.15fr)_minmax(0,1.35fr)_3rem] @[40rem]:items-center @[40rem]:gap-x-3';
const miniLabel = 'text-[0.7rem] leading-4 text-slate-500';

/**
 * "Equipo A - Equipo B" en dos líneas ("Equipo A" / "vs Equipo B"), como la referencia. Es solo
 * presentación: el texto guardado no cambia. Sin un separador claro se muestra tal cual.
 */
function EventLines({ event }: { event: string }) {
  if (event === '') return <span>(sin partido)</span>;
  const parts = event.split(/\s+(?:-|–|vs\.?|v)\s+/i);
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return <span>{event}</span>;
  return (
    <span aria-label={event}>
      <span className="block">{parts[0]}</span>
      <span className="block">vs {parts[1]}</span>
    </span>
  );
}

/** Insignia violeta "Creada" + "{n} pronósticos" (un leg con varias condiciones). */
function CreatedBadges({ count }: { count: number }) {
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-[0.8rem] font-semibold text-white">
        <LayersIcon className="h-3.5 w-3.5" />
        Creada
      </span>
      <span className="inline-flex items-center rounded-full border border-slate-300 px-2.5 py-0.5 text-[0.72rem] font-medium text-slate-700">
        {count} pronósticos
      </span>
    </div>
  );
}

/**
 * Tabla compacta de legs: UNA fila por leg. Una Creada (varias condiciones dentro de un leg) sigue
 * siendo una sola fila, con la insignia "Creada", cuántos pronósticos incluye y cada condición por
 * separado; su cuota es la del leg y aparece una sola vez. Se adapta al ANCHO DE LA COLUMNA (container
 * query, la columna del formulario es `@container`): por debajo de 40rem cada fila pasa a una tarjeta
 * apilada (nada desaparece ni se trunca).
 *
 * - `review` (Verificar datos): rótulos en cada celda y botón "Editar".
 * - `registered` (Registro completado): solo lectura, con fila de encabezados.
 */
export function SelectionsTable({
  legs,
  onEdit,
  variant = 'review',
}: {
  legs: readonly BetLeg[];
  onEdit?: (eventGroup: number) => void;
  variant?: 'review' | 'registered';
}) {
  if (legs.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no hay selecciones.</p>;
  }
  const registered = variant === 'registered';
  // En la tabla de solo lectura los rótulos van en la fila de encabezados (y en móvil, en cada celda).
  const label = registered ? `${miniLabel} @[40rem]:sr-only` : miniLabel;
  return (
    <div className="flex flex-col">
      {registered && (
        <div
          className={`hidden border-b border-slate-200 pb-2 text-xs text-slate-500 @[40rem]:grid ${REGISTERED_GRID}`}
          aria-hidden="true"
        >
          <span className="pl-1">#</span>
          <span>Partido</span>
          <span>Mercado / Tipo</span>
          <span>Pronóstico(s)</span>
          <span className="text-right">Cuota</span>
        </div>
      )}
      <ol className="flex flex-col @[40rem]:divide-y @[40rem]:divide-slate-200">
        {legs.map((leg) => (
          <li
            key={leg.eventGroup}
            aria-label={`Leg ${leg.number}`}
            className={`flex flex-col gap-2.5 @max-[40rem]:rounded-xl @max-[40rem]:border @max-[40rem]:border-slate-200 @max-[40rem]:p-3 @max-[40rem]:[&:not(:first-child)]:mt-2 ${
              registered
                ? `@[40rem]:py-1.5 ${REGISTERED_GRID}`
                : `@[40rem]:py-1 @[40rem]:first:pt-0 @[40rem]:last:pb-0 ${REVIEW_GRID}`
            }`}
          >
            <div className="flex items-start gap-3 @[40rem]:contents">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white shadow-[0_0_14px_rgba(101,8,255,0.45)]"
                aria-hidden="true"
              >
                {leg.number}
              </span>
              <div className="min-w-0 flex-1 @[40rem]:flex-none">
                <p className={`${label} flex flex-wrap items-center gap-x-1.5`}>
                  Partido
                  {/* Marcador y resultado visibles son documentales (§114): nunca liquidan. */}
                  {!registered && leg.score && <span>· Marcador {leg.score}</span>}
                  {!registered && leg.result && (
                    <Badge tone={VISIBLE_RESULT_TONES[leg.result]}>
                      {VISIBLE_RESULT_LABELS[leg.result]}
                    </Badge>
                  )}
                </p>
                <p className="text-[0.82rem] leading-[1.05rem] break-words text-slate-900">
                  <EventLines event={leg.event} />
                </p>
              </div>
            </div>

            {leg.grouped ? (
              <>
                <div className="min-w-0">
                  <p className={label}>Tipo de apuesta</p>
                  <CreatedBadges count={leg.selections.length} />
                </div>
                <div className="min-w-0">
                  <p className={label}>Pronósticos incluidos</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {leg.selections.map((condition, index) => (
                      <li
                        key={condition.id}
                        aria-label={`Selección ${index + 1} del leg ${leg.number}`}
                        className="flex items-start gap-2 text-[0.8rem] leading-[1.05rem] text-slate-900"
                      >
                        <span
                          className="mt-[0.3rem] h-2 w-2 shrink-0 rounded-full bg-violet-500 ring-[3px] ring-violet-500/25"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 break-words">
                          <span>
                            {condition.selection === '' ? '(sin pronóstico)' : condition.selection}
                          </span>
                          {condition.market && (
                            <span
                              className={`block text-[0.66rem] leading-[0.95rem] text-slate-500 ${
                                registered ? 'sr-only' : ''
                              }`}
                            >
                              <span className="sr-only"> — </span>
                              {condition.market}
                            </span>
                          )}
                          {!registered && condition.conditionStatus && (
                            <span className="ml-2 inline-block align-middle">
                              <Badge tone={VISIBLE_RESULT_TONES[condition.conditionStatus]}>
                                {VISIBLE_RESULT_LABELS[condition.conditionStatus]}
                              </Badge>
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className={label}>Mercado</p>
                  <p className="text-[0.82rem] leading-[1.05rem] break-words text-slate-900">
                    {leg.selections[0]?.market || '—'}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className={label}>Pronóstico</p>
                  <p className="text-[0.82rem] leading-[1.05rem] break-words text-slate-900">
                    {leg.selections[0]?.selection || '(sin pronóstico)'}
                  </p>
                </div>
              </>
            )}

            <div className="flex items-end justify-between gap-3 @[40rem]:contents">
              <div className={registered ? '@[40rem]:text-right' : ''}>
                <p className={label}>Cuota</p>
                <p className="text-base leading-6 font-medium text-slate-900 tabular-nums">
                  {leg.odds === null || leg.odds === '' ? '—' : showOdds(leg.odds)}
                </p>
              </div>
              {!registered && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(leg.eventGroup)}
                  aria-label={`Editar el leg ${leg.number}`}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-100/60 px-3.5 text-[0.8rem] font-medium text-slate-800 transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                >
                  <PencilIcon className="h-4 w-4" />
                  Editar
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- Ticket original y resumen ----------------------------------------------------------------------

/**
 * Tarjeta con la imagen del ticket (original leído por IA o respaldo manual). `title`, `subtitle` y
 * `aside` cambian según el origen; sin ticket se muestra `empty`. "Ver ticket" abre el visor ampliado.
 */
export function TicketOriginalCard({
  projectId,
  ticket,
  title = 'Ticket original',
  subtitle,
  aside,
  empty,
  onChange,
  fill,
  imageClassName = 'h-72',
}: {
  projectId: string;
  ticket: TicketSummary | null;
  title?: string;
  subtitle?: string;
  /** Insignia junto al título (p. ej. "Leído por IA"); sustituye al botón "Ver ticket". */
  aside?: ReactNode;
  /** Estado vacío cuando no hay ticket. */
  empty?: ReactNode;
  /** "Cambiar imagen" (solo donde tiene sentido cambiarla). */
  onChange?: () => void;
  /** Ocupa el alto libre de la columna (escritorio); en móvil, alto fijo. */
  fill?: boolean;
  /** Alto de la imagen cuando no ocupa el alto libre (`fill`). */
  imageClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const isImage = ticket !== null && ticket.mimeType !== 'application/pdf';
  return (
    <section
      aria-label={title}
      className={`flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-surface p-3 ${
        fill ? 'min-h-[18rem] flex-1' : ''
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CardIcon icon={<TicketIcon />} size="sm" />
          <div className="min-w-0">
            <h4 className="text-[0.92rem] leading-tight font-semibold whitespace-nowrap text-slate-900">
              {title}
            </h4>
            {subtitle && (
              <p className="truncate text-[0.7rem] text-slate-500" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {aside ??
          (isImage && (
            <button type="button" onClick={() => setOpen(true)} className={wizardButton.small}>
              <ExpandIcon />
              Ver ticket
            </button>
          ))}
      </header>
      {ticket === null ? (
        (empty ?? (
          <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            <TicketIcon className="h-6 w-6 text-slate-400" />
            Registro manual: no hay imagen adjunta.
          </div>
        ))
      ) : (
        <>
          <div
            className={`relative overflow-hidden rounded-lg bg-slate-100/70 ${
              fill ? 'min-h-0 flex-1' : imageClassName
            }`}
          >
            <TicketThumbnail projectId={projectId} ticket={ticket} fill />
          </div>
          {onChange && (
            <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={onChange}
                className="text-xs font-medium text-violet-700 underline"
              >
                Cambiar imagen
              </button>
            </div>
          )}
        </>
      )}
      {open && isImage && ticket && (
        <Lightbox
          src={ticketFileUrl(projectId, ticket.id)}
          alt={ticket.originalFileName}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

export interface SummaryRow {
  label: string;
  value: ReactNode;
  /** `aria-label` del valor (p. ej. "Monto apostado calculado", para lectores de pantalla). */
  valueLabel?: string;
  /** Procedencia breve (oficial, calculado, derivado), en la misma línea que el valor. */
  note?: string;
}

/**
 * Resumen: una línea por dato (etiqueta a la izquierda, valor y su procedencia a la derecha) con
 * separadores finos. Solo presenta: los valores llegan ya calculados (en "Verificar datos", las
 * mismas cifras de "Datos de la apuesta"; en "Registro completado", las de la respuesta de la API).
 */
export function SummaryCard({
  icon,
  rows,
  title = 'Resumen',
  labelWidth = '7.4rem',
}: {
  icon: ReactNode;
  rows: readonly SummaryRow[];
  title?: string;
  /** Ancho de la columna de rótulos (los rótulos nunca se parten en dos líneas). */
  labelWidth?: string;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-surface p-3"
    >
      <header className="flex items-center gap-3">
        <CardIcon icon={icon} />
        <h4 className="text-[0.95rem] font-semibold text-slate-900">{title}</h4>
      </header>
      <dl className="flex flex-col divide-y divide-slate-200 text-[0.8rem]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid min-h-[1.72rem] items-center gap-2 py-[0.1rem]"
            style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr)` }}
          >
            <dt className="whitespace-nowrap text-slate-600">{row.label}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 break-words text-slate-900 tabular-nums">
              <span aria-label={row.valueLabel}>{row.value}</span>
              {row.note && (
                <span className="text-[0.65rem] text-slate-500 before:mr-1 before:content-['·']">
                  {row.note}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- Diálogo anidado (editar un leg) ----------------------------------------------------------------

/**
 * Diálogo sobre el asistente. Escape y clic fuera cierran SOLO este diálogo (el mismo criterio que el
 * visor de imagen): si no, el mismo Escape cerraba también "Añadir apuesta" y se perdía lo escrito.
 */
export function NestedDialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-slate-200"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar edición"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 p-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
