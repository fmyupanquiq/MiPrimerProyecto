import { formatPEN, type BetEntryMode, type MoneyString } from '@letfer/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatStake, moneyTone, signedPEN } from '../../format.js';
import { BankIcon, InfoIcon, TicketIcon } from '../../icons.js';
import { BET_TYPE_LABELS, formatDate } from '../../labels.js';
import { getDisplayTimeZone } from '../../time-zone.js';
import { reviewImpact, type BetReview } from './bet-review.js';
import { ResultPill } from './BetRegisteredView.js';
import { Strip, SummaryCard } from './bet-wizard.js';
import { DigitalTicket, totalOddsFigures, type TicketFigure } from './DigitalTicket.js';
import { WizardCard } from './WizardCard.js';

/*
 * Paso 3 "Confirmar" del asistente ANTES de registrar (ADR 0024, corrección 2026-10-15): la revisión
 * final, de solo lectura. Se pinta EXCLUSIVAMENTE con `BetReview`, construido a partir del mismo
 * payload validado que "Registrar apuesta" enviará a la API (nunca con el estado suelto del
 * formulario): lo que se ve es lo que se registra. Tras el éxito, el paso pasa a "Registro
 * completado" (`BetRegisteredView`), pintado con la respuesta de la API. Dos piezas: la columna
 * principal (ticket digital) y la derecha (impacto del registro, bajo el ticket original).
 */

export interface BetReviewProps {
  review: BetReview;
  houseName: string;
  /** Disponible actual de la casa (de la lista de casas), para el impacto del registro. */
  houseAvailable: MoneyString | null;
  stageName: string;
  unitStake: MoneyString;
  origin: BetEntryMode;
  /** Avisos del formulario que siguen siendo relevantes (p. ej. monto oficial ≠ stake × unidad). */
  extraWarnings?: readonly string[];
  /** No se eligió resultado: se registra como pendiente. */
  resultUndefined: boolean;
}

const NONE = '—';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', {
    timeStyle: 'short',
    timeZone: getDisplayTimeZone(),
  });
}

function structureTitle(review: BetReview): string {
  if (review.betType === 'MULTIPLE') return `Múltiple de ${review.legs.length}`;
  if (review.betType === 'CREATED')
    return `Creada · ${review.payload.selections.length} selecciones`;
  return 'Simple';
}

/** Avisos de la revisión: nunca bloquean (eso lo decide la validación y, al final, la API). */
function reviewWarnings(props: BetReviewProps): string[] {
  const { review, houseAvailable, houseName } = props;
  const warnings: string[] = [];
  if (review.payload.totalOddsSource === 'CALCULATED') {
    warnings.push(
      'La cuota total es una referencia calculada por LetFer: la casa no la mostró. Se guardará como calculada, nunca como oficial.',
    );
  }
  if (!review.payload.placedTimeKnown) {
    warnings.push('Solo se conoce la fecha de colocación: la hora quedará como desconocida.');
  }
  if (props.resultUndefined) {
    warnings.push('No elegiste un resultado: la apuesta se registrará como pendiente.');
  }
  if (houseAvailable !== null && reviewImpact(review, houseAvailable).insufficient) {
    warnings.push(
      `El disponible de ${houseName} (${formatPEN(houseAvailable)}) no alcanza para ${formatPEN(review.amount)}: el registro será rechazado.`,
    );
  }
  return [...warnings, ...(props.extraWarnings ?? [])];
}

