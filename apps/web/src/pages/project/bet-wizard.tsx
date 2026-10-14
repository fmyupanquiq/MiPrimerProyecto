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
import { WizardCard } from './WizardCard.js';

export { WizardCard };

/*
 * Piezas visuales del asistente "Añadir apuesta" (Paso 1 Añadir, Paso 2 Verificar datos, Paso 3
 * Confirmar). Solo presentan: el estado y las reglas viven en `NewBetForm` y en `bet-draft.ts`; las
 * cifras que muestran ya vienen calculadas y rotuladas (oficial / calculada / sin datos).
 */

const showOdds = (value: string): string => (isOddsString(value) ? formatOdds(value) : value);

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
    <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2 sm:px-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-300/60 sm:h-12 sm:w-12"
          aria-hidden="true"
        >
          <TicketIcon className="h-6 w-6 sm:h-7 sm:w-7" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg leading-tight font-semibold text-slate-900 sm:text-[1.4rem]">
            Añadir apuesta
          </h3>
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">{subtitle}</p>
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
 * Progreso real de los tres pasos: completado (círculo violeta con check y la etiqueta con su número),
 * activo (violeta intenso con halo) y pendiente (círculo oscuro, número gris). La línea entre dos pasos
 * se vuelve violeta al completar el primero. Navegable: nunca bloquea (solo "Registrar apuesta" valida).
 */
