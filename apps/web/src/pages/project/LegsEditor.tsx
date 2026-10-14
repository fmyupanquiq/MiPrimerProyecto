import { type BetType, type VisibleResult } from '@letfer/shared';
import { useState } from 'react';
import { AutoGrowTextarea } from '../../AutoGrowTextarea.js';
import {
  ChevronDownIcon,
  CircleIcon,
  LayersIcon,
  MenuIcon,
  PlusIcon,
  TrashIcon,
} from '../../icons.js';
import { field, Caption, FormStep } from './BetSettlementFields.js';
import { DEFAULT_SPORT, legsOf, type SelectionDraft } from './bet-selection-drafts.js';

/*
 * Sección de selecciones de "Añadir apuesta" (§114): TICKET → LEG → CONDICIÓN.
 *
 *   - Simple y Creada independiente: un solo partido; la Creada muestra una tarjeta por selección.
 *   - Múltiple: una tarjeta por LEG. Un leg puede ser normal (mercado + pronóstico) o creado
 *     (Bet Builder / Same Game Parlay): un contenedor con el partido y LA cuota del leg una sola vez,
 *     y dentro una tarjeta independiente por condición. Las condiciones no llevan cuota.
 *
 * Solo presenta y delega: el estado vive en `NewBetForm` y las operaciones son las funciones puras
 * de `bet-selection-drafts.ts`.
 */

/** Sugerencias del desplegable; el deporte sigue siendo un texto libre en el modelo. */
const SPORT_OPTIONS = [
  'Fútbol',
  'Tenis',
  'Baloncesto',
  'Béisbol',
  'Vóley',
  'Fútbol americano',
  'Hockey',
  'eSports',
] as const;
const OTHER_SPORT = 'Otro';

/**
 * Partido | Deporte (Fase 11.7): 3:1 cuando el ancho REAL de la columna lo permite (consulta de
 * contenedor, no de ventana); apilados por debajo, para no cortar el nombre del partido.
 */
const eventSportGrid = 'grid gap-2 @md:grid-cols-[minmax(0,3fr)_minmax(9rem,1fr)]';

const RESULT_OPTIONS: { value: '' | VisibleResult; label: string }[] = [
  { value: '', label: 'Sin indicar' },
  { value: 'WON', label: 'Ganó' },
  { value: 'LOST', label: 'Perdió' },
  { value: 'VOID', label: 'Anulada' },
  { value: 'PENDING', label: 'Pendiente' },
];

function SportSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const known = (SPORT_OPTIONS as readonly string[]).includes(value);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <Caption>Deporte</Caption>
        <select
          value={known ? value : OTHER_SPORT}
          onChange={(event) =>
            onChange(event.target.value === OTHER_SPORT ? '' : event.target.value)
          }
          className={field}
          aria-label={label}
        >
          {SPORT_OPTIONS.map((sport) => (
            <option key={sport} value={sport}>
              {sport}
            </option>
          ))}
          <option value={OTHER_SPORT}>Otro…</option>
        </select>
      </label>
      {!known && (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={field}
          placeholder="Escribe el deporte"
          aria-label={`Otro deporte (${label})`}
        />
      )}
    </div>
  );
}

