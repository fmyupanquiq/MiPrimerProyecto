import {
  formatOdds,
  formatPEN,
  isOddsString,
  type BetDetail,
  type BetEntryMode,
  type BetStatus,
} from '@letfer/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatStake } from '../../format.js';
import {
  BankIcon,
  BanknoteIcon,
  CalendarIcon,
  ChartBarsIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  CoinsIcon,
  DocumentIcon,
  FlagIcon,
  HomeIcon,
  ImageIcon,
  LayersIcon,
  ListIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  TrophyIcon,
  XCircleIcon,
} from '../../icons.js';
import { BET_TYPE_LABELS } from '../../labels.js';
import { getDisplayTimeZone } from '../../time-zone.js';
import { groupBetLegs } from './bet-legs.js';
import { RESULT_BUTTON_LABELS } from './BetSettlementFields.js';
import { digitalTicketParts, potentialReturnOf } from './BetDetailView.js';
import { Pill, SelectionsTable, Strip, SummaryCard, TicketOriginalCard } from './bet-wizard.js';
import { DigitalTicket } from './DigitalTicket.js';
import { CardIcon, WizardCard } from './WizardCard.js';

/*
 * Paso 3 "Confirmar" del asistente (rediseño de los tres pasos, ADR 0024): "Registro completado".
 * Solo lectura y pintado EXCLUSIVAMENTE con el `BetDetail` que devolvió la API al registrar (nunca con
 * el estado del formulario): casa, fecha en la zona del proyecto, tipo, legs, stake, importe, cuota y
 * su procedencia, retorno potencial y estado. Se exporta en dos piezas (principal y columna derecha).
 */

export interface BetRegisteredProps {
  projectId: string;
  bet: BetDetail;
  origin: BetEntryMode;
  /** Puede ver tickets (`tickets.view`): si no, `bet.tickets` llega vacío y no se muestra imagen. */
  canViewTickets: boolean;
  onViewHistory: () => void;
  onRegisterAnother: () => void;
  onGoDashboard: () => void;
}

const showOdds = (value: string) => (isOddsString(value) ? formatOdds(value) : value);

/**
 * Lo que devolvió la API, con listas siempre presentes: el Paso 3 nunca debe romperse por una
 * respuesta incompleta (se muestra lo que haya, sin inventar nada).
 */
function normalized(bet: BetDetail): BetDetail {
  return {
    ...bet,
    selections: Array.isArray(bet.selections) ? bet.selections : [],
    tickets: Array.isArray(bet.tickets) ? bet.tickets : [],
  };
}

/** dd/mm/aaaa en la zona del proyecto. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: getDisplayTimeZone(),
  });
}

const RESULT_LOOK: Record<
  BetStatus,
  { tone: 'green' | 'red' | 'amber' | 'slate' | 'blue'; icon: ReactNode }
> = {
  WON: { tone: 'green', icon: <TrophyIcon /> },
  LOST: { tone: 'red', icon: <XCircleIcon /> },
  PENDING: { tone: 'amber', icon: <ClockIcon /> },
  VOID: { tone: 'slate', icon: <MinusCircleIcon /> },
  CASHOUT: { tone: 'blue', icon: <CoinsIcon /> },
};
const TEXT_TONES = {
  green: 'text-green-700',
  red: 'text-red-700',
  amber: 'text-amber-700',
  slate: 'text-slate-700',
  blue: 'text-blue-700',
  violet: 'text-violet-700',
} as const;

/** Píldora del resultado (icono + texto, nunca solo color). */
export function ResultPill({ status }: { status: BetStatus }) {
  const look = RESULT_LOOK[status];
  return (
    <Pill tone={look.tone} icon={look.icon}>
      {RESULT_BUTTON_LABELS[status]}
    </Pill>
  );
}