export function WizardStepper({
  labels,
  current,
  onSelect,
}: {
  labels: readonly string[];
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol
      className="flex items-center px-4 pt-1 pb-2 sm:px-6"
      aria-label="Pasos para añadir una apuesta"
    >
      {labels.map((label, index) => {
        const active = index === current;
        const complete = index < current;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              onClick={() => onSelect(index)}
              className="group flex items-center gap-1.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500 sm:gap-3"
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
                className={`text-[11px] font-medium whitespace-nowrap sm:text-[0.95rem] ${
                  active || complete ? 'text-violet-700' : 'text-slate-700'
                }`}
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
                  complete ? 'bg-violet-600' : 'bg-slate-300'
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

// --- Franja informativa ---------------------------------------------------------------------------

export type BannerKind = 'ai-complete' | 'ai-partial' | 'ticket-unanalyzed' | 'manual';

export function WizardBanner({
  kind,
  legs,
  conditions,
  hasResult,
  missing,
}: {
  kind: BannerKind;
  legs: number;
  conditions: number;
  hasResult: boolean;
  missing: readonly string[];
}) {
  const tone =
    kind === 'ai-complete'
      ? 'border-green-300/80 bg-green-50 text-slate-800 [&>svg]:text-green-600'
      : kind === 'ai-partial'
        ? 'border-amber-300 bg-amber-50 text-amber-800'
        : 'border-slate-300 bg-slate-100 text-slate-700';
  // Se cuentan LEGS (filas del ticket), nunca condiciones: una Creada con 2 pronósticos es 1 leg.
  // `conditions` solo se anuncia cuando difiere, para no ocultar que hay pronósticos agrupados.
  const legsText = legs === 1 ? '1 leg' : `${legs} legs`;
  let text: string;
  if (kind === 'ai-complete') {
    text = `Ticket leído por IA. Se han detectado ${legsText}${
      hasResult ? ' y el resultado de la apuesta' : ''
    }. Verifica los datos antes de continuar.`;
  } else if (kind === 'ai-partial') {
    text = `Ticket leído por IA con datos incompletos. Se han detectado ${legsText}. Revisa: ${missing.join(', ')}.`;
  } else if (kind === 'ticket-unanalyzed') {
    text =
      'Ticket adjunto sin analizar. Los datos son los que introdujiste: verifícalos con la imagen antes de continuar.';
  } else {
    text = 'Registro manual. Revisa los datos introducidos antes de continuar.';
  }
  return (
    <div
      role="status"
      title={conditions > legs ? `${conditions} pronósticos en total` : undefined}
      className={`mx-4 flex items-start gap-2.5 rounded-lg border px-3 py-1.5 text-[0.8rem] sm:mx-6 sm:items-center ${tone}`}
    >
      {kind === 'ai-complete' ? (
        <CheckCircleIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 sm:mt-0" />
      ) : (
        <InfoIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 sm:mt-0" />
      )}
      <span>{text}</span>
    </div>
  );
}

// --- Tarjetas -------------------------------------------------------------------------------------

/** Insignia "Detectado por IA. Verifica antes de confirmar." (solo si hubo una lectura aplicada). */
export function AiDetectedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300/60 bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-800">
      <StarIcon className="h-3.5 w-3.5 text-violet-700" />
      Detectado por IA. Verifica antes de confirmar.
      <InfoIcon className="h-3.5 w-3.5 text-violet-600" />
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

const ROW_GRID =
  '@[40rem]:grid @[40rem]:grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1.15fr)_minmax(0,1.3fr)_2.75rem_auto] @[40rem]:items-center @[40rem]:gap-x-3';
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

/**
 * Tabla compacta de legs: UNA fila por leg. Una Creada (varias condiciones dentro de un leg) sigue
 * siendo una sola fila, con la insignia "Creada", cuántos pronósticos incluye y cada condición por
 * separado; su cuota es la del leg y aparece una sola vez. Se adapta al ANCHO DE LA COLUMNA (container
 * query, la columna del formulario es `@container`): por debajo de 40rem cada fila pasa a una tarjeta
 * apilada (nada desaparece ni se trunca).
 */
export function SelectionsTable({
  legs,
  onEdit,
}: {
  legs: readonly BetLeg[];
  onEdit: (eventGroup: number) => void;
}) {
  if (legs.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no hay selecciones.</p>;
  }
  return (
    <ol className="flex flex-col @[40rem]:divide-y @[40rem]:divide-slate-200">
      {legs.map((leg) => (
        <li
          key={leg.eventGroup}
          aria-label={`Leg ${leg.number}`}
          className={`flex flex-col gap-2.5 @max-[40rem]:rounded-xl @max-[40rem]:border @max-[40rem]:border-slate-200 @max-[40rem]:p-3 @max-[40rem]:[&:not(:first-child)]:mt-2 @[40rem]:py-[0.3rem] @[40rem]:first:pt-0 @[40rem]:last:pb-0 ${ROW_GRID}`}
        >
          <div className="flex items-start gap-3 @[40rem]:contents">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white shadow-[0_0_14px_rgba(101,8,255,0.45)]"
              aria-hidden="true"
            >
              {leg.number}
            </span>
            <div className="min-w-0 flex-1 @[40rem]:flex-none">
              <p className={`${miniLabel} flex flex-wrap items-center gap-x-1.5`}>
                Partido
                {/* Marcador y resultado visibles son documentales (§114): nunca liquidan. */}
                {leg.score && <span>· Marcador {leg.score}</span>}
                {leg.result && (
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
                <p className={miniLabel}>Tipo de apuesta</p>
                <div className="mt-1 flex flex-col items-start gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1 text-[0.8rem] font-semibold text-white">
                    <LayersIcon className="h-3.5 w-3.5" />
                    Creada
                  </span>
                  <span className="inline-flex items-center rounded-lg border border-slate-300 px-2.5 py-0.5 text-[0.72rem] font-medium text-slate-700">
                    {leg.selections.length} pronósticos
                  </span>
                </div>
              </div>
              <div className="min-w-0">
                <p className={miniLabel}>Pronósticos incluidos</p>
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
                          <span className="block text-[0.66rem] leading-[0.95rem] text-slate-500">
                            <span className="sr-only"> — </span>
                            {condition.market}
                          </span>
                        )}
                        {condition.conditionStatus && (
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
                <p className={miniLabel}>Mercado</p>
                <p className="text-[0.82rem] leading-[1.05rem] break-words text-slate-900">
                  {leg.selections[0]?.market || '—'}
                </p>
              </div>
              <div className="min-w-0">
                <p className={miniLabel}>Pronóstico</p>
                <p className="text-[0.82rem] leading-[1.05rem] break-words text-slate-900">
                  {leg.selections[0]?.selection || '(sin pronóstico)'}
                </p>
              </div>
            </>
          )}

          <div className="flex items-end justify-between gap-3 @[40rem]:contents">
            <div>
              <p className={miniLabel}>Cuota</p>
              <p className="text-base leading-6 font-medium text-slate-900 tabular-nums">
                {leg.odds === null || leg.odds === '' ? '—' : showOdds(leg.odds)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onEdit(leg.eventGroup)}
              aria-label={`Editar el leg ${leg.number}`}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-100/60 px-3.5 text-[0.8rem] font-medium text-slate-800 transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              <PencilIcon className="h-4 w-4" />
              Editar
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

// --- Ticket original y resumen ----------------------------------------------------------------------

export function TicketOriginalCard({
  projectId,
  ticket,
  capturedByAi,
  onChange,
  fill,
}: {
  projectId: string;
  ticket: TicketSummary | null;
  capturedByAi: boolean;
  /** "Cambiar imagen" (solo en el Paso 1; en la verificación la tarjeta es de consulta). */
  onChange?: () => void;
  /** Ocupa el alto libre de la columna (escritorio); en móvil, alto fijo. */
  fill?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isImage = ticket !== null && ticket.mimeType !== 'application/pdf';
  return (
    <section
      aria-label="Ticket original"
      className={`flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-surface p-3 ${
        fill ? 'min-h-[18rem] flex-1' : ''
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-300/50"
            aria-hidden="true"
          >
            <TicketIcon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h4 className="text-[0.95rem] leading-tight font-semibold text-slate-900">
              Ticket original
            </h4>
            <p className="truncate text-[0.7rem] text-slate-500" title={ticket?.originalFileName}>
              {ticket === null
                ? 'Sin imagen'
                : capturedByAi
                  ? 'Capturado por IA'
                  : ticket.originalFileName}
            </p>
          </div>
        </div>
        {isImage && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-surface px-2.5 text-xs font-medium text-slate-800 transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            <ExpandIcon className="h-3.5 w-3.5" />
            Ver ticket
          </button>
        )}
      </header>
      {ticket === null ? (
        <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
          <TicketIcon className="h-6 w-6 text-slate-400" />
          Registro manual: no hay imagen adjunta.
        </div>
      ) : (
        <>
          <div
            className={`relative overflow-hidden rounded-lg bg-slate-100/70 ${
              fill ? 'min-h-0 flex-1' : 'h-72'
            }`}
          >
            <TicketThumbnail projectId={projectId} ticket={ticket} fill />
          </div>
          {onChange && (
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>{capturedByAi ? 'Leído con IA' : 'Todavía no se analizó con IA.'}</span>
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
 * Resumen de la verificación: una línea por dato (etiqueta a la izquierda, valor y su procedencia a
 * la derecha) con separadores finos. Solo presenta: los valores llegan ya calculados por el
 * formulario (las mismas cifras de "Datos de la apuesta", nunca una fórmula aparte).
 */
export function SummaryCard({ icon, rows }: { icon: ReactNode; rows: readonly SummaryRow[] }) {
  return (
    <section
      aria-label="Resumen"
      className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-surface p-3"
    >
      <header className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-300/50 [&>svg]:h-[18px] [&>svg]:w-[18px]"
          aria-hidden="true"
        >
          {icon}
        </span>
        <h4 className="text-[0.95rem] font-semibold text-slate-900">Resumen</h4>
      </header>
      <dl className="flex flex-col divide-y divide-slate-200 text-[0.8rem]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid min-h-[1.72rem] grid-cols-[7.4rem_minmax(0,1fr)] items-center gap-2 py-[0.1rem]"
          >
            <dt className="text-slate-600">{row.label}</dt>
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
