import {
  formatOdds,
  formatPEN,
  settleBetSchema,
  TOTAL_ODDS_SOURCES,
  updateBetSchema,
  type BetDraftDetail,
  type BetEntryMode,
  type BetStatus,
  type BetSummary,
  type HouseSummary,
  type TicketSummary,
  type TotalOddsSource,
} from '@letfer/shared';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { betDraftsApi } from '../../api/betDrafts.js';
import { betsApi } from '../../api/bets.js';
import { housesApi, stagesApi } from '../../api/finance.js';
import { describeApiError } from '../../api/errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  BET_STATUS_LABELS,
  BET_TYPE_LABELS,
  formatMoment,
  TOTAL_ODDS_SOURCE_LABELS,
} from '../../labels.js';
import { formatStake, moneyTone, signedPEN } from '../../format.js';
import { Help, TermLabel } from '../../glossary.js';
import {
  ChartIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  DotsIcon,
  FileIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  TicketIcon,
  TrashIcon,
} from '../../icons.js';
import {
  Badge,
  btn,
  btnDanger,
  btnPrimary,
  btnGhost,
  EmptyState,
  inputClass,
  LoadingBlock,
  Modal,
  Notice,
  PageHeader,
} from '../../ui.js';
import { useProject } from './ProjectContext.js';
import {
  BetLedgerPanel,
  ConfirmReturnPanel,
  CorrectSettlementPanel,
  ReopenPanel,
  SettledTrashPanel,
} from './BetFinancialPanels.js';
import { allowsProfitOverride, betDraftFigures, type DraftStatus } from './bet-draft.js';
import { SettlementSection } from './BetSettlementFields.js';
import { BET_STATUS_STYLE } from './bet-status-style.js';
import { betStatusIcon } from './BetStatusBadge.js';
import { DropdownMenu, type DropdownItem } from './DropdownMenu.js';
import { NestedDialog } from './bet-wizard.js';
import { HouseSelect, NewBetForm } from './NewBetForm.js';
import { fromDateTimeParts, nowDateTimeParts, toDateTimeParts } from '../../date-inputs.js';
import { TicketPanel } from './TicketPanel.js';

type SettledStatus = 'WON' | 'LOST' | 'VOID' | 'CASHOUT';
/** Resultados de una apuesta liquidada (§21, §78): los que ofrece el selector de estado. */
const SETTLED_STATUSES: SettledStatus[] = ['WON', 'LOST', 'VOID', 'CASHOUT'];