function ResultSelect({
  value,
  onChange,
  label,
  caption,
}: {
  value: '' | VisibleResult;
  onChange: (value: '' | VisibleResult) => void;
  label: string;
  caption: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <Caption>{caption}</Caption>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as '' | VisibleResult)}
        className={field}
        aria-label={label}
      >
        {RESULT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const iconButton =
  '-my-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
const detailsButton =
  'ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
const dashedButton =
  'flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-600 transition-colors hover:border-violet-400 hover:bg-violet-50/50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

export interface LegsEditorProps {
  format: BetType;
  selections: SelectionDraft[];
  onPatch: (key: number, patch: Partial<SelectionDraft>) => void;
  onAddLeg: () => void;
  onAddCondition: (eventGroup: number) => void;
  onRemoveRow: (key: number) => void;
  onRemoveLeg: (eventGroup: number) => void;
  /**
   * Edición de UN leg desde "Verificar datos": se pasan solo las filas de ese leg, se conserva su
   * número y no se ofrece añadir ni quitar legs (la estructura general se cambia en el Paso 1).
   */
  fixedLeg?: { number: number };
}

export function LegsEditor(props: LegsEditorProps) {
  const { format } = props;
  // Detalles abiertos: por clave de la fila principal del leg (Marcador, resultado y estados).
  const [openDetails, setOpenDetails] = useState<Set<number>>(new Set());
  const toggle = (key: number) =>
    setOpenDetails((open) => {
      const next = new Set(open);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return format === 'MULTIPLE' ? (
    <MultipleLegs {...props} openDetails={openDetails} toggle={toggle} />
  ) : (
    <SingleEventLegs {...props} openDetails={openDetails} toggle={toggle} />
  );
}

interface InnerProps extends LegsEditorProps {
  openDetails: Set<number>;
  toggle: (key: number) => void;
}

/** Marcador y resultado del leg (documentales), en la fila principal. */
function LegDetails({
  head,
  rows,
  legLabel,
  onPatch,
  open,
  toggle,
  showConditionStatus,
}: {
  head: SelectionDraft;
  rows: SelectionDraft[];
  legLabel: string;
  onPatch: LegsEditorProps['onPatch'];
  open: boolean;
  toggle: () => void;
  showConditionStatus: boolean;
}) {
  return (
    <>
      <div className="flex">
        <button type="button" className={detailsButton} aria-expanded={open} onClick={toggle}>
          {open ? 'Menos detalles' : 'Más detalles'}
          <ChevronDownIcon
            className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {open && (
        <div className="grid gap-2 pb-1 @md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <Caption>Marcador visible (opcional)</Caption>
            <input
              value={head.legScore}
              onChange={(event) => onPatch(head.key, { legScore: event.target.value })}
              className={field}
              placeholder="2-0"
              maxLength={30}
              aria-label={`Marcador ${legLabel}`}
            />
          </label>
          <ResultSelect
            caption="Resultado visible del leg"
            label={`Resultado visible ${legLabel}`}
            value={head.legResult}
            onChange={(value) => onPatch(head.key, { legResult: value })}
          />
          {showConditionStatus &&
            rows.map((row, index) => (
              <ResultSelect
                key={row.key}
                caption={`Estado visible de la selección ${index + 1}`}
                label={`Estado visible de la selección ${index + 1} ${legLabel}`}
                value={row.conditionStatus}
                onChange={(value) => onPatch(row.key, { conditionStatus: value })}
              />
            ))}
        </div>
      )}
    </>
  );
}

// --- Múltiple: una tarjeta por leg ------------------------------------------------------------

function MultipleLegs({
  selections,
  onPatch,
  onAddLeg,
  onAddCondition,
  onRemoveRow,
  onRemoveLeg,
  openDetails,
  toggle,
  fixedLeg,
}: InnerProps) {
  const legs = legsOf(selections);
  const firstNumber = fixedLeg?.number ?? 1;
  return (
    <FormStep
      compact
      icon={<MenuIcon />}
      title={fixedLeg ? `Leg ${firstNumber}` : `Legs (${legs.length})`}
      ariaLabel="Selecciones"
    >
      <div className="flex flex-col gap-3">
        {legs.map((rows, legIndex) => {
          const n = legIndex + firstNumber;
          const head = rows[0]!;
          const grouped = rows.length > 1;
          const legLabel = `del leg ${n}`;
          return (
            <section
              key={head.eventGroup}
              aria-label={`Leg ${n}`}
              className={`flex flex-col gap-2 rounded-xl border px-2.5 pt-2 pb-2 ${
                grouped ? 'border-violet-300 bg-violet-50/40' : 'border-slate-200 bg-surface-2'
              }`}
            >
              <div className="flex min-h-6 items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] text-white"
                    aria-hidden="true"
                  >
                    {n}
                  </span>
                  <span aria-hidden="true">Leg {n}</span>
                  {grouped && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-violet-800 uppercase">
                      <LayersIcon className="h-3 w-3" /> Creada
                    </span>
                  )}
                </span>
                {!fixedLeg && legs.length > 2 && (
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => onRemoveLeg(head.eventGroup)}
                    aria-label={`Quitar el leg ${n}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className={eventSportGrid}>
                <label className="flex min-w-0 flex-col gap-1">
                  <Caption>Partido</Caption>
                  <AutoGrowTextarea
                    value={head.event}
                    onChange={(value) => onPatch(head.key, { event: value })}
                    placeholder="Arsenal vs Manchester City"
                    title={head.event || undefined}
                    aria-label={`Partido ${legLabel}`}
                  />
                </label>
                <SportSelect
                  value={head.sport}
                  onChange={(sport) => onPatch(head.key, { sport })}
                  label={`Deporte ${legLabel}`}
                />
              </div>

              <label className="flex flex-col gap-1">
                <Caption>Cuota del leg{grouped ? ' (una sola para todo el bloque)' : ''}</Caption>
                <input
                  value={head.visibleOdds}
                  onChange={(event) => onPatch(head.key, { visibleOdds: event.target.value })}
                  className={`${field} max-w-36 tabular-nums`}
                  inputMode="decimal"
                  placeholder="1.52"
                  aria-label={`Cuota ${legLabel}`}
                />
              </label>

              {grouped ? (
                <ul className="flex flex-col gap-2">
                  {rows.map((row, index) => (
                    <li key={row.key} className="list-none">
                      <section
                        aria-label={`Selección ${index + 1} ${legLabel}`}
                        className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface px-2.5 pt-2 pb-2"
                      >
                        <div className="flex min-h-6 items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700" aria-hidden="true">
                            Selección {index + 1}
                          </span>
                          <button
                            type="button"
                            className={iconButton}
                            onClick={() => onRemoveRow(row.key)}
                            aria-label={`Quitar la selección ${index + 1} ${legLabel}`}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                        <MarketAndForecast
                          row={row}
                          marketLabel={`Mercado de la selección ${index + 1} ${legLabel}`}
                          forecastLabel={`Pronóstico de la selección ${index + 1} ${legLabel}`}
                          onPatch={onPatch}
                        />
                      </section>
                    </li>
                  ))}
                </ul>
              ) : (
                <MarketAndForecast
                  row={head}
                  marketLabel={`Mercado ${legLabel}`}
                  forecastLabel={`Pronóstico ${legLabel}`}
                  onPatch={onPatch}
                />
              )}

              <button
                type="button"
                className={dashedButton}
                onClick={() => onAddCondition(head.eventGroup)}
                aria-label={
                  grouped
                    ? `Añadir una selección al leg ${n}`
                    : `Convertir el leg ${n} en Creada (añadir otra selección)`
                }
              >
                <PlusIcon className="h-4 w-4" />
                {grouped ? 'Añadir selección a este leg' : 'Convertir en Creada'}
              </button>

              <LegDetails
                head={head}
                rows={rows}
                legLabel={legLabel}
                onPatch={onPatch}
                open={openDetails.has(head.key)}
                toggle={() => toggle(head.key)}
                showConditionStatus={grouped}
              />
            </section>
          );
        })}
      </div>
      {!fixedLeg && (
        <button type="button" className={dashedButton} onClick={onAddLeg}>
          <PlusIcon className="h-4 w-4" />
          Añadir leg
        </button>
      )}
    </FormStep>
  );
}

function MarketAndForecast({
  row,
  marketLabel,
  forecastLabel,
  onPatch,
}: {
  row: SelectionDraft;
  marketLabel: string;
  forecastLabel: string;
  onPatch: LegsEditorProps['onPatch'];
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <Caption>Mercado</Caption>
        <AutoGrowTextarea
          value={row.market}
          onChange={(value) => onPatch(row.key, { market: value })}
          placeholder="Resultado final"
          title={row.market || undefined}
          aria-label={marketLabel}
        />
      </label>
      <label className="flex flex-col gap-1">
        <Caption>Pronóstico</Caption>
        <AutoGrowTextarea
          value={row.selection}
          onChange={(value) => onPatch(row.key, { selection: value })}
          className="font-medium"
          placeholder="Gana Arsenal"
          title={row.selection || undefined}
          aria-label={forecastLabel}
        />
      </label>
    </>
  );
}

// --- Simple y Creada independiente: un solo partido ----------------------------------------------

function SingleEventLegs({
  format,
  selections,
  onPatch,
  onAddCondition,
  onRemoveRow,
  openDetails,
  toggle,
}: InnerProps) {
  const multi = format !== 'SIMPLE';
  const head = selections[0];
  return (
    <>
      {/* Fase 11.4: el partido se pregunta una sola vez para Simple y Creada (todas sus
          selecciones son del mismo evento, §90). */}
      <FormStep compact icon={<CircleIcon />} title="Partido" ariaLabel="Sección Partido">
        <div className={eventSportGrid}>
          <label className="flex min-w-0 flex-col gap-1">
            <Caption>Partido</Caption>
            <AutoGrowTextarea
              value={head?.event ?? ''}
              onChange={(value) => head && onPatch(head.key, { event: value })}
              placeholder="Arsenal vs Manchester City"
              title={head?.event || undefined}
              aria-label="Partido"
            />
          </label>
          <SportSelect
            value={head?.sport ?? DEFAULT_SPORT}
            onChange={(sport) => head && onPatch(head.key, { sport })}
            label="Deporte"
          />
        </div>
      </FormStep>

      <FormStep
        compact
        icon={<MenuIcon />}
        title={multi ? `Selecciones (${selections.length})` : 'Selección'}
        ariaLabel="Selecciones"
      >
        <div className="flex flex-col gap-2">
          {selections.map((selection, index) => {
            const n = index + 1;
            return (
              <section
                key={selection.key}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface-2 px-2.5 pt-2 pb-1.5"
                aria-label={`Selección ${n}`}
              >
                {multi && (
                  <div className="flex min-h-6 items-center justify-between gap-2">
                    <span
                      className="flex items-center gap-2 text-xs font-semibold text-slate-700"
                      aria-hidden="true"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] text-white">
                        {n}
                      </span>
                      Selección {n}
                    </span>
                    {selections.length > 2 && (
                      <button
                        type="button"
                        className={iconButton}
                        onClick={() => onRemoveRow(selection.key)}
                        aria-label={`Quitar la selección ${n}`}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
                <MarketAndForecast
                  row={selection}
                  marketLabel={`Mercado de la selección ${n}`}
                  forecastLabel={`Pronóstico de la selección ${n}`}
                  onPatch={onPatch}
                />
                {multi && (
                  <label className="flex flex-col gap-1">
                    <Caption>
                      Cuota de esta selección{format === 'CREATED' ? ' (opcional)' : ''}
                    </Caption>
                    <input
                      value={selection.visibleOdds}
                      onChange={(event) =>
                        onPatch(selection.key, { visibleOdds: event.target.value })
                      }
                      className={`${field} max-w-36 tabular-nums`}
                      inputMode="decimal"
                      placeholder={format === 'CREATED' ? 'No indicada' : '1.52'}
                      aria-label={`Cuota de la selección ${n}`}
                    />
                  </label>
                )}
                {index === 0 && head && (
                  <LegDetails
                    head={head}
                    rows={selections}
                    legLabel="del ticket"
                    onPatch={onPatch}
                    open={openDetails.has(head.key)}
                    toggle={() => toggle(head.key)}
                    showConditionStatus={multi}
                  />
                )}
              </section>
            );
          })}
        </div>
        {multi && (
          <button
            type="button"
            className={dashedButton}
            onClick={() => onAddCondition(head?.eventGroup ?? 0)}
          >
            <PlusIcon className="h-4 w-4" />
            Añadir selección
          </button>
        )}
      </FormStep>
    </>
  );
}
