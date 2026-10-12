import { formatOdds, formatPEN, isOddsString, type MoneyString } from '@letfer/shared';
import type { ReactNode } from 'react';
import type { DateTimeParts } from '../../date-inputs.js';
import { formatStake, signedPEN } from '../../format.js';
import { Help } from '../../glossary.js';
import { ChartIcon, CheckIcon, SparkleIcon } from '../../icons.js';
import { BET_STATUS_LABELS } from '../../labels.js';
import { Badge, inputClass } from '../../ui.js';
import { allowsProfitOverride, type BetDraftFigures, type DraftStatus } from './bet-draft.js';
import { BetStatusBadge, betStatusIcon } from './BetStatusBadge.js';
import { getDisplayTimeZone } from '../../time-zone.js';

/*
 * Piezas comunes de los formularios de apuesta de la Fase 10.3: estilo, pasos numerados y la
 * sección de resultado (resultado, fecha de liquidación, A+G, ganancia y cuota). La usan "Añadir
 * apuesta" y "Liquidar" para que ambas muestren y envíen lo mismo; las cifras las calcula
 * `bet-draft.ts` y la API las vuelve a calcular y validar.
 */

export const field = inputClass;
// `whitespace-nowrap` (Fase 11.2): una etiqueta corta (p. ej. "Stake") nunca se ve afectada; una
// más larga como "Cuota de esta selección (opcional)" ya no se parte en dos líneas por sí sola —
// es quien la coloca (el layout de la fila) quien decide cuánto espacio darle, nunca el texto.
export const smallLabel = 'text-xs font-medium whitespace-nowrap text-slate-500';
export const card =
  'flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-surface p-3 sm:p-4';
// Fase 11.5: misma tarjeta, menos aire — para secciones cortas (Tipo de apuesta, Partido,
// Selecciones) donde el acolchado grande de `card` sumaba altura sin aportar nada; el contenido
// de cada una sigue siendo el mismo, nunca se oculta nada por compactar.
const cardCompact = 'flex flex-col gap-1.5 rounded-xl border border-slate-200/70 bg-surface p-2';
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

/**
 * Progreso del asistente de "Añadir apuesta" (Fase 11.1, §6): tres pasos conceptuales fijos
 * (Origen, Apuesta, Confirmar). Los pasos nunca bloquean el avance — son orientación, no una
 * validación — para no restringir un flujo que el formulario de siempre nunca restringió (solo
 * "Registrar apuesta" valida de verdad, al final). Un paso se marca "completo" solo como pista
 * visual (`done`), nunca como condición para pasar al siguiente.
 */
