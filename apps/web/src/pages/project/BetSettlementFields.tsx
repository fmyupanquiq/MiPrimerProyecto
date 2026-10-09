import { formatOdds, formatPEN, isOddsString } from '@letfer/shared';
import type { ReactNode } from 'react';
import type { DateTimeParts } from '../../date-inputs.js';
import { signedPEN } from '../../format.js';
import { Help } from '../../glossary.js';
import { BET_STATUS_LABELS } from '../../labels.js';
import { Badge, inputClass } from '../../ui.js';
import { allowsProfitOverride, type BetDraftFigures, type DraftStatus } from './bet-draft.js';
import { betStatusIcon } from './BetStatusBadge.js';
import { getDisplayTimeZone } from '../../time-zone.js';

/*
 * Piezas comunes de los formularios de apuesta de la Fase 10.3: estilo, pasos numerados y la
 * sección de resultado (resultado, fecha de liquidación, A+G, ganancia y cuota). La usan "Añadir
 * apuesta" y "Liquidar" para que ambas muestren y envíen lo mismo; las cifras las calcula
 * `bet-draft.ts` y la API las vuelve a calcular y validar.
 */

export const field = inputClass;
export const smallLabel = 'text-xs font-medium text-slate-500';
export const card =
  'flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-surface p-3 sm:p-4';
export const chip = (selected: boolean, tone: 'accent' | 'positive' | 'negative' = 'accent') =>
  `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 ${
    selected
      ? tone === 'positive'
        ? 'border-green-600 bg-green-600 text-white shadow-sm'
        : tone === 'negative'
          ? 'border-red-600 bg-red-600 text-white shadow-sm'
          : 'border-violet-600 bg-violet-600 text-white shadow-sm'
      : 'border-slate-300 bg-surface text-slate-700 hover:border-violet-400 hover:text-slate-900'
  }`;

export function Caption({ children }: { children: ReactNode }) {
  return <span className={smallLabel}>{children}</span>;
}

export const money = (value: string | null) => (value === null ? '-' : formatPEN(value));

const statusTone = (status: DraftStatus) =>
  status === 'WON' ? 'positive' : status === 'LOST' ? 'negative' : 'accent';

/**
 * Un paso del formulario: número, pregunta y una ayuda breve. El número guía el orden de
 * lectura; `ariaLabel` es el nombre de la región (se conserva el de siempre).
 */