export function BetReviewMain(props: BetReviewProps) {
  const { review, houseName, stageName, unitStake, origin } = props;
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Al entrar a la revisión, el foco va al título (lo anuncia el lector de pantalla).
  useEffect(() => titleRef.current?.focus(), []);
  const { payload } = review;
  const settled = review.status !== 'PENDING';
  const warnings = reviewWarnings(props);

  const figures: TicketFigure[] = [
    { label: 'Stake', value: formatStake(payload.stake) },
    {
      label: 'Importe apostado',
      value: formatPEN(review.amount),
      note: review.amountOfficial ? '(oficial)' : '(calculado: stake × unidad)',
    },
    ...totalOddsFigures(payload.totalOddsSource, payload.visibleTotalOdds),
    {
      label: 'Retorno potencial',
      value: formatPEN(review.potentialReturn),
      note: review.potentialOfficial
        ? '(oficial)'
        : payload.totalOddsSource === 'CALCULATED'
          ? '(calculado con una cuota de referencia)'
          : '(calculado)',
    },
    ...(settled
      ? [
          {
            label: 'Retorno realizado',
            value: review.realizedReturn === null ? NONE : formatPEN(review.realizedReturn),
            // Una perdida no tiene retorno (no es un cálculo): sin procedencia.
            note:
              review.status === 'LOST'
                ? undefined
                : review.realizedOfficial
                  ? '(oficial)'
                  : '(calculado)',
          },
          {
            label: review.profit !== null && review.profit.startsWith('-') ? 'Pérdida' : 'Ganancia',
            value: review.profit === null ? NONE : signedPEN(review.profit),
            valueClass: moneyTone(review.profit),
          },
        ]
      : []),
  ];

  return (
    <>
      <section
        aria-label="Revisión final"
        className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-surface p-3.5"
      >
        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700"
            aria-hidden="true"
          >
            <TicketIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h4
              ref={titleRef}
              tabIndex={-1}
              className="text-lg font-semibold text-slate-900 focus:outline-none"
            >
              Revisa la apuesta antes de registrarla
            </h4>
            <p className="mt-0.5 text-sm text-slate-500">
              Todavía no se ha guardado nada. Este ticket digital es exactamente lo que se
              registrará al pulsar «Registrar apuesta». Para corregir algo, vuelve con «Atrás».
            </p>
          </div>
        </div>
        {warnings.length > 0 && (
          <Strip tone="warning">
            <ul aria-label="Advertencias" className="flex list-disc flex-col gap-0.5 pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Strip>
        )}
      </section>

      <DigitalTicket
        houseName={houseName}
        structureTitle={structureTitle(review)}
        status={<ResultPill status={review.status} />}
        facts={[
          { label: 'Fecha', value: formatDate(payload.placedAt) },
          {
            label: 'Hora',
            value: payload.placedTimeKnown ? timeOf(payload.placedAt) : 'Desconocida',
          },
          { label: 'Tipo de apuesta', value: BET_TYPE_LABELS[review.betType] },
          { label: 'Etapa', value: stageName || NONE },
          { label: 'Unidad de stake', value: formatPEN(unitStake) },
          { label: 'Origen', value: origin === 'MANUAL' ? 'Manual' : 'Ticket con IA' },
        ]}
        legs={review.legs}
        selectionsCount={payload.selections.length}
        figures={figures}
        label="Vista previa del ticket digital"
      />
    </>
  );
}

/** Columna derecha de la revisión: qué hará el registro con el disponible de la casa. */
export function BetReviewAside(props: BetReviewProps) {
  const { review, houseName, houseAvailable } = props;
  const settled = review.realizedReturn !== null;
  const impact = houseAvailable === null ? null : reviewImpact(review, houseAvailable);
  const rows: { label: string; value: ReactNode; note?: string }[] = [
    { label: 'Casa', value: houseName },
    {
      label: 'Disponible actual',
      value: houseAvailable === null ? NONE : formatPEN(houseAvailable),
    },
    {
      label: settled ? 'Monto apostado' : 'Se compromete',
      value: <span className="text-red-700">{signedPEN(`-${review.amount}`)}</span>,
      note: review.amountOfficial ? 'Oficial' : 'Calculado',
    },
    ...(settled
      ? [
          {
            label: 'Retorno',
            value: (
              <span className={moneyTone(review.realizedReturn)}>
                {signedPEN(review.realizedReturn!)}
              </span>
            ),
            note:
              review.status === 'LOST'
                ? undefined
                : review.realizedOfficial
                  ? 'Oficial'
                  : 'Calculado',
          },
        ]
      : []),
    {
      label: 'Disponible después',
      value:
        impact === null ? (
          NONE
        ) : (
          <span className="font-semibold text-slate-900">{formatPEN(impact.availableAfter)}</span>
        ),
    },
  ];
  return (
    <>
      <SummaryCard
        icon={<BankIcon />}
        title="Impacto del registro"
        labelWidth="8.6rem"
        rows={rows}
      />
      <WizardCard icon={<InfoIcon />} title="Al registrar" dense compact>
        <p className="text-sm text-slate-600">
          {settled
            ? `Se registra ya liquidada: el ledger guarda la colocación (${signedPEN(`-${review.amount}`)}) y, si hay retorno, su liquidación.`
            : `Queda pendiente: ${formatPEN(review.amount)} quedan comprometidos y reducen el disponible; el ledger no cambia hasta liquidarla.`}{' '}
          La API vuelve a validar todo antes de guardar.
        </p>
      </WizardCard>
    </>
  );
}