/** Filtros de la lista por estado (sobre la lista ya cargada; no piden nada nuevo a la API). */
const FILTERS: { key: 'ALL' | BetStatus; label: string }[] = [
  { key: 'ALL', label: 'Todas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'WON', label: 'Ganadas' },
  { key: 'LOST', label: 'Perdidas' },
  { key: 'VOID', label: 'Anuladas' },
  { key: 'CASHOUT', label: 'Cash Out' },
];

/** Apuestas, selecciones y liquidaciones (§18-§27, §90, §107). */
export function BetsPage() {
  const { project, can } = useProject();
  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const [showTrashed, setShowTrashed] = useState(false);
  const canSeeTrashed = can('bets.restore');
  const bets = useLoad(`bets:${project.id}:${showTrashed}`, () =>
    betsApi.list(project.id, showTrashed ? 'TRASHED' : undefined),
  );
  // `?nueva=1` (accesos "Añadir apuesta" del dashboard) abre el formulario directamente.
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(() => searchParams.get('nueva') === '1');
  // Borradores de "Añadir apuesta" (ADR 0024): los del propio usuario, para retomarlos.
  const drafts = useLoad(`bet-drafts:${project.id}`, () =>
    can('bets.create') ? betDraftsApi.list(project.id) : Promise.resolve([]),
  );
  const [activeDraft, setActiveDraft] = useState<BetDraftDetail | null>(null);
  // Cambios sin guardar en el formulario abierto: antes de cerrar se pide qué hacer con ellos.
  const [formDirty, setFormDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const saveDraftRef = useRef<(() => Promise<boolean>) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Id de la apuesta recién registrada: el aviso ofrece abrirla ("Ver apuesta") de inmediato.
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | BetStatus>('ALL');
  const [query, setQuery] = useState('');
  // "Registrar otra apuesta" reinicia el asistente (nuevo formulario, nueva clave de idempotencia)
  // con el mismo origen que se usó la última vez.
  const [formKey, setFormKey] = useState(0);
  const [lastMode, setLastMode] = useState<BetEntryMode | undefined>(undefined);
  // Apuesta recién registrada a destacar unos segundos en la lista ("Ver historial").
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  // El asistente ya registró (está en "Registro completado"): cerrar nunca pregunta.
  const [formRegistered, setFormRegistered] = useState(false);
  const closeForm = () => {
    setShowForm(false);
    setActiveDraft(null);
    setFormDirty(false);
    setFormRegistered(false);
  };
  const requestClose = () => (formDirty && !formRegistered ? setConfirmClose(true) : closeForm());

  const reload = () => {
    bets.reload();
    houses.reload();
  };

  if (!project.setupComplete) {
    return (
      <>
        <PageHeader title="Apuestas" />
        <Notice tone="info">
          Completa primero la{' '}
          <Link to={`/projects/${project.id}/setup`} className="font-medium underline">
            configuración inicial del proyecto
          </Link>
          .
        </Notice>
      </>
    );
  }

  const all = bets.data ?? [];
  const counts = new Map<string, number>([['ALL', all.length]]);
  for (const bet of all) counts.set(bet.status, (counts.get(bet.status) ?? 0) + 1);
  const needle = query.trim().toLocaleLowerCase('es');
  const visible = all.filter(
    (bet) =>
      (filter === 'ALL' || bet.status === filter) &&
      (needle === '' ||
        [bet.houseName, bet.stageName, ...(bet.events ?? []), ...(bet.sports ?? [])]
          .join(' ')
          .toLocaleLowerCase('es')
          .includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Apuestas"
        description={
          showTrashed
            ? 'Apuestas enviadas a la papelera. Puedes restaurarlas si fue un error.'
            : 'Registra cada apuesta, marca su resultado cuando termine el evento y revisa cuánto ganaste o perdiste.'
        }
        actions={
          can('bets.create') &&
          !showForm &&
          !showTrashed && (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setActiveDraft(null);
                setFormDirty(false);
                setShowForm(true);
              }}
            >
              <PlusIcon className="h-4 w-4" />
              Añadir apuesta
            </button>
          )
        }
      />
      {notice && !showForm && (
        <Notice
          tone="success"
          action={
            registeredId && (
              <Link to={`/projects/${project.id}/bets/${registeredId}`} className={btn}>
                Ver apuesta
              </Link>
            )
          }
        >
          {notice}
        </Notice>
      )}

      {can('bets.create') && !showForm && !showTrashed && (drafts.data?.length ?? 0) > 0 && (
        <section
          aria-label="Borradores de apuesta"
          className="flex flex-col gap-2 rounded-2xl border border-violet-200 bg-violet-50/40 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            Borradores sin registrar ({drafts.data!.length})
          </h3>
          <p className="text-xs text-slate-500">
            Un borrador no es una apuesta: no descuenta saldo ni aparece en tus informes hasta que
            lo registres.
          </p>
          <ul className="flex flex-col divide-y divide-violet-200/60">
            {drafts.data!.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words text-slate-900">
                    {draft.summary || 'Borrador sin datos'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Guardado el {formatMoment(draft.updatedAt, true)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btn}
                    aria-label={`Retomar el borrador: ${draft.summary || 'sin datos'}`}
                    onClick={() => {
                      void betDraftsApi
                        .get(project.id, draft.id)
                        .then((detail) => {
                          setActiveDraft(detail);
                          setFormDirty(false);
                          setShowForm(true);
                        })
                        .catch((caught) => setNotice(describeApiError(caught)));
                    }}
                  >
                    Retomar
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    aria-label={`Descartar el borrador: ${draft.summary || 'sin datos'}`}
                    onClick={() => {
                      void betDraftsApi
                        .discard(project.id, draft.id)
                        .then(() => {
                          setRegisteredId(null);
                          setNotice('Borrador descartado.');
                          drafts.reload();
                        })
                        .catch((caught) => setNotice(describeApiError(caught)));
                    }}
                  >
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showForm && (
        <Modal
          variant="wizard"
          onClose={requestClose}
          ariaLabel="Añadir apuesta"
          // Espacio de trabajo ancho y de alto estable desde `lg:` (≈1104 px a 1672 × 941, como la
          // referencia): el ticket necesita alto para compararse con los datos y el panel no "salta"
          // de tamaño al cambiar de paso.
          widthClassName="sm:max-w-[69rem] md:max-h-[96vh] lg:h-[min(60rem,97.5vh)] lg:max-h-none"
        >
          <NewBetForm
            key={`${activeDraft?.id ?? 'nuevo'}:${formKey}`}
            houses={houses.data ?? []}
            initialDraft={activeDraft ?? undefined}
            initialMode={lastMode}
            onDirtyChange={setFormDirty}
            registerSaveDraft={(save) => {
              saveDraftRef.current = save;
            }}
            onDraftsChanged={drafts.reload}
            // Registrar NO cierra: el asistente pasa a "Registro completado". La lista, las casas y los
            // borradores se recargan ya, y el aviso con "Ver apuesta" queda para cuando se cierre.
            onRegistered={(bet, message, mode) => {
              setNotice(message);
              setRegisteredId(bet.id);
              setLastMode(mode);
              setFormRegistered(true);
              // El borrador activo NO se limpia aquí: cambiaría la `key` del formulario y lo
              // remontaría vacío en vez de mostrar "Registro completado". Se limpia al cerrar.
              reload();
              drafts.reload();
            }}
            onRegisterAnother={() => {
              setActiveDraft(null);
              setFormDirty(false);
              setFormRegistered(false);
              setFormKey((key) => key + 1);
            }}
            onViewHistory={(betId) => {
              closeForm();
              setShowTrashed(false);
              setFilter('ALL');
              setQuery('');
              setHighlightId(betId);
            }}
            onGoDashboard={() => {
              closeForm();
              void navigate(`/projects/${project.id}`);
            }}
            onCancel={requestClose}
          />
        </Modal>
      )}

      {showForm && confirmClose && (
        <NestedDialog
          title="¿Salir sin registrar la apuesta?"
          onClose={() => setConfirmClose(false)}
          footer={
            <>
              <button type="button" className={btnGhost} onClick={() => setConfirmClose(false)}>
                Seguir editando
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setConfirmClose(false);
                  setFormDirty(false);
                  setShowForm(false);
                }}
              >
                Descartar y salir
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  void (saveDraftRef.current?.() ?? Promise.resolve(false)).then((saved) => {
                    if (!saved) return;
                    setConfirmClose(false);
                    setShowForm(false);
                  });
                }}
              >
                Guardar borrador y salir
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            Tienes cambios sin guardar. Puedes guardarlos como borrador para retomarlos después: un
            borrador no registra la apuesta ni toca tu saldo.
          </p>
        </NestedDialog>
      )}

      <section
        aria-label="Lista de apuestas"
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-violet-500 ${
                  filter === option.key
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {option.label}
                {bets.data && (
                  <span className="ml-1 opacity-75">{counts.get(option.key) ?? 0}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar partido, casa o deporte"
              aria-label="Buscar apuestas"
              className={`${inputClass} w-64 max-w-full`}
            />
            {canSeeTrashed && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showTrashed}
                  onChange={(event) => setShowTrashed(event.target.checked)}
                  className="h-4 w-4 accent-violet-600"
                />
                Ver la papelera
              </label>
            )}
          </div>
        </div>

        {all.length > 0 && <BetLegend />}

        {bets.error && <Notice tone="error">{bets.error}</Notice>}
        {bets.loading && !bets.data && <LoadingBlock lines={3} label="Cargando apuestas…" />}
        {bets.data && all.length === 0 && (
          <EmptyState
            icon={<TicketIcon />}
            title={showTrashed ? 'La papelera está vacía.' : 'Todavía no hay apuestas.'}
            text={
              showTrashed
                ? 'Aquí aparecen las apuestas eliminadas, para restaurarlas si hace falta.'
                : 'Registra la primera con "Añadir apuesta": eliges la casa, el partido, el stake y la cuota, y LetFer calcula el importe.'
            }
          />
        )}
        {bets.data && all.length > 0 && visible.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Ninguna apuesta coincide con el filtro.{' '}
            <button
              type="button"
              className="font-medium text-violet-700 underline"
              onClick={() => {
                setFilter('ALL');
                setQuery('');
              }}
            >
              Ver todas
            </button>
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {visible.map((bet) => (
            <BetRow
              key={bet.id}
              bet={bet}
              highlighted={bet.id === highlightId}
              houses={houses.data ?? []}
              showTrashed={showTrashed}
              onChanged={(message) => {
                setNotice(message);
                setRegisteredId(null);
                reload();
              }}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

/** Cómo leer cada apuesta: los conceptos de las cifras, con su ayuda. */
function BetLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span>Cómo leer cada apuesta:</span>
      <TermLabel term="stake" />
      <TermLabel term="amount">Importe</TermLabel>
      <TermLabel term="odds" />
      <TermLabel term="ag">Retorno (A+G)</TermLabel>
      <TermLabel term="profit" />
    </p>
  );
}

/** Una cifra de la apuesta: rótulo, valor y, si hace falta, de dónde sale. */
function Figure({
  label,
  note,
  valueClass = 'font-medium text-slate-900',
  children,
}: {
  label: string;
  note?: string;
  valueClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${valueClass}`}>
        {children}
        {note && (
          <>
            {' '}
            <span className="block text-xs font-normal text-slate-500">{note}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function BetRow({
  bet,
  houses,
  showTrashed,
  onChanged,
  highlighted = false,
}: {
  bet: BetSummary;
  houses: HouseSummary[];
  showTrashed: boolean;
  onChanged: (message: string) => void;
  /** Recién registrada desde el asistente ("Ver historial"): se destaca y se lleva a la vista. */
  highlighted?: boolean;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);
  const { project, can } = useProject();
  const { user } = useAuth();
  const runWithReauth = useReauth();
  const [mode, setMode] = useState<
    'view' | 'edit' | 'settle' | 'move' | 'confirm' | 'correct' | 'reopen' | 'trash' | 'restore'
  >('view');
  // Panel de tickets: `view` = solo ver ("Ver ticket"); `manage` = adjuntar/analizar (menú ⋮).
  const [tickets, setTickets] = useState<'none' | 'view' | 'manage'>('none');
  const [showLedger, setShowLedger] = useState(false);
  // Resultado elegido en el selector de estado: abre el panel de siempre con ese resultado.
  const [chosenResult, setChosenResult] = useState<SettledStatus>('WON');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwn = user?.id === bet.createdBy.id;
  const canEdit = can('bets.update_any') || (can('bets.update_own') && isOwn);
  const settled = bet.status !== 'PENDING';
  // Una liquidada tiene efecto en el ledger: eliminarla o restaurarla es del Administrador que puede
  // corregir (D-A11). Una pendiente conserva los permisos de siempre.
  const canTrash = settled
    ? can('bets.correct')
    : can('bets.trash_any') || (can('bets.trash_own') && isOwn);
  const canRestoreBet = can('bets.restore') && (!settled || can('bets.correct'));
  const canCorrect = can('bets.correct') && settled;
  const canConfirmReturn = can('bets.confirm_return') && bet.returnSource === 'CALCULATED';
  // Liquidar es una operación financiera (inserta en el ledger): permiso propio, no depende de
  // la propiedad de la apuesta (revisión de arquitectura previa a integrar la Fase 4).
  const canSettle = can('bets.settle');

  async function trash() {
    setBusy(true);
    setError(null);
    try {
      await betsApi.trash(project.id, bet.id, {});
      onChanged('Se envió la apuesta a la papelera.');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (settled) {
      setMode('restore');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() => betsApi.restore(project.id, bet.id));
      onChanged('Se restauró la apuesta.');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  // Selector de estado: no liquida nada por sí mismo, abre el panel existente con el resultado
  // elegido (mismas reglas y permisos que sus botones de siempre).
  // - Pendiente → un resultado: "Liquidar" (`bets.settle`).
  // - Liquidada → otro resultado: "Corregir liquidación"; → Pendiente: "Reabrir" (`bets.correct`).
  const statusItems: DropdownItem[] =
    showTrashed || mode !== 'view'
      ? []
      : !settled
        ? canSettle
          ? SETTLED_STATUSES.map((result) => ({
              label: BET_STATUS_LABELS[result],
              icon: betStatusIcon(result, 'h-4 w-4'),
              onSelect: () => {
                setChosenResult(result);
                setMode('settle');
              },
            }))
          : []
        : canCorrect
          ? [
              ...SETTLED_STATUSES.filter((result) => result !== bet.status).map((result) => ({
                label: BET_STATUS_LABELS[result],
                icon: betStatusIcon(result, 'h-4 w-4'),
                onSelect: () => {
                  setChosenResult(result);
                  setMode('correct');
                },
              })),
              {
                label: `${BET_STATUS_LABELS.PENDING} (reabrir)`,
                icon: betStatusIcon('PENDING', 'h-4 w-4'),
                onSelect: () => setMode('reopen'),
              },
            ]
          : [];

  // Acciones secundarias: las mismas de siempre, con los mismos permisos, agrupadas en ⋮.
  const menuItems: DropdownItem[] = [];
  if (mode === 'view') {
    if (canConfirmReturn) {
      menuItems.push({
        label: 'Confirmar retorno oficial',
        icon: <CheckCircleIcon className="h-4 w-4" />,
        onSelect: () => setMode('confirm'),
      });
    }
    if (canCorrect) {
      menuItems.push({
        label: 'Corregir liquidación',
        icon: <PencilIcon className="h-4 w-4" />,
        onSelect: () => setMode('correct'),
      });
      menuItems.push({
        label: 'Reabrir',
        icon: <ClockIcon className="h-4 w-4" />,
        onSelect: () => setMode('reopen'),
      });
    }
    if (can('bets.move_stage')) {
      menuItems.push({
        label: 'Mover de etapa',
        icon: <LayersIcon className="h-4 w-4" />,
        onSelect: () => setMode('move'),
      });
    }
  }
  if (can('tickets.upload') || can('tickets.analyze')) {
    menuItems.push({
      label: 'Adjuntar o analizar ticket',
      icon: <FileIcon className="h-4 w-4" />,
      onSelect: () => setTickets((current) => (current === 'manage' ? 'none' : 'manage')),
    });
  }
  if (settled) {
    menuItems.push({
      label: showLedger ? 'Ocultar historial financiero' : 'Historial financiero',
      icon: <ChartIcon className="h-4 w-4" />,
      onSelect: () => setShowLedger((value) => !value),
    });
  }

  const statusLabel = BET_STATUS_LABELS[bet.status];
  const statusClass = `inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${BET_STATUS_STYLE[bet.status]}`;
  const title = (bet.events ?? []).length > 0 ? bet.events.join(' + ') : 'Sin partido';
  const iconButton = `${btn} w-10 px-0`;
  // `bet.effectiveOdds` lo calcula la API con `deriveEffectiveOdds` (retorno ÷ importe, nunca
  // desde el NUMERIC(12,6) crudo de la columna): nunca trae relleno de ceros y se muestra exacto
  // a propósito (Fase 10.9, §5, §7) — es la cifra diagnóstica para que `retorno ÷ importe` sea
  // reproducible, no la cuota "de presentación" (esa es `bet.visibleTotalOdds`, abajo).
  const oddsNote =
    bet.returnSource === 'OFFICIAL' &&
    bet.effectiveOdds !== null &&
    Number(bet.effectiveOdds) !== Number(bet.visibleTotalOdds)
      ? `Cuota efectiva ${bet.effectiveOdds}`
      : bet.totalOddsSource === 'CALCULATED'
        ? '(calculada, referencia)'
        : undefined;

  return (
    <li
      ref={rowRef}
      data-bet-row
      data-highlighted={highlighted || undefined}
      className={`rounded-2xl border bg-surface p-4 transition-colors hover:border-slate-300 ${
        highlighted
          ? 'border-violet-500 shadow-[0_0_0_3px_rgba(124,58,237,0.25)]'
          : 'border-slate-200'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900" title={title}>
            {title}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatMoment(bet.placedAt, bet.placedTimeKnown)} · {bet.houseName} ·{' '}
            {BET_TYPE_LABELS[bet.betType]} · {bet.stageName}
            {(bet.sports ?? []).length > 0 && ` · ${bet.sports.join(', ')}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Link
            to={`/projects/${project.id}/bets/${bet.id}`}
            className={btn}
            aria-label={`Ver apuesta de ${bet.houseName}`}
          >
            Ver apuesta
          </Link>
          {can('tickets.view') &&
            ((bet.ticketCount ?? 0) > 0 ? (
              <button
                type="button"
                className={btn}
                aria-pressed={tickets === 'view'}
                onClick={() => setTickets((current) => (current === 'view' ? 'none' : 'view'))}
              >
                <FileIcon className="h-4 w-4" />
                {tickets === 'view' ? 'Ocultar ticket' : 'Ver ticket'}
              </button>
            ) : (
              <button
                type="button"
                className={`${btn} hidden text-slate-400 sm:inline-flex`}
                disabled
                title="Esta apuesta no tiene ningún ticket adjunto."
              >
                Sin ticket
              </button>
            ))}
          {statusItems.length > 0 ? (
            <DropdownMenu
              label={`Estado: ${statusLabel}`}
              buttonClassName={statusClass}
              buttonContent={
                <>
                  {betStatusIcon(bet.status, 'h-4 w-4')}
                  {statusLabel}
                  <ChevronDownIcon className="h-3.5 w-3.5 opacity-80" />
                </>
              }
              items={statusItems}
            />
          ) : (
            <span className={statusClass} aria-label={`Estado: ${statusLabel}`}>
              {betStatusIcon(bet.status, 'h-4 w-4')}
              {statusLabel}
            </span>
          )}
          {!showTrashed && canEdit && mode === 'view' && (
            <button
              type="button"
              className={iconButton}
              aria-label="Editar"
              title="Editar la apuesta"
              onClick={() => setMode('edit')}
            >
              <PencilIcon className="h-[18px] w-[18px]" />
            </button>
          )}
          {!showTrashed && canTrash && mode === 'view' && (
            <button
              type="button"
              className={`${iconButton} text-red-700 hover:border-red-300 hover:bg-red-50`}
              aria-label="Eliminar"
              title="Eliminar (enviar a la papelera)"
              disabled={busy}
              onClick={() => setMode('trash')}
            >
              <TrashIcon className="h-[18px] w-[18px]" />
            </button>
          )}
          {!showTrashed && menuItems.length > 0 && (
            <DropdownMenu
              label="Más acciones"
              buttonClassName={iconButton}
              buttonContent={<DotsIcon className="h-[18px] w-[18px]" />}
              items={menuItems}
              disabled={busy}
            />
          )}
          {showTrashed && canRestoreBet && mode === 'view' && (
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={() => void restore()}
            >
              Restaurar
            </button>
          )}
        </div>
      </div>

      {/* Jerarquía visual (Fase 11, §9): Importe y Ganancia son los datos que de verdad importan
          de un vistazo, un poco más grandes; Stake, Cuota y A+G son de apoyo, no compiten con ellos. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-5">
        <Figure label="Stake">{formatStake(bet.stake)}</Figure>
        <Figure
          label="Importe"
          note={bet.amountSource === 'CALCULATED' ? '(calculado)' : '(oficial)'}
          valueClass="text-base font-semibold text-slate-900"
        >
          {formatPEN(bet.effectiveAmount)}
        </Figure>
        <Figure label="Cuota" note={oddsNote}>
          {formatOdds(bet.visibleTotalOdds)}
        </Figure>
        <Figure
          label="A+G"
          note={
            bet.effectiveReturn
              ? bet.returnSource === 'CALCULATED'
                ? '(calculado)'
                : '(oficial)'
              : bet.status === 'PENDING'
                ? 'al liquidar'
                : undefined
          }
        >
          {bet.effectiveReturn
            ? formatPEN(bet.effectiveReturn)
            : bet.status === 'LOST'
              ? formatPEN('0.00')
              : '-'}
        </Figure>
        <Figure
          label="Ganancia"
          valueClass={`text-base font-semibold ${moneyTone(bet.profitLoss)}`}
        >
          {bet.profitLoss === null ? '-' : signedPEN(bet.profitLoss)}
        </Figure>
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>
          Registrada por {bet.createdBy.name}
          {bet.reason && ` · ${bet.reason}`}
        </span>
        {bet.returnSource === 'CALCULATED' && (
          <Badge tone="amber" icon={<ClockIcon className="h-3.5 w-3.5" />}>
            Retorno calculado, sin confirmar
          </Badge>
        )}
      </div>

      {tickets !== 'none' && <BetTicketsSection betId={bet.id} readOnly={tickets === 'view'} />}
      {showLedger && settled && <BetLedgerPanel betId={bet.id} />}

      {mode === 'edit' && (
        <EditBetForm
          bet={bet}
          houses={houses}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'settle' && (
        <SettleBetForm
          bet={bet}
          initialStatus={chosenResult}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'move' && (
        <MoveBetStageForm
          bet={bet}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'confirm' && (
        <ConfirmReturnPanel
          bet={bet}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'correct' && (
        <CorrectSettlementPanel
          bet={bet}
          initialStatus={bet.status === chosenResult ? undefined : chosenResult}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'reopen' && (
        <ReopenPanel
          bet={bet}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'trash' && !settled && (
        <div
          role="group"
          aria-label="Confirmar eliminación"
          className="mt-3 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p>
            <strong>¿Eliminar esta apuesta pendiente?</strong> Va a la papelera y deja de reservar
            sus {formatPEN(bet.effectiveAmount)} en {bet.houseName}. Quien tenga permiso puede
            restaurarla desde la papelera.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnDanger}
              disabled={busy}
              onClick={() => void trash()}
            >
              {busy ? 'Eliminando…' : 'Eliminar apuesta'}
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => setMode('view')}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {mode === 'trash' && settled && (
        <SettledTrashPanel
          action="trash"
          label={`la apuesta de ${bet.houseName}`}
          onSubmit={async (reason) => {
            await betsApi.trash(project.id, bet.id, { reason });
            setMode('view');
            onChanged('Se envió la apuesta a la papelera y se revirtió su efecto en el ledger.');
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'restore' && (
        <SettledTrashPanel
          action="restore"
          label={`la apuesta de ${bet.houseName}`}
          onSubmit={async (reason) => {
            await betsApi.restore(project.id, bet.id, { reason });
            setMode('view');
            onChanged('Se restauró la apuesta y se volvió a registrar su efecto en el ledger.');
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

/**
 * Tickets de una apuesta ya registrada (§110). Carga el detalle (que sí trae `tickets`, a
 * diferencia del resumen de la lista) solo cuando se abre este panel. Aplicar un campo de la
 * propuesta de IA (D-T5) reutiliza `PATCH .../bets/:id`, el mismo endpoint de edición de
 * siempre — nunca un camino de escritura propio para tickets/IA (§110.3).
 */
function BetTicketsSection({ betId, readOnly = false }: { betId: string; readOnly?: boolean }) {
  const { project, can } = useProject();
  const detail = useLoad(`bet-detail:${betId}`, () => betsApi.detail(project.id, betId));
  const [error, setError] = useState<string | null>(null);

  async function applyField(formField: string, value: string) {
    if (!detail.data) return;
    setError(null);
    try {
      await betsApi.update(project.id, betId, {
        [formField]: value,
        version: detail.data.version,
      });
      detail.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    }
  }

  async function linkTicket(ticket: TicketSummary) {
    if (!detail.data) return;
    setError(null);
    try {
      await betsApi.update(project.id, betId, {
        ticketId: ticket.id,
        version: detail.data.version,
      });
      detail.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    }
  }

  if (detail.loading && !detail.data) {
    return <p className="mt-3 text-xs text-slate-500">Cargando tickets…</p>;
  }
  if (!detail.data) return null;
  return (
    <div className="mt-3">
      {error && <Notice tone="error">{error}</Notice>}
      <TicketPanel
        projectId={project.id}
        tickets={detail.data.tickets}
        onUploaded={(ticket) => void linkTicket(ticket)}
        onApplyField={(formField, value) => void applyField(formField, value)}
        canUpload={can('tickets.upload')}
        canAnalyze={can('tickets.analyze')}
        readOnly={readOnly}
      />
    </div>
  );
}

function EditBetForm({
  bet,
  houses,
  onDone,
  onCancel,
}: {
  bet: BetSummary;
  houses: HouseSummary[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const isPending = bet.status === 'PENDING';
  const stages = useLoad(`stages:${project.id}`, () => stagesApi.list(project.id));
  const [houseId, setHouseId] = useState(bet.houseId);
  // Edición: la fecha y la hora son las guardadas, nunca la hora actual (convención Fase 10.3).
  const [placed, setPlaced] = useState(() => toDateTimeParts(bet.placedAt));
  const [placedTimeKnown, setPlacedTimeKnown] = useState(bet.placedTimeKnown);
  const [stake, setStake] = useState(bet.stake);
  const [visibleTotalOdds, setVisibleTotalOdds] = useState(bet.visibleTotalOdds);
  const [totalOddsSource, setTotalOddsSource] = useState<TotalOddsSource>(bet.totalOddsSource);
  const [officialAmount, setOfficialAmount] = useState(bet.officialAmount ?? '');
  const [officialPotentialReturn, setOfficialPotentialReturn] = useState(
    bet.officialPotentialReturn ?? '',
  );
  const [reason, setReason] = useState(bet.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const unitStake = stages.data?.find((stage) => stage.id === bet.stageId)?.unitStake ?? null;
  const { amount } = betDraftFigures({
    stake,
    unitStake,
    officialAmount,
    visibleTotalOdds,
    status: 'PENDING',
    profitOverride: '',
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const placedAt = fromDateTimeParts(placed);
    if (isPending && placedAt === null) {
      setError('Indica la fecha y la hora de colocación.');
      return;
    }
    // Solo se envía la fecha si cambió: reescribirla igual obligaría a revalidar su línea de tiempo.
    const placedChanged =
      placedAt !== null &&
      (new Date(placedAt).getTime() !== new Date(bet.placedAt).getTime() ||
        placedTimeKnown !== bet.placedTimeKnown);
    const input = isPending
      ? {
          houseId,
          ...(placedChanged ? { placedAt, placedTimeKnown } : {}),
          stake,
          visibleTotalOdds,
          totalOddsSource,
          officialAmount: officialAmount.trim() === '' ? undefined : officialAmount,
          officialPotentialReturn:
            officialPotentialReturn.trim() === '' ? undefined : officialPotentialReturn,
          reason: reason.trim() === '' ? undefined : reason,
          version: bet.version,
        }
      : { reason: reason.trim() === '' ? undefined : reason, version: bet.version };
    const parsed = updateBetSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await betsApi.update(project.id, bet.id, parsed.data);
      onDone('Se guardaron los cambios.');
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="mt-3 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-label={`Editar apuesta de ${bet.houseName}`}
      noValidate
    >
      <div>
        <h4 className="font-semibold text-slate-900">Editar apuesta</h4>
        <p className="text-sm text-slate-500">
          {isPending
            ? 'Corrige los datos tal como figuran en la casa. El importe se recalcula con el stake.'
            : 'Esta apuesta ya está liquidada: solo se puede corregir el motivo. Para cambiar su resultado usa "Corregir liquidación".'}
        </p>
      </div>
      {isPending && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Fecha
            <input
              type="date"
              value={placed.date}
              onChange={(event) => setPlaced({ ...placed, date: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Hora
            <input
              type="time"
              value={placed.time}
              onChange={(event) => setPlaced({ ...placed, time: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 accent-violet-600"
              checked={!placedTimeKnown}
              onChange={(event) => setPlacedTimeKnown(!event.target.checked)}
            />
            No conozco la hora exacta
          </label>
          <HouseSelect houses={houses} value={houseId} onChange={setHouseId} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Stake
            <input
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Cuota total visible
            <input
              value={visibleTotalOdds}
              onChange={(event) => setVisibleTotalOdds(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Origen de la cuota total
            <select
              value={totalOddsSource}
              onChange={(event) => setTotalOddsSource(event.target.value as TotalOddsSource)}
              className={inputClass}
            >
              {TOTAL_ODDS_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {TOTAL_ODDS_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Monto oficial (opcional)
            <input
              value={officialAmount}
              onChange={(event) => setOfficialAmount(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
            Retorno potencial (opcional)
            <input
              value={officialPotentialReturn}
              onChange={(event) => setOfficialPotentialReturn(event.target.value)}
              className={inputClass}
            />
          </label>
          <div className="rounded-xl bg-violet-50 p-3 text-sm ring-1 ring-violet-200 ring-inset">
            <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
              Importe apostado <Help term="amount" />
            </span>
            <span
              className="block text-lg font-semibold tabular-nums"
              aria-label="Monto apostado calculado"
            >
              {amount === null ? '-' : formatPEN(amount)}
            </span>
            <span className="text-xs text-slate-500">
              {officialAmount.trim() !== ''
                ? 'Monto oficial indicado.'
                : unitStake !== null && amount !== null
                  ? `${formatStake(stake.trim())} × ${formatPEN(unitStake)} (stake × unidad)`
                  : 'Stake × unidad de stake.'}
            </span>
          </div>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Motivo / observaciones
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Resultados con los que se liquida una pendiente (§21, §78). */
const SETTLE_OPTIONS: DraftStatus[] = ['WON', 'LOST', 'VOID', 'CASHOUT'];

/**
 * Liquida una pendiente (H-14, Fase 10.3): la misma sección de resultado que el alta, con las mismas
 * cifras (`bet-draft.ts`). El monto es el de la apuesta (`effectiveAmount`) y la cuota, su cuota
 * visible guardada. Sin tocar la ganancia, una ganada se liquida con el retorno calculado
 * (provisional, que luego se confirma con "Confirmar retorno oficial"); escribiéndola, con el
 * retorno oficial de la casa.
 */
function SettleBetForm({
  bet,
  initialStatus = 'WON',
  onDone,
  onCancel,
}: {
  bet: BetSummary;
  /** Resultado con el que se abre (p. ej. el elegido en el selector de estado de la lista). */
  initialStatus?: DraftStatus;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const [status, setStatus] = useState<DraftStatus>(initialStatus);
  // Operación que ocurre ahora: el momento actual por defecto, editable (convención Fase 10.3).
  const [settled, setSettled] = useState(nowDateTimeParts);
  const [profitOverride, setProfitOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const figures = betDraftFigures({
    stake: bet.stake,
    unitStake: null,
    officialAmount: bet.effectiveAmount,
    visibleTotalOdds: bet.visibleTotalOdds,
    status,
    profitOverride: allowsProfitOverride(status) ? (profitOverride ?? '') : '',
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const settledAt = fromDateTimeParts(settled);
    if (settledAt === null) {
      setError('Indica la fecha y la hora de liquidación.');
      return;
    }
    if (figures.profitOverrideInvalid) {
      setError('Ingresa una ganancia válida, con hasta 2 decimales.');
      return;
    }
    const parsed = settleBetSchema.safeParse({
      status,
      officialRealizedReturn: figures.officialRealizedReturn,
      settledAt,
      version: bet.version,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await betsApi.settle(project.id, bet.id, parsed.data);
      onDone('Se liquidó la apuesta.');
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="mt-3 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-label={`Liquidar apuesta de ${bet.houseName}`}
      noValidate
    >
      <div>
        <h4 className="font-semibold text-slate-900">Liquidar apuesta</h4>
        <p className="text-sm text-slate-600">
          Monto apostado <strong>{formatPEN(bet.effectiveAmount)}</strong> · cuota visible{' '}
          <strong>{formatOdds(bet.visibleTotalOdds)}</strong> · {bet.houseName}. Al confirmar se
          registra el resultado y se libera el importe reservado.
        </p>
      </div>
      <SettlementSection
        options={SETTLE_OPTIONS}
        status={status}
        onStatus={setStatus}
        settled={settled}
        onSettled={setSettled}
        figures={figures}
        profitOverride={profitOverride}
        onProfitOverride={setProfitOverride}
        visibleTotalOdds={bet.visibleTotalOdds}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Liquidando…' : 'Confirmar liquidación'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function MoveBetStageForm({
  bet,
  onDone,
  onCancel,
}: {
  bet: BetSummary;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const runWithReauth = useReauth();
  const stages = useLoad(`stages-for-move:${project.id}`, () => stagesApi.list(project.id));
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (stageId === '') {
      setError('Elige una etapa.');
      return;
    }
    setSubmitting(true);
    try {
      await runWithReauth(() =>
        betsApi.moveStage(project.id, bet.id, { stageId, version: bet.version }),
      );
      onDone('Se movió la apuesta de etapa.');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="mt-3 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-label={`Mover de etapa la apuesta de ${bet.houseName}`}
      noValidate
    >
      <div>
        <h4 className="font-semibold text-slate-900">Mover de etapa</h4>
        <p className="text-sm text-slate-500">
          Ahora está en {bet.stageName}. Cambiarla afecta los reportes por etapa; queda auditado y
          puede pedirte la contraseña.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nueva etapa
        <select
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Elige una etapa
          </option>
          {stages.data
            ?.filter((stage) => stage.id !== bet.stageId && stage.status !== 'TRASHED')
            .map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
        </select>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Moviendo…' : 'Mover'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
