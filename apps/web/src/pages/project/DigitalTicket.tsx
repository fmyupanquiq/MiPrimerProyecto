import { formatOdds, isOddsString, type TotalOddsSource, type VisibleResult } from '@letfer/shared';
import type { ReactNode } from 'react';
import { LayersIcon } from '../../icons.js';
import { Badge } from '../../ui.js';
import type { BetLeg } from './bet-legs.js';

/*
 * Ticket digital de LetFer: una representación HTML/CSS de los datos de una apuesta (nunca una
 * imagen ni una copia de la casa). Es puramente presentacional: recibe lo ya normalizado, así que
 * sirve igual para una apuesta guardada (`BetDetail`, "Ver apuesta") que para el borrador del
 * paso Confirmar. Estructura: cabecera → legs (con sus condiciones conectadas) → pie financiero.
 * La cuota de un leg se muestra una sola vez; las condiciones internas no llevan cuota.
 */

export interface TicketFact {
  label: string;
  value: ReactNode;
}

export interface TicketFigure {
  label: string;
  value: ReactNode;
  /** Origen del dato cuando importa: "(oficial)" o "(calculado)". */
  note?: string;
  valueClass?: string;
}

/**
 * Cifras de la cuota total según su procedencia (ADR 0023). Una cuota calculada NUNCA se presenta
 * como oficial: la oficial se muestra "—" y la referencia aparece aparte y rotulada.
 * `source` ausente se trata como desconocida. `value` vacío ⇒ no disponible.
 */
export function totalOddsFigures(
  source: TotalOddsSource | undefined,
  value: string | null,
): TicketFigure[] {
  const shown = value === null || value.trim() === '' ? null : showOdds(value.trim());
  if (shown === null)
    return [{ label: 'Cuota total oficial', value: '—', note: '(no disponible)' }];
  if (source === 'OFFICIAL') {
    return [{ label: 'Cuota total oficial', value: shown, note: '(oficial)' }];
  }
  if (source === 'CALCULATED') {
    return [
      { label: 'Cuota total oficial', value: '—', note: '(la casa no la mostró)' },
      {
        label: 'Cuota calculada de referencia',
        value: shown,
        note: '(calculada por LetFer, no confirmada por la casa)',
      },
    ];
  }
  return [{ label: 'Cuota total', value: shown, note: '(origen no verificado)' }];
}

export interface DigitalTicketProps {
  houseName: string;
  /** "Múltiple de 4", "Creada · 2 selecciones", "Simple"… */
  structureTitle: string;
  status: ReactNode;
  facts: TicketFact[];
  legs: BetLeg[];
  selectionsCount: number;
  figures: TicketFigure[];
  /** Pie opcional bajo las cifras (p. ej. quién registró). */
  footnote?: ReactNode;
  /** Etiqueta accesible del ticket; por defecto "Ticket de LetFer". */
  label?: string;
}

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

/** Resultado individual que el ticket muestra (documental): nunca es la liquidación de la apuesta. */
export function VisibleResultBadge({ value }: { value: VisibleResult }) {
  return <Badge tone={VISIBLE_RESULT_TONES[value]}>{VISIBLE_RESULT_LABELS[value]}</Badge>;
}

/** El borrador puede traer texto a medias: se muestra tal cual en vez de fallar. */
const showOdds = (value: string): string => (isOddsString(value) ? formatOdds(value) : value);

function OddsTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1 text-violet-800">
      <span className="text-xs">{label}</span>
      <span className="text-base font-semibold tabular-nums">{showOdds(value)}</span>
    </span>
  );
}

function LegCard({ leg }: { leg: BetLeg }) {
  return (
    <li
      aria-label={`Leg ${leg.number}`}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-surface-2 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {leg.number}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Leg {leg.number} · {leg.grouped ? 'Creada' : 'Simple'}
            </p>
            <p className="font-semibold break-words text-slate-900">{leg.event}</p>
            {(leg.score || leg.result) && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {leg.score && (
                  <span>
                    Marcador <strong className="text-slate-800 tabular-nums">{leg.score}</strong>
                  </span>
                )}
                {leg.result && <VisibleResultBadge value={leg.result} />}
              </p>
            )}
          </div>
        </div>
        {leg.odds !== null && leg.odds !== '' && (
          <OddsTag label={leg.grouped ? 'Cuota del leg' : 'Cuota'} value={leg.odds} />
        )}
      </div>

      {/* Las condiciones de una Creada cuelgan de una línea vertical: se leen como parte del leg. */}
      <ul
        className={`flex flex-col gap-2 ${leg.grouped ? 'ml-3 border-l-2 border-violet-200 pl-3' : ''}`}
      >
        {leg.selections.map((selection, index) => (
          <li
            key={selection.id}
            aria-label={leg.grouped ? `Selección ${index + 1} del leg ${leg.number}` : undefined}
            className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-surface px-3 py-2"
          >
            {leg.grouped && (
              <p className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
                Selección {index + 1}
                {selection.conditionStatus && (
                  <VisibleResultBadge value={selection.conditionStatus} />
                )}
              </p>
            )}
            {selection.market && (
              <p className="text-xs break-words text-slate-500">{selection.market}</p>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 text-sm font-semibold break-words text-slate-900">
                {selection.selection}
              </p>
              {leg.ownOdds && selection.visibleOdds !== null && (
                <span className="text-sm font-semibold text-slate-700 tabular-nums">
                  {showOdds(selection.visibleOdds)}
                </span>
              )}
            </div>
            {selection.sport && <p className="text-xs text-slate-500">{selection.sport}</p>}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function DigitalTicket({
  houseName,
  structureTitle,
  status,
  facts,
  legs,
  selectionsCount,
  figures,
  footnote,
  label = 'Ticket de LetFer',
}: DigitalTicketProps) {
  return (
    <article
      aria-label={label}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm"
    >
      <section
        aria-label="Datos de la apuesta"
        className="border-b border-violet-100 bg-violet-50/60 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-violet-700 uppercase">
              Ticket LetFer
            </p>
            <h3 className="text-lg font-semibold break-words text-slate-900">{houseName}</h3>
          </div>
          {status}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs text-slate-500">{fact.label}</dt>
              <dd className="mt-0.5 text-sm font-medium break-words text-slate-900">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Estructura de la apuesta" className="p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <LayersIcon className="h-4 w-4 text-violet-600" /> {structureTitle}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Ticket de LetFer · {legs.length} {legs.length === 1 ? 'leg' : 'legs'} · {selectionsCount}{' '}
          {selectionsCount === 1 ? 'selección' : 'selecciones'}
        </p>
        {legs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Esta apuesta no tiene selecciones.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {legs.map((leg) => (
              <LegCard key={leg.eventGroup} leg={leg} />
            ))}
          </ol>
        )}
      </section>

      {/* Perforación del ticket: separa el detalle de los totales. */}
      <div aria-hidden="true" className="border-t-2 border-dashed border-slate-200" />
      <section aria-label="Resumen financiero" className="bg-slate-50/60 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-slate-900">Resumen financiero</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {figures.map((figure) => (
            <div
              key={figure.label}
              className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface p-3"
            >
              <dt className="text-xs text-slate-500">{figure.label}</dt>
              <dd
                className={`text-lg font-semibold tabular-nums ${figure.valueClass ?? 'text-slate-900'}`}
              >
                {figure.value}
              </dd>
              {figure.note && <span className="text-xs text-slate-500">{figure.note}</span>}
            </div>
          ))}
        </dl>
        {footnote && <div className="mt-3 text-xs text-slate-500">{footnote}</div>}
      </section>
    </article>
  );
}