/** Valor del resumen final: icono + texto del color (como la referencia). */
function StatusText({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof TEXT_TONES;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium [&>svg]:h-4 [&>svg]:w-4 ${TEXT_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

function Fact({
  icon,
  label,
  children,
  iconClass = 'text-slate-500',
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  iconClass?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-2.5 py-2">
      <span
        className={`shrink-0 [&>svg]:h-[22px] [&>svg]:w-[22px] ${iconClass}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs whitespace-nowrap text-slate-500">{label}</p>
        <div className="text-[0.95rem] whitespace-nowrap text-slate-900 tabular-nums">
          {children}
        </div>
      </div>
    </div>
  );
}

function figuresOf(bet: BetDetail) {
  const potential = potentialReturnOf(bet);
  return {
    amount: formatPEN(bet.effectiveAmount),
    amountNote: bet.amountSource === 'CONFIRMED' ? 'Oficial' : 'Calculado',
    odds: showOdds(bet.visibleTotalOdds),
    oddsNote:
      bet.totalOddsSource === 'OFFICIAL'
        ? 'Oficial'
        : bet.totalOddsSource === 'CALCULATED'
          ? 'Calculada'
          : 'Origen no verificado',
    potential: formatPEN(potential),
    potentialNote: bet.officialPotentialReturn !== null ? 'Oficial' : 'Calculado',
  };
}

export function BetRegisteredMain({ bet: raw, origin }: BetRegisteredProps) {
  const bet = normalized(raw);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Al entrar al Paso 3 el foco va al título (lo anuncia el lector de pantalla).
  useEffect(() => titleRef.current?.focus(), []);
  const legs = groupBetLegs(bet.selections, bet.betType, bet.visibleTotalOdds);
  const fig = figuresOf(bet);
  const settled = bet.status !== 'PENDING';
  const manual = origin === 'MANUAL';
  // Procedencia (oficial / calculado) bajo la cifra: nunca un calculado se presenta como oficial.
  const note = (text: string) => (
    <span className="block text-[0.65rem] leading-3 text-slate-500">{text}</span>
  );

  return (
    <>
      <section
        aria-label="Registro completado"
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-surface p-3.5"
      >
        <div className="flex items-start gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600"
            aria-hidden="true"
          >
            <CheckIcon className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <h4
              ref={titleRef}
              tabIndex={-1}
              className="text-xl font-semibold text-slate-900 focus:outline-none"
            >
              Registro completado
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              {manual
                ? 'Has ingresado la apuesta manualmente y la has confirmado con éxito. El registro fue guardado en tu historial de apuestas.'
                : 'El ticket fue analizado por IA, verificado por ti y registrado exitosamente en tu historial de apuestas.'}
            </p>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="grid grid-cols-2 divide-slate-200 @[44rem]:grid-cols-4 @[44rem]:divide-x">
            <Fact icon={<BankIcon />} label="Casa de apuestas">
              {bet.houseName}
            </Fact>
            <Fact icon={<CalendarIcon />} label="Fecha">
              {shortDate(bet.placedAt)}
            </Fact>
            <Fact icon={<LayersIcon />} label="Tipo de apuesta">
              {BET_TYPE_LABELS[bet.betType]}
            </Fact>
            <Fact icon={<ListIcon />} label="Selecciones">
              {legs.length}
            </Fact>
          </div>
          <div className="grid grid-cols-2 divide-slate-200 border-t border-slate-200 @[44rem]:grid-cols-5 @[44rem]:divide-x">
            <Fact
              icon={RESULT_LOOK[bet.status].icon}
              label="Resultado"
              iconClass={TEXT_TONES[RESULT_LOOK[bet.status].tone]}
            >
              <ResultPill status={bet.status} />
            </Fact>
            <Fact icon={<CoinsIcon />} label="Stake">
              {formatStake(bet.stake)}
            </Fact>
            <Fact icon={<BanknoteIcon />} label="Monto apostado">
              <span aria-label={`Monto apostado ${fig.amountNote.toLowerCase()}`}>
                {fig.amount}
              </span>
              {note(fig.amountNote)}
            </Fact>
            <Fact icon={<ChartBarsIcon />} label="Cuota total">
              {fig.odds}
              {note(fig.oddsNote)}
            </Fact>
            <Fact icon={<ChartBarsIcon />} label="Monto potencial" iconClass="text-violet-600">
              <span className="font-semibold text-violet-700">{fig.potential}</span>
              {note(fig.potentialNote)}
            </Fact>
          </div>
          {manual && (
            <div className="border-t border-slate-200">
              <Fact icon={<DocumentIcon />} label="Origen del registro">
                <Pill tone="blue" icon={<DocumentIcon />}>
                  Manual
                </Pill>
              </Fact>
            </div>
          )}
        </div>
      </section>

      <WizardCard
        dense
        icon={<ListIcon />}
        title={`Selecciones registradas (${legs.length})`}
        ariaLabel="Selecciones registradas"
      >
        <SelectionsTable legs={legs} variant="registered" />
        <Strip tone="info">
          {settled
            ? 'Si necesitas corregir esta apuesta, hazlo desde su detalle en el historial (corrección con motivo).'
            : 'Podrás editar o actualizar el resultado más adelante desde el historial de apuestas.'}
        </Strip>
      </WizardCard>
    </>
  );
}

function NextStep({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-1 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
    >
      <span className="text-slate-500 [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <ChevronRightIcon className="h-4 w-4 text-slate-500" />
    </button>
  );
}

export function BetRegisteredAside({
  projectId,
  bet: raw,
  origin,
  canViewTickets,
  onViewHistory,
  onRegisterAnother,
  onGoDashboard,
}: BetRegisteredProps) {
  const bet = normalized(raw);
  const manual = origin === 'MANUAL';
  const ticket = canViewTickets ? (bet.tickets[0] ?? null) : null;
  const hasBackup = bet.ticketCount > 0;
  const validated = (
    <StatusText tone="green" icon={<CheckCircleIcon />}>
      Validada
    </StatusText>
  );

  return (
    <>
      {ticket ? (
        <TicketOriginalCard
          projectId={projectId}
          ticket={ticket}
          title={manual ? 'Ticket de respaldo' : 'Ticket original'}
          subtitle={manual ? 'No analizado por IA' : undefined}
          aside={
            manual ? (
              <Pill tone="slate">Adjunto manualmente</Pill>
            ) : (
              <Pill tone="green" icon={<CheckCircleIcon />}>
                Leído por IA
              </Pill>
            )
          }
          imageClassName={manual ? 'h-[11.5rem]' : 'h-[15.5rem]'}
        />
      ) : (
        <section
          aria-label="Ticket digital"
          className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-surface p-3"
        >
          <header className="flex items-center gap-3">
            <CardIcon icon={<DocumentIcon />} />
            <h4 className="text-[0.95rem] font-semibold text-slate-900">Ticket digital</h4>
          </header>
          <div className="max-h-[22rem] overflow-y-auto rounded-lg text-sm">
            <DigitalTicket
              {...digitalTicketParts(bet)}
              status={<ResultPill status={bet.status} />}
              label="Ticket digital de la apuesta registrada"
            />
          </div>
        </section>
      )}

      <SummaryCard
        icon={<ChartBarsIcon />}
        title="Resumen final"
        labelWidth="8.6rem"
        rows={[
          {
            label: 'Estado del registro',
            value: (
              <StatusText tone="green" icon={<CheckCircleIcon />}>
                Completado
              </StatusText>
            ),
          },
          {
            label: 'Resultado',
            value: (
              <StatusText tone={RESULT_LOOK[bet.status].tone} icon={RESULT_LOOK[bet.status].icon}>
                {RESULT_BUTTON_LABELS[bet.status]}
              </StatusText>
            ),
          },
          ...(manual
            ? [
                {
                  label: 'Origen',
                  value: (
                    <StatusText tone="blue" icon={<DocumentIcon />}>
                      Manual
                    </StatusText>
                  ),
                },
                {
                  label: 'Respaldo del ticket',
                  value: hasBackup ? (
                    <StatusText tone="blue" icon={<ImageIcon />}>
                      Adjunto
                    </StatusText>
                  ) : (
                    <StatusText tone="slate" icon={<ImageIcon />}>
                      Sin adjuntar
                    </StatusText>
                  ),
                },
                { label: 'Estructura del registro', value: validated },
              ]
            : [{ label: 'Estructura del ticket', value: validated }]),
        ]}
      />

      <WizardCard icon={<FlagIcon />} title="Próximos pasos" dense compact>
        <div className="flex flex-col gap-2">
          <NextStep icon={<ListIcon />} label="Ver en historial" onClick={onViewHistory} />
          <NextStep
            icon={<PlusCircleIcon />}
            label="Registrar otra apuesta"
            onClick={onRegisterAnother}
          />
          <NextStep icon={<HomeIcon />} label="Volver al dashboard" onClick={onGoDashboard} />
        </div>
      </WizardCard>
    </>
  );
}