export function StepIndicator({
  labels,
  current,
  done,
  onSelect,
}: {
  labels: readonly string[];
  current: number;
  /** Qué pasos (por índice) se consideran ya completos, solo para la marca visual. */
  done: readonly boolean[];
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex items-center" aria-label="Pasos para añadir una apuesta">
      {labels.map((label, index) => {
        const active = index === current;
        const complete = done[index] === true;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 sm:text-sm ${
                active
                  ? 'bg-violet-600 text-white shadow-sm'
                  : complete
                    ? 'text-violet-700 hover:bg-violet-50'
                    : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  active
                    ? 'bg-white/25 text-white'
                    : complete
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                }`}
                aria-hidden="true"
              >
                {complete && !active ? <CheckIcon className="h-3 w-3" /> : index + 1}
              </span>
              {label}
            </button>
            {index < labels.length - 1 && (
              <span
                className={`mx-1 h-px flex-1 sm:mx-2 ${complete ? 'bg-violet-300' : 'bg-slate-200'}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type ConfidenceTone = 'ai' | 'calculated' | 'official';

const CONFIDENCE_STYLE: Record<ConfidenceTone, string> = {
  ai: 'bg-violet-50 text-violet-700 ring-violet-200',
  calculated: 'bg-violet-50 text-violet-700 ring-violet-200',
  official: 'bg-blue-50 text-blue-700 ring-blue-200',
};

/**
 * Distingue de un vistazo un dato propuesto por LetFer (detectado por IA o calculado) de uno
 * oficial que de verdad mostró la casa (§9 del encargo de rediseño): nunca el mismo tratamiento
 * visual para los dos. Sustituye al texto suelto que llevaba esta nota antes — mismo contenido,
 * ahora con una señal visual consistente en todos los puntos donde aparece (aquí y en
 * `TicketPanel.tsx`).
 */
export function ConfidenceBadge({ tone, children }: { tone: ConfidenceTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CONFIDENCE_STYLE[tone]}`}
    >
      {tone !== 'official' && <SparkleIcon className="h-3 w-3" />}
      {children}
    </span>
  );
}

const statusTone = (status: DraftStatus) =>
  status === 'WON' ? 'positive' : status === 'LOST' ? 'negative' : 'accent';

/**
 * Un paso del formulario: número, pregunta y una ayuda breve. El número guía el orden de
 * lectura; `ariaLabel` es el nombre de la región (se conserva el de siempre).
 */
export function FormStep({
  step,
  icon,
  title,
  hint,
  ariaLabel,
  /** Fase 11.5: menos acolchado/espaciado vertical — mismo contenido, más denso. */
  compact,
  children,
}: {
  step?: number;
  /** Icono del encabezado de sección (Fase 11.4): mismo medallón que el número de paso. */
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  ariaLabel?: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={compact ? cardCompact : card} aria-label={ariaLabel ?? title}>
      <div className="flex items-center gap-2.5">
        {(step !== undefined || icon) && (
          <span
            className={`flex shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 ${
              compact ? 'h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5' : 'h-8 w-8 [&>svg]:h-4 [&>svg]:w-4'
            }`}
            aria-hidden="true"
          >
            {icon ?? <span className="text-sm font-semibold">{step}</span>}
          </span>
        )}
        <div className="min-w-0">
          <h4
            className={
              compact ? 'text-sm font-semibold text-slate-900' : 'font-semibold text-slate-900'
            }
          >
            {title}
          </h4>
          {hint && <p className="text-sm text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Resumen financiero en vivo del borrador (Fase 11.1, §13, §22): stake, cuota e importe que se va
 * a reservar, y el retorno/ganancia **si la apuesta gana** (vista previa, siempre con la etiqueta
 * "potencial" para no confundirla con el retorno/ganancia reales de `SettlementSection`, que
 * siguen siendo la única fuente para una apuesta ya liquidada — nunca se duplica el mismo dato con
 * dos aspectos distintos, solo se muestra en dos momentos del asistente). Las cifras las sigue
 * calculando exclusivamente `bet-draft.ts`; este componente solo las presenta.
 */
export function FinancialSummary({
  stake,
  shownOdds,
  amount,
  amountNote,
  potentialReturn,
  potentialProfit,
  status,
}: {
  stake: string;
  /** Cuota ya formateada para mostrar (o "-"). */
  shownOdds: string;
  amount: MoneyString | null;
  amountNote?: ReactNode;
  potentialReturn: MoneyString | null;
  potentialProfit: MoneyString | null;
  /** El resultado elegido hasta ahora (§18 Fase 11.3): solo de referencia, se edita en "Confirmar". */
  status?: DraftStatus;
}) {
  // Fase 11.7: panel compacto (cifras en una rejilla con divisores de 1px, no tarjetas apiladas)
  // para que, junto al ticket original, deje a la imagen la mayor parte del alto. Mismas cifras,
  // mismos rótulos y mismo origen (`bet-draft.ts`); solo cambia la presentación. `@container`: la
  // rejilla pasa de 2 a 3 columnas según el ancho real del panel, no el de la ventana.
  const cell = 'flex min-w-0 flex-col gap-0.5 bg-surface px-2.5 py-2';
  const value = 'text-base font-semibold tabular-nums break-words';
  return (
    <div className="@container flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-surface-2 p-3">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700"
            aria-hidden="true"
          >
            <ChartIcon className="h-3.5 w-3.5" />
          </span>
          <Caption>Resumen financiero</Caption>
        </span>
        {status && (
          <dl className="flex items-center gap-1.5">
            <dt className={smallLabel}>Estado</dt>
            <dd>
              <BetStatusBadge status={status} />
            </dd>
          </dl>
        )}
      </span>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 @xs:grid-cols-3">
        <div className={cell}>
          <dt className={smallLabel}>Stake</dt>
          <dd className={`${value} text-slate-900`}>
            {stake.trim() === '' ? '-' : formatStake(stake.trim())}
          </dd>
        </div>
        <div className={cell}>
          <dt className={smallLabel}>Cuota</dt>
          <dd className={`${value} text-slate-900`}>{shownOdds}</dd>
        </div>
        <div className={`${cell} col-span-2 @xs:col-span-1`}>
          <dt className={`${smallLabel} flex items-center gap-1`}>
            Apostado <Help term="amount" />
          </dt>
          <dd
            className="text-lg leading-snug font-bold tracking-tight tabular-nums break-words text-slate-900"
            aria-label="Monto apostado calculado"
          >
            {money(amount)}
          </dd>
        </div>
        <div className={`${cell} @xs:col-span-1`}>
          <dt className={smallLabel}>Retorno potencial</dt>
          <dd className={`${value} text-slate-900`}>{money(potentialReturn)}</dd>
        </div>
        <div className={`${cell} @xs:col-span-2`}>
          <dt className={smallLabel}>Ganancia potencial</dt>
          <dd
            className={`${value} ${
              potentialProfit === null
                ? 'text-slate-900'
                : potentialProfit.startsWith('-')
                  ? 'text-red-700'
                  : 'text-green-700'
            }`}
          >
            {potentialProfit === null ? '-' : signedPEN(potentialProfit)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-0.5 text-xs text-slate-500">
        {amountNote && <span>{amountNote}</span>}
        <span>Vista previa si la apuesta gana. No es el registro final.</span>
      </div>
    </div>
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
