import { calculateBetReturn, formatPEN, type BetDetail, type TicketSummary } from '@letfer/shared';
import { Link, useParams } from 'react-router';
import { betsApi } from '../../api/bets.js';
import { formatStake, moneyTone, signedPEN } from '../../format.js';
import { useLoad } from '../../hooks/useLoad.js';
import { SparkleIcon, TicketIcon } from '../../icons.js';
import { BET_TYPE_LABELS, formatDate, formatDateTime } from '../../labels.js';
import { getDisplayTimeZone } from '../../time-zone.js';
import { Badge, EmptyState, LoadingBlock, Notice, PageHeader } from '../../ui.js';
import { groupBetLegs } from './bet-legs.js';
import { BetStatusBadge } from './BetStatusBadge.js';
import {
  DigitalTicket,
  totalOddsFigures,
  type TicketFact,
  type TicketFigure,
} from './DigitalTicket.js';
import { useProject } from './ProjectContext.js';
import { TicketThumbnail } from './TicketPanel.js';

/*
 * "Ver apuesta": vista de solo lectura de una apuesta ya registrada. Pensada para consultar, no
 * para editar: reutiliza `GET .../bets/:betId` (`BetDetail`) y no ofrece ninguna acción que
 * cambie datos (para eso siguen la lista y sus paneles). Muestra la estructura real — leg por
 * `eventGroup`, selecciones internas por `position` — con la cuota de un leg una sola vez.
 */

const NONE = '—';
const card = 'rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', {
    timeStyle: 'short',
    timeZone: getDisplayTimeZone(),
  });
}