export function FormStep({
  step,
  title,
  hint,
  ariaLabel,
  children,
}: {
  step?: number;
  title: string;
  hint?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className={card} aria-label={ariaLabel ?? title}>
      <div className="flex items-start gap-3">
        {step !== undefined && (
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700"
            aria-hidden="true"
          >
            {step}
          </span>
        )}
        <div className="min-w-0">
          <h4 className="font-semibold text-slate-900">{title}</h4>
          {hint && <p className="text-sm text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Fecha y hora en dos campos contiguos (`date` + `time`, hora local; ver `date-inputs.ts`). */
export function DateTimeFields({
  dateLabel,
  timeLabel,
  value,
  onChange,
}: {
  dateLabel: string;
  timeLabel: string;
  value: DateTimeParts;
  onChange: (value: DateTimeParts) => void;
}) {
  const zone = getDisplayTimeZone();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {dateLabel}
          <input
            type="date"
            value={value.date}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {timeLabel}
          <input
            type="time"
            value={value.time}
            onChange={(event) => onChange({ ...value, time: event.target.value })}
            className={field}
          />
        </label>
      </div>
      {zone && <span className="text-xs text-slate-500">Hora del proyecto ({zone}).</span>}
    </div>
  );
}

/** Una cifra calculada: rótulo con ayuda, valor grande y de dónde sale. */
function Computed({
  label,
  help,
  children,
  note,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-slate-50 p-3">
      <dt className={`${smallLabel} flex items-center gap-1`}>
        {label}
        {help}
      </dt>
      {children}
      {note && <dd className="text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

/**
 * Resultado, fecha de liquidación, A+G, ganancia y cuota.
 *
 * - La ganancia solo es editable en una ganada (para coincidir con la casa) y en un cash out; en
 *   una perdida y una anulada es fija (`allowsProfitOverride`).
 * - Escribirla fija el retorno oficial; la cuota que se muestra pasa a ser la **efectiva**
 *   (A+G ÷ monto) y la visible se conserva tal cual (regla crítica 6).
 */
export function SettlementSection({
  options,
  status,
  onStatus,
  settled,
  onSettled,
  figures,
  profitOverride,
  onProfitOverride,
  visibleTotalOdds,
  notSettleableText,
  step,
}: {
  /** Resultados que se ofrecen; `null` si la persona no puede liquidar (se muestra `notSettleableText`). */
  options: DraftStatus[] | null;
  status: DraftStatus;
  onStatus: (status: DraftStatus) => void;
  settled: DateTimeParts;
  onSettled: (value: DateTimeParts) => void;
  figures: BetDraftFigures;
  profitOverride: string | null;
  onProfitOverride: (value: string | null) => void;
  visibleTotalOdds: string;
  notSettleableText?: string;
  /** Número de paso cuando forma parte de un formulario por pasos. */
  step?: number;
}) {
  const editable = allowsProfitOverride(status);
  const adjusted = editable && profitOverride !== null;
  // Presentación (§7-§8, Fase 10.9): la cuota visible nunca se muestra con más de 2 decimales
  // (p. ej. el relleno de ceros de `NUMERIC(12,6)`); mientras se escribe a mano puede no ser
  // todavía una cuota válida (segunda línea de defensa, Fase 10.7.1) — en ese caso se muestra tal
  // cual, sin intentar formatear algo que `formatOdds` no podría interpretar.
  const trimmedOdds = visibleTotalOdds.trim();
  const shownOdds =
    trimmedOdds === '' ? '-' : isOddsString(trimmedOdds) ? formatOdds(trimmedOdds) : trimmedOdds;
  const pending = status === 'PENDING';

  return (
    <FormStep
      step={step}
      title="¿Cuál es el resultado?"
      hint={
        pending
          ? 'Si el evento aún no terminó, déjala Pendiente: su importe queda reservado hasta liquidarla.'
          : 'Elige cómo terminó. LetFer calcula el retorno y la ganancia; ajústalos si la casa muestra otra cifra.'
      }
      ariaLabel="Resultado y ganancia"
    >
      <div className="flex flex-col gap-2">
        <Caption>Resultado</Caption>
        {options ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Resultado">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                className={chip(status === option, statusTone(option))}
                aria-pressed={status === option}
                onClick={() => {
                  onStatus(option);
                  onProfitOverride(null);
                }}
              >
                {betStatusIcon(option, 'h-4 w-4')}
                {BET_STATUS_LABELS[option]}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600">{notSettleableText}</p>
        )}
      </div>
      {!pending && (
        <DateTimeFields
          dateLabel="Fecha de liquidación"
          timeLabel="Hora de liquidación"
          value={settled}
          onChange={onSettled}
        />
      )}
      {/* También en Pendiente, con "-": se ve qué falta (acordado en la 10.3c). */}
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <Computed
          label="Retorno (A+G)"
          help={<Help term="ag" />}
          note={
            adjusted
              ? 'Ajustado: se guarda como retorno oficial.'
              : status === 'WON'
                ? 'Calculado: importe × cuota. Queda pendiente de confirmar con la casa.'
                : status === 'LOST'
                  ? 'Una perdida no devuelve nada.'
                  : status === 'VOID'
                    ? 'Se devuelve el importe apostado.'
                    : pending
                      ? 'Se calcula al elegir el resultado.'
                      : undefined
          }
        >
          <dd className="text-lg font-semibold tabular-nums" aria-label="A+G">
            {money(figures.returnValue)}
          </dd>
        </Computed>
        <Computed label="Ganancia" help={<Help term="profit" />}>
          {editable ? (
            <dd className="flex flex-col gap-1">
              <input
                value={profitOverride ?? figures.profit ?? ''}
                onChange={(event) => onProfitOverride(event.target.value)}
                className={field}
                inputMode="decimal"
                placeholder={status === 'CASHOUT' ? 'Obligatoria' : ''}
                aria-label="Ganancia"
              />
              {adjusted ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="violet">Ajustada</Badge>
                  <button
                    type="button"
                    className="text-xs text-violet-700 underline"
                    onClick={() => onProfitOverride(null)}
                  >
                    Usar la calculada
                  </button>
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  {status === 'CASHOUT'
                    ? 'Indica la ganancia que pagó la casa.'
                    : 'Calculada; cámbiala si la casa muestra otra.'}
                </span>
              )}
            </dd>
          ) : (
            <dd className="text-lg font-semibold tabular-nums" aria-label="Ganancia calculada">
              {figures.profit === null ? '-' : signedPEN(figures.profit)}
            </dd>
          )}
        </Computed>
        <Computed
          label={adjusted ? 'Cuota efectiva' : 'Cuota'}
          help={<Help term="odds" />}
          note={
            adjusted
              ? `A+G ÷ importe. La casa muestra ${shownOdds}: se guarda como cuota visible y la ganancia, como retorno oficial.`
              : undefined
          }
        >
          <dd className="text-lg font-semibold tabular-nums" aria-label="Cuota resultante">
            {/* La cuota EFECTIVA (A+G ÷ importe) se muestra exacta, nunca a 2 decimales: es la
                cifra diagnóstica para que el retorno sea reproducible (§5, §7 Fase 10.9), a
                diferencia de `shownOdds` (la visible), que ya viene formateada arriba. */}
            {adjusted ? (figures.effectiveOdds ?? '-') : shownOdds}
          </dd>
        </Computed>
      </dl>
    </FormStep>
  );
}