function TicketSection({ projectId, tickets }: { projectId: string; tickets: TicketSummary[] }) {
  if (tickets.length === 0) return null;
  return (
    <section aria-label="Ticket original" className={card}>
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <TicketIcon className="h-4 w-4 text-violet-600" /> Ticket original
      </h3>
      <ul className="mt-3 flex flex-col gap-4">
        {tickets.map((ticket) => {
          // Del análisis solo se muestra lo útil para quien consulta: nunca `errorMessage`, el
          // modelo, el proveedor ni el contenido bruto de la lectura.
          const analysis = ticket.lastAnalysis;
          return (
            <li key={ticket.id} className="flex flex-col gap-3">
              <div className="relative min-h-64 sm:min-h-80">
                <TicketThumbnail projectId={projectId} ticket={ticket} fill />
              </div>
              <p className="truncate text-xs text-slate-500" title={ticket.originalFileName}>
                {ticket.originalFileName} · Subido por {ticket.uploadedBy.name} ·{' '}
                {formatDateTime(ticket.createdAt)}
              </p>
              {analysis && (
                <div
                  aria-label="Análisis de IA"
                  className="flex flex-col gap-1 rounded-xl bg-slate-50 p-3 text-sm"
                >
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    <SparkleIcon className="h-4 w-4 text-violet-600" />
                    Leído con IA
                    {analysis.status === 'COMPLETED' ? (
                      <Badge tone="green">Lectura completada</Badge>
                    ) : (
                      <Badge tone="amber">No se pudo leer</Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    Análisis {analysis.version} · {formatDateTime(analysis.analyzedAt)} ·{' '}
                    {analysis.analyzedBy.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    La IA propone y la persona confirma: lo registrado es lo que se revisó y
                    confirmó.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function BetDetailView() {
  const { betId = '' } = useParams();
  const { project, can } = useProject();
  const backTo = `/projects/${project.id}/bets`;
  const detail = useLoad(`bet-detail-view:${project.id}:${betId}`, () =>
    betsApi.detail(project.id, betId),
  );

  const back = (
    <Link to={backTo} className="text-sm font-medium text-violet-700 underline">
      ← Volver a Apuestas
    </Link>
  );

  if (detail.loading && !detail.data) {
    return <LoadingBlock lines={4} label="Cargando apuesta…" />;
  }
  if (detail.error || !detail.data) {
    return (
      <>
        <PageHeader title="Ver apuesta" actions={back} />
        {detail.errorStatus === 404 ? (
          <EmptyState
            icon={<TicketIcon />}
            title="No encontramos esta apuesta."
            text="Puede que se haya eliminado o que no pertenezca a este proyecto."
          />
        ) : (
          <Notice tone="error">{detail.error ?? 'No se pudo cargar la apuesta.'}</Notice>
        )}
      </>
    );
  }

  const bet: BetDetail = detail.data;
  const legs = groupBetLegs(bet.selections, bet.betType, bet.visibleTotalOdds);
  const structureTitle =
    bet.betType === 'MULTIPLE'
      ? `Múltiple de ${legs.length}`
      : bet.betType === 'CREATED'
        ? `Creada · ${bet.selections.length} selecciones`
        : 'Simple';
  // Mismo cálculo compartido de siempre (monto × cuota visible): se rotula "(calculado)" si no hay
  // un retorno potencial oficial.
  const potentialReturn =
    bet.officialPotentialReturn ?? calculateBetReturn(bet.effectiveAmount, bet.visibleTotalOdds);
  const realized = bet.effectiveReturn ?? (bet.status === 'LOST' ? '0.00' : null);
  const tickets = can('tickets.view') ? bet.tickets : [];

  const facts: TicketFact[] = [
    { label: 'Fecha', value: formatDate(bet.placedAt) },
    { label: 'Hora', value: bet.placedTimeKnown ? timeOf(bet.placedAt) : 'Desconocida' },
    { label: 'Tipo de apuesta', value: BET_TYPE_LABELS[bet.betType] },
    { label: 'Etapa', value: bet.stageName || NONE },
    ...(bet.externalReference
      ? [{ label: 'Referencia del ticket', value: bet.externalReference }]
      : []),
  ];
  const figures: TicketFigure[] = [
    { label: 'Stake', value: formatStake(bet.stake) },
    {
      label: 'Importe apostado',
      value: formatPEN(bet.effectiveAmount),
      note: bet.amountSource === 'CALCULATED' ? '(calculado)' : '(oficial)',
    },
    ...totalOddsFigures(bet.totalOddsSource, bet.visibleTotalOdds),
    {
      label: 'Retorno potencial',
      value: formatPEN(potentialReturn),
      note:
        bet.officialPotentialReturn !== null
          ? '(oficial)'
          : bet.totalOddsSource === 'CALCULATED'
            ? '(calculado con una cuota de referencia)'
            : '(calculado)',
    },
    {
      label: 'Retorno realizado',
      value: realized === null ? NONE : formatPEN(realized),
      note: realized !== null && bet.returnSource === 'CALCULATED' ? '(calculado)' : undefined,
    },
    {
      label: 'Ganancia',
      value: bet.profitLoss === null ? NONE : signedPEN(bet.profitLoss),
      valueClass: moneyTone(bet.profitLoss),
    },
  ];

  return (
    <>
      <PageHeader
        title="Ver apuesta"
        description={`${bet.houseName} · ${BET_TYPE_LABELS[bet.betType]}`}
        actions={back}
      />

      {bet.deletedAt && <Notice tone="warning">Esta apuesta está en la papelera.</Notice>}

      <div className={tickets.length > 0 ? 'grid items-start gap-4 lg:grid-cols-5' : ''}>
        <div className="lg:col-span-3">
          <DigitalTicket
            houseName={bet.houseName}
            structureTitle={structureTitle}
            status={<BetStatusBadge status={bet.status} />}
            facts={facts}
            legs={legs}
            selectionsCount={bet.selections.length}
            figures={figures}
            footnote={
              <>
                Registrada por {bet.createdBy.name} · {formatDateTime(bet.createdAt)}
                {bet.reason ? ` · ${bet.reason}` : ''}
              </>
            }
          />
        </div>

        <div className="lg:sticky lg:top-4 lg:col-span-2">
          <TicketSection projectId={project.id} tickets={tickets} />
        </div>
      </div>
    </>
  );
}
