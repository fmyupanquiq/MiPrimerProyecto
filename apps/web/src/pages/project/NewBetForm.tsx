import {
  compareMoney,
  createBetSchema,
  formatOdds,
  formatPEN,
  isMoneyString,
  isOddsString,
  isStakeString,
  multiplyMoney,
  normalizeMoneyInput,
  resolveTicketOdds,
  subtractMoney,
  draftEntryMode,
  ErrorCode,
  type BetDetail,
  type BetDraftDetail,
  type BetEntryMode,
  type BetType,
  type HouseSummary,
  type TicketAnalysisSummary,
  type TicketExtraction,
  type TicketSummary,
} from '@letfer/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { betDraftsApi } from '../../api/betDrafts.js';
import { betsApi } from '../../api/bets.js';
import { ApiError, ticketFileUrl } from '../../api/client.js';
import { describeApiError } from '../../api/errors.js';
import { ticketsApi } from '../../api/tickets.js';
import { fromDateTimeParts, nowDateTimeParts, type DateTimeParts } from '../../date-inputs.js';
import { formatStake } from '../../format.js';
import { Help } from '../../glossary.js';
import { getDisplayTimeZone } from '../../time-zone.js';
import {
  ArrowRightIcon,
  ChartBarsIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ImageIcon,
  ListIcon,
  PencilIcon,
  PlusCircleIcon,
  PlusIcon,
  SaveIcon,
  SparkleIcon,
  SpinnerIcon,
  TicketIcon,
  TrashIcon,
  TrophyIcon,
  XCircleIcon,
  DocumentIcon,
  InfoIcon,
} from '../../icons.js';
import { BET_TYPE_LABELS, TOTAL_ODDS_SOURCE_LABELS } from '../../labels.js';
import { Badge, btn, btnPrimary, hintClass, Notice } from '../../ui.js';
import { BetEntryAside, BetEntryMain, type AnalysisState } from './BetEntryStep.js';
import { BetRegisteredAside, BetRegisteredMain } from './BetRegisteredView.js';
import { CLIPBOARD_EMPTY_MESSAGE, readClipboardImage, ticketFileProblem } from './ticket-files.js';
import { useIsNarrow } from '../AppShell.js';
import { allowsProfitOverride, betDraftFigures, type DraftStatus } from './bet-draft.js';
import { collectCompleteIndividualOdds, deriveStakeFromAmount } from './ticket-prefill.js';
import {
  Caption,
  ConfidenceBadge,
  field,
  RESULT_BUTTON_LABELS,
  SettlementSection,
} from './BetSettlementFields.js';
import {
  addCondition,
  addLeg,
  draftsFromExtraction,
  formatFromExtraction,
  newSelection,
  patchRow,
  removeLeg,
  removeRow,
  restructure,
  toSelectionInputs,
  type SelectionDraft,
} from './bet-selection-drafts.js';
import { LegsEditor } from './LegsEditor.js';
import { useProject } from './ProjectContext.js';
import {
  draftPreviewLegs,
  draftStructureIssues,
  legOddsProduct,
  resolveTotalOddsSource,
} from './draft-ticket-preview.js';
import {
  AiDetectedBadge,
  NestedDialog,
  Pill,
  Strip,
  wizardButton,
  SelectionsTable,
  SummaryCard,
  TicketOriginalCard,
  WizardBanner,
  WizardHeader,
  WizardStepper,
  type BannerKind,
  type SummaryRow,
} from './bet-wizard.js';
import { WizardCard } from './WizardCard.js';
import {
  draftSummaryText,
  payloadToSnapshot,
  snapshotToPayload,
  type FormSnapshot,
} from './bet-draft-state.js';

/*
 * Formulario "Añadir apuesta" dentro de `<Modal variant="wizard">` (rediseño de los tres pasos, ADR
 * 0024; corrección 2026-10-14: el registro vuelve al Paso 3):
 *   1. Añadir apuesta — solo el ORIGEN (ticket con IA o manual) y el archivo (`BetEntryStep`).
 *   2. Verificar datos — TODO el formulario, editable. "Continuar" solo avanza al Paso 3: nunca
 *      valida contra el backend ni registra (nada envía aquí: ni Enter, ni el stepper).
 *   3. Confirmar — ANTES de registrar, un resumen de solo lectura de todo lo que se va a guardar
 *      (`summaryCard`, selecciones y ticket), pintado con el estado del formulario. "Registrar
 *      apuesta" es el ÚNICO punto que valida y registra (nada más envía). Si falla, se queda aquí
 *      (se puede volver al Paso 2 a corregir). Si tiene éxito, el MISMO paso pasa a mostrar
 *      "Registro completado" (`BetRegisteredView`), de solo lectura y pintado con el `BetDetail`
 *      que devuelve la API; ya no se puede volver a los pasos anteriores.
 * Entre 1 y 2, y entre 2 y 3 (antes de registrar), se va y vuelve sin perder nada: los pasos se
 * ocultan, nunca se desmontan.
 *
 * La etapa nunca se elige aquí: toda apuesta nueva va a la etapa activa del proyecto (§1); para
 * cambiarla después está "Mover de etapa" (`bets.move_stage`, con reautenticación). Solo organiza
 * la entrada y muestra las cifras que calcula `bet-draft.ts` con las funciones de `@letfer/shared`;
 * la API vuelve a calcular y validar todo al registrar, y es quien deriva el tipo de apuesta de la
 * estructura de selecciones (§90).
 */

// --- Selecciones --------------------------------------------------------------------------------

/**
 * Formato elegido: decide cómo se organizan las selecciones para que el tipo que la API derive
 * (§90) sea justamente ese: una selección (Simple), varios eventos (Múltiple) o varias
 * selecciones del mismo evento (Creada).
 */
const FORMATS: BetType[] = ['SIMPLE', 'MULTIPLE', 'CREATED'];
/**
 * Mapea el texto libre de "resultado" que puede devolver la IA (§9, Fase 10.7) a uno de los
 * estados reales del dominio. Sin coincidencia clara, `null` — nunca se adivina (se queda
 * Pendiente, el valor por defecto de siempre).
 */
function statusFromResultText(text: string | undefined): DraftStatus | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (/^(won|ganada|gan[oó])$/.test(t)) return 'WON';
  if (/^(lost|perdida|perdi[oó])$/.test(t)) return 'LOST';
  if (/^(void|anulada|cancelad[oa]|cancelled)$/.test(t)) return 'VOID';
  if (/cash ?out/.test(t)) return 'CASHOUT';
  if (/^(pending|pendiente)$/.test(t)) return 'PENDING';
  return null;
}

// --- Casa -----------------------------------------------------------------------------------

export function HouseSelect({
  houses,
  value,
  onChange,
  className = '',
  label = 'Casa',
}: {
  houses: HouseSummary[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${className}`}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={field}>
        <option value="" disabled>
          Elige una casa
        </option>
        {houses
          .filter((house) => house.status === 'ACTIVE')
          .map((house) => (
            <option key={house.id} value={house.id}>
              {house.name}
            </option>
          ))}
      </select>
    </label>
  );
}

const DRAFT_STATUS_OPTIONS: DraftStatus[] = ['PENDING', 'WON', 'LOST', 'VOID', 'CASHOUT'];
/**
 * Atajos de stake (Fase 10.6): solo 10/20/30/40/50, todos visibles. Son accesos rápidos, no un
 * límite del modelo — "Otra cantidad" admite cualquier otro valor válido (p. ej. 15 o 25).
 */
const QUICK_STAKES = [10, 20, 30, 40, 50] as const;

/**
 * Las tres etapas del asistente: 1 Añadir apuesta (origen y archivo), 2 Verificar datos (todo el
 * formulario, editable, sin registrar) y 3 Confirmar (resumen de solo lectura con "Registrar
 * apuesta"; tras el éxito, el mismo paso pasa a mostrar "Registro completado" con la respuesta de
 * la API).
 */
const STEP_LABELS = ['Añadir apuesta', 'Verificar datos', 'Confirmar'] as const;

// --- Formulario ---------------------------------------------------------------------------------

export function NewBetForm({
  houses,
  onRegistered,
  onCancel,
  onRegisterAnother,
  onViewHistory,
  onGoDashboard,
  initialMode,
  initialDraft,
  onDirtyChange,
  registerSaveDraft,
  onDraftsChanged,
}: {
  houses: HouseSummary[];
  /**
   * La apuesta quedó registrada (la API respondió): quien contiene el formulario recarga la lista,
   * las casas y los borradores AHORA, sin cerrar el modal (el asistente pasa a "Registro completado").
   */
  onRegistered: (bet: BetDetail, message: string, mode: BetEntryMode) => void;
  /** Cerrar (✕, Escape, "Cancelar", "Cerrar"). */
  onCancel: () => void;
  /** "Registrar otra apuesta": reiniciar el asistente vacío. */
  onRegisterAnother?: () => void;
  /** "Ver historial": cerrar y destacar la apuesta en la lista. */
  onViewHistory?: (betId: string) => void;
  /** "Volver al dashboard". */
  onGoDashboard?: () => void;
  /** Origen con el que empieza un formulario nuevo (el usado la última vez). */
  initialMode?: BetEntryMode;
  /** Borrador que se retoma (ADR 0024); sin él, un formulario nuevo y vacío. */
  initialDraft?: BetDraftDetail;
  /** Avisa si hay cambios sin guardar ni registrar (para confirmar antes de cerrar). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Entrega a quien cierra el modal la acción de guardar el borrador (guardar y salir). */
  registerSaveDraft?: (save: () => Promise<boolean>) => void;
  /** Se guardó o descartó un borrador: la lista de borradores debe recargarse. */
  onDraftsChanged?: () => void;
}) {
  const { project, can } = useProject();
  // Registrar con resultado también liquida: solo se ofrece a quien puede liquidar (la API lo exige).
  const canSettle = can('bets.settle');
  // Resumen financiero (Fase 11.1, §22): en una columna derecha fija desde `lg:`, o en línea solo
  // en el paso "Confirmar" por debajo de ese ancho — en un único lugar a la vez (nunca los dos
  // montados a la vez: ni el mismo dato repetido en pantalla ni duplicado para quien usa un
  // lector de pantalla). Por debajo de `lg:` (1024px) no hay columna derecha.
  const narrow = useIsNarrow(1023);

  // Borrador que se retoma: el estado inicial sale de él; sin borrador, todo vacío (ADR 0024).
  const [init] = useState<FormSnapshot | null>(() =>
    initialDraft ? payloadToSnapshot(initialDraft.payload) : null,
  );
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [draftVersion, setDraftVersion] = useState(initialDraft?.version ?? 0);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  // Cambios sin guardar ni registrar: un borrador recién retomado empieza limpio.
  const [dirty, setDirty] = useState(false);
  // Un solo envío a la vez (el estado `submitting` llega tarde para un doble clic muy rápido) y una
  // clave de idempotencia por intento: si se pierde la respuesta, reintentar no duplica la apuesta.
  const submitLock = useRef(false);
  const clientRequestId = useRef<string>(crypto.randomUUID());
  // Edición de un leg desde "Verificar datos" (`eventGroup` del leg abierto, o ninguno).
  const [editingLeg, setEditingLeg] = useState<number | null>(null);

  // Paso visible (0 Añadir, 1 Verificar datos, 2 Confirmar). Entre 0, 1 y 2 se va y vuelve libremente
  // mientras no se haya registrado (`registered === null`); una vez registrada, ya no se vuelve.
  const [step, setStep] = useState(0);
  // La apuesta tal como la devolvió la API al registrar: mientras sea `null`, el Paso 3 muestra el
  // resumen del formulario (nada registrado todavía); en cuanto se registra, se pinta SOLO con ella.
  const [registered, setRegistered] = useState<BetDetail | null>(null);
  // El registro ya ocurrió: el asistente queda bloqueado hacia adelante y no se vuelve atrás.
  const confirmed = step === 2 && registered !== null;

  // Origen del registro: con IA solo si se puede subir Y analizar; si no, manual (deshabilitado).
  const aiAllowed = can('tickets.upload') && can('tickets.analyze');
  const [entryMode, setEntryMode] = useState<BetEntryMode>(() => {
    const wanted = initialDraft
      ? draftEntryMode(initialDraft.payload)
      : (initialMode ?? (aiAllowed ? 'AI' : 'MANUAL'));
    return wanted === 'AI' && !aiAllowed ? 'MANUAL' : wanted;
  });
  // Subida del archivo (Paso 1): estado, error seguro y vista previa local (URL de objeto) o remota.
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<{ ticketId: string; url: string } | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  // Análisis con IA del Paso 1: solo con "Analizar y continuar", nunca al subir (D-T4).
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'idle' });
  // Ticket cuya lectura ya está aplicada al formulario: "Continuar" no vuelve a gastar un análisis.
  const [analyzedTicketId, setAnalyzedTicketId] = useState<string | null>(
    initialDraft?.payload.aiApplied ? initialDraft.payload.ticketId : null,
  );

  // La URL de objeto de la vista previa se libera al cambiar de archivo o al cerrar.
  useEffect(() => {
    if (!localPreview) return;
    return () => URL.revokeObjectURL(localPreview.url);
  }, [localPreview]);

  // Creación: fecha y hora actuales por defecto (convención de la Fase 10.3), editables.
  const [placed, setPlaced] = useState<DateTimeParts>(() => init?.placed ?? nowDateTimeParts());
  const [placedTimeKnown, setPlacedTimeKnown] = useState(init?.placedTimeKnown ?? true);
  const [houseId, setHouseId] = useState(init?.houseId ?? '');
  const [format, setFormat] = useState<BetType>(init?.format ?? 'SIMPLE');
  const [selections, setSelections] = useState<SelectionDraft[]>(
    () => init?.selections ?? [newSelection(0, 0)],
  );
  const [totalOdds, setTotalOdds] = useState(init?.totalOdds ?? '');
  // Procedencia declarada de la cuota total en una Múltiple/Creada (ADR 0023): oficial de la casa o
  // referencia calculada. `null` hasta que la lectura de IA la fije o la persona la elija; nunca se
  // supone que lo tecleado es oficial.
  const [oddsKindChoice, setOddsKindChoice] = useState<'OFFICIAL' | 'CALCULATED' | null>(
    init?.oddsKindChoice ?? null,
  );
  // Sin stake inicial y sin atajo seleccionado: un valor por defecto oculto haría aparecer un
  // importe (stake × unidad) que nadie introdujo ni el ticket mostró. Solo existe lo que la persona
  // elige, escribe o la IA extrae.
  const [stake, setStake] = useState(init?.stake ?? '');
  /** El stake rápido (5-50) tiene su fila de botones; "Otra cantidad" revela el campo manual. */
  const [customStake, setCustomStake] = useState(init?.customStake ?? false);
  const [status, setStatus] = useState<DraftStatus>(init?.status ?? 'PENDING');
  // El resumen no afirma "Pendiente" mientras nadie haya elegido ni leído un estado: "Sin definir".
  // Al registrar, sin elección, la apuesta sigue quedando Pendiente (el comportamiento de siempre).
  const [statusChosen, setStatusChosen] = useState(init?.statusChosen ?? false);
  // El resultado lo propuso una lectura de IA (nunca se afirma "detectado por IA" si lo eligió la persona).
  const [statusFromAi, setStatusFromAi] = useState(init?.statusFromAi ?? false);
  const [settled, setSettled] = useState<DateTimeParts>(() => init?.settled ?? nowDateTimeParts());
  /** `null`: la ganancia calculada; texto: la escrita para coincidir con la casa. */
  const [profitOverride, setProfitOverride] = useState<string | null>(init?.profitOverride ?? null);
  const [officialAmount, setOfficialAmount] = useState(init?.officialAmount ?? '');
  const [officialPotentialReturn, setOfficialPotentialReturn] = useState(
    init?.officialPotentialReturn ?? '',
  );
  const [reason, setReason] = useState(init?.reason ?? '');
  const [showOptional, setShowOptional] = useState(false);
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prellenado por IA (Fase 10.7, §1-§14): un análisis completo rellena el formulario entero de
  // una vez; si la persona ya corrigió algo a mano, una nueva lectura pide confirmación antes de
  // reemplazar (nunca pisa silenciosamente una corrección manual).
  const [formTouchedSinceApply, setFormTouchedSinceApply] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<TicketAnalysisSummary | null>(null);
  const [appliedNotice, setAppliedNotice] = useState(init?.aiApplied ?? false);
  // Fase 2 (§114): se quitó/cambió el ticket después de aplicar una lectura de IA. Los datos del
  // formulario ya no pertenecen a la imagen nueva: la persona decide descartarlos o conservarlos.
  const [staleAiData, setStaleAiData] = useState(false);
  // Fase 10.7.1: dinero de la IA que no se pudo normalizar con seguridad (p. ej. "S/10.72" no es
  // la forma interna) — se avisa y se deja sin rellenar, nunca se fuerza ni rompe el formulario.
  const [unreadableMoneyFields, setUnreadableMoneyFields] = useState<string[]>([]);
  // Fase 10.8.1 (§1-§2, §9-§11) y Fase 10.9 (§2-§4): cuando el ticket no muestra la cuota total
  // pero sí hay suficiente información para calcularla (retorno real/potencial ÷ importe, o el
  // producto de TODAS las cuotas individuales), LetFer la calcula y la usa para poder registrar —
  // nunca se afirma que la casa la mostró. Se compara contra el valor actual del campo en cada
  // render (no un flag aparte): si la persona lo edita, deja de "ser" la calculada sin necesidad
  // de limpiar nada a mano (§11, §16).
  const [calculatedOdds, setCalculatedOdds] = useState<{ value: string; note: string } | null>(
    init?.calculatedOdds ?? null,
  );

  function markTouched() {
    setFormTouchedSinceApply(true);
    setDirty(true);
    setDraftMessage(null);
  }

  const snapshot: FormSnapshot = {
    format,
    houseId,
    placed,
    placedTimeKnown,
    selections,
    totalOdds,
    oddsKindChoice,
    calculatedOdds,
    stake,
    customStake,
    status,
    statusChosen,
    statusFromAi,
    settled,
    profitOverride,
    officialAmount,
    officialPotentialReturn,
    reason,
    ticketId: ticket?.id ?? null,
    aiApplied: appliedNotice,
    entryMode,
  };

  /** Guarda el borrador (crea o actualiza). No registra nada financiero. Devuelve si se guardó. */
  async function saveDraft(): Promise<boolean> {
    if (savingDraft) return false;
    setSavingDraft(true);
    setDraftMessage(null);
    setError(null);
    const body = {
      payload: snapshotToPayload(snapshot),
      summary: draftSummaryText(houses.find((h) => h.id === houseId)?.name ?? null, selections),
    };
    try {
      const saved = draftId
        ? await betDraftsApi.update(project.id, draftId, { ...body, version: draftVersion })
        : await betDraftsApi.create(project.id, body);
      setDraftId(saved.id);
      setDraftVersion(saved.version);
      setDirty(false);
      setDraftMessage('Borrador guardado.');
      onDraftsChanged?.();
      return true;
    } catch (caught) {
      setError(describeApiError(caught));
      return false;
    } finally {
      setSavingDraft(false);
    }
  }

  // El modal que contiene el formulario pide "guardar y salir" con la versión más reciente.
  useEffect(() => {
    registerSaveDraft?.(saveDraft);
  });

  // Se retoma un borrador con ticket: se recupera su resumen (la imagen sigue en el servidor).
  useEffect(() => {
    const ticketId = init?.ticketId;
    if (!ticketId || !can('tickets.view')) return;
    let cancelled = false;
    ticketsApi
      .get(project.id, ticketId)
      .then((recovered) => {
        if (!cancelled) setTicket(recovered);
      })
      .catch(() => undefined); // si el ticket ya no existe, el borrador sigue siendo utilizable
    return () => {
      cancelled = true;
    };
    // Solo al montar: `init` y `project.id` no cambian durante la vida del formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // (Fase 10.5, §1): una apuesta nueva siempre va a la etapa activa; nunca se elige al
  // registrarla (para moverla después está "Mover de etapa", con reautenticación).
  const stage = project.activeStage;

  if (stage === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900">Añadir apuesta</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
          <Notice tone="warning">No hay una etapa activa para registrar apuestas.</Notice>
          <p className="text-sm text-slate-500">
            Crea una etapa o reactiva una existente: toda apuesta nueva se registra en la etapa
            activa del proyecto.
          </p>
          <Link
            to={`/projects/${project.id}/stages`}
            onClick={onCancel}
            className={`${btnPrimary} self-start`}
          >
            Ir a Etapas
          </Link>
        </div>
        <footer className="flex items-center gap-2 border-t border-slate-200 bg-surface p-4 sm:p-5">
          <button type="button" className={btn} onClick={onCancel}>
            Cancelar
          </button>
        </footer>
      </div>
    );
  }

  // Capturado en una constante aparte: `stage` no se reduce a no-nulo dentro de las funciones
  // anidadas más abajo (p. ej. `applyExtractionData`), aunque ya se descartó `null` arriba.
  const unitStake = stage.unitStake;
  const visibleTotalOdds = format === 'SIMPLE' ? (selections[0]?.visibleOdds ?? '') : totalOdds;
  const figures = betDraftFigures({
    stake,
    unitStake,
    officialAmount,
    visibleTotalOdds,
    status,
    profitOverride: allowsProfitOverride(status) ? (profitOverride ?? '') : '',
  });

  // Partido y deporte son del LEG: `patchRow` los comparte con las demás filas del mismo leg.
  function updateSelection(key: number, patch: Partial<SelectionDraft>) {
    markTouched();
    setSelections((list) => patchRow(list, key, patch));
  }

  function chooseFormat(next: BetType) {
    markTouched();
    setFormat(next);
    setSelections((list) => restructure(next, list, format));
  }

  // Estructura TICKET → LEG → CONDICIÓN (§114): una Múltiple admite legs de varias filas.
  function addLegCard() {
    markTouched();
    setSelections((list) => addLeg(list));
  }

  function addConditionTo(eventGroup: number) {
    markTouched();
    setSelections((list) => addCondition(list, eventGroup));
  }

  function removeSelection(key: number) {
    markTouched();
    setSelections((list) => restructure(format, removeRow(list, key)));
  }

  function removeLegCard(eventGroup: number) {
    markTouched();
    setSelections((list) => restructure(format, removeLeg(list, eventGroup)));
  }

  /**
   * Quita la imagen (o la cambia por otra, que es lo mismo). Si ya se había aplicado una lectura de
   * IA, esos datos NO se atribuyen en silencio al ticket nuevo: se deja de rotular "Analizado por IA" y
   * se pregunta si descartarlos o conservarlos como manuales.
   */
  function detachTicket() {
    setTicket(null);
    setLocalPreview(null);
    setImageSize(null);
    setFileError(null);
    setAnalysis({ kind: 'idle' });
    setAnalyzedTicketId(null);
    setDirty(true);
    setStep(0);
    if (appliedNotice) {
      setAppliedNotice(false);
      setStatusFromAi(false);
      setPendingAnalysis(null);
      setStaleAiData(true);
    }
  }

  /**
   * Sube un archivo como ticket (o como respaldo en modo Manual): valida tipo y tamaño en el cliente
   * con el mismo criterio del backend y NO lo analiza (D-T4). Si ya había uno, lo reemplaza.
   */
  async function uploadTicketFile(file: File) {
    const problem = ticketFileProblem(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setUploading(true);
    setFileError(null);
    try {
      const uploaded = await ticketsApi.upload(project.id, file);
      if (ticket) detachTicket();
      setDirty(true);
      setTicket(uploaded);
      setImageSize(null);
      setAnalysis({ kind: 'idle' });
      // Vista previa local inmediata (sin volver a descargar la imagen); si el navegador no ofrece
      // URLs de objeto, se usa el archivo del servidor.
      setLocalPreview(
        file.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
          ? { ticketId: uploaded.id, url: URL.createObjectURL(file) }
          : null,
      );
    } catch (caught) {
      setFileError(describeApiError(caught));
    } finally {
      setUploading(false);
    }
  }

  async function pasteFromClipboard() {
    setFileError(null);
    const file = await readClipboardImage();
    if (file) await uploadTicketFile(file);
    else setFileError(CLIPBOARD_EMPTY_MESSAGE);
  }

  /**
   * Cambia el origen. El archivo NUNCA se borra: con IA → Manual pasa a ser un respaldo; con Manual →
   * IA queda listo para analizar. Si ya se había aplicado una lectura de IA y se pasa a Manual, los
   * datos se conservan como manuales y se avisa (misma decisión que al cambiar la imagen).
   */
  function chooseMode(next: BetEntryMode) {
    if (next === entryMode) return;
    if (next === 'AI' && !aiAllowed) return;
    setEntryMode(next);
    setDirty(true);
    setAnalysis({ kind: 'idle' });
    if (next === 'MANUAL' && appliedNotice) {
      setAppliedNotice(false);
      setStatusFromAi(false);
      setPendingAnalysis(null);
      setStaleAiData(true);
    }
  }

  /**
   * "Analizar y continuar": UNA llamada a la IA por pulsación. Una lectura completa (o parcial) se
   * aplica con la lógica de siempre y se pasa a "Verificar datos"; un fallo deja a la persona en el
   * Paso 1 con "Reintentar" o "Continuar en modo Manual". Nunca se llama en modo Manual.
   */
  async function analyzeTicket() {
    if (!ticket || entryMode !== 'AI' || analysis.kind === 'analyzing') return;
    setAnalysis({ kind: 'analyzing' });
    try {
      const result = await ticketsApi.analyze(project.id, ticket.id);
      if (result.status !== 'COMPLETED') {
        setAnalysis({
          kind: 'failed',
          message: 'No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.',
        });
        return;
      }
      handleAnalyzed(result);
      setAnalyzedTicketId(ticket.id);
      setAnalysis({ kind: 'analyzed' });
      setStep(1);
    } catch (caught) {
      // Un fallo de la IA tiene un motivo seguro conocido; nunca se muestra texto técnico del proveedor.
      setAnalysis({
        kind: 'failed',
        message:
          caught instanceof ApiError && caught.code === ErrorCode.INTERNAL_ERROR
            ? 'No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.'
            : describeApiError(caught),
      });
    }
  }

  /** Tras un fallo del análisis: sigue a mano, con la imagen como respaldo (sin volver a analizar). */
  function continueManually() {
    chooseMode('MANUAL');
    setAnalysis({ kind: 'idle' });
  }

  /**
   * "Añadir selección" (Verificar datos): abre el editor sobre un leg nuevo. Si la única fila está
   * vacía, se edita esa; una Simple completa pasa a Múltiple; en una Creada se añade una condición.
   * Siempre con las funciones puras de `bet-selection-drafts.ts`.
   */
  function addSelectionFromReview() {
    const blank = (row: SelectionDraft) => row.event.trim() === '' && row.selection.trim() === '';
    if (selections.length === 1 && blank(selections[0]!)) {
      setEditingLeg(selections[0]!.eventGroup);
      return;
    }
    markTouched();
    if (format === 'CREATED') {
      const group = selections[0]?.eventGroup ?? 0;
      setSelections(addCondition(selections, group));
      setEditingLeg(group);
      return;
    }
    const base = format === 'SIMPLE' ? restructure('MULTIPLE', selections, 'SIMPLE') : selections;
    if (format === 'SIMPLE') setFormat('MULTIPLE');
    // Pasar de Simple a Múltiple ya crea un leg vacío; si no, se añade uno.
    const hasBlankLeg = base.some((row) => row.position === 0 && blank(row));
    const next = hasBlankLeg ? base : addLeg(base);
    setSelections(next);
    const target =
      next.find((row) => row.position === 0 && blank(row))?.eventGroup ??
      Math.max(...next.map((row) => row.eventGroup));
    setEditingLeg(target);
  }

  /** Vuelve el formulario a su estado inicial: sin stake, sin cuota, sin importes, sin estado. */
  function resetForm() {
    setPlaced(nowDateTimeParts());
    setPlacedTimeKnown(true);
    setHouseId('');
    setFormat('SIMPLE');
    setSelections([newSelection(0, 0)]);
    setTotalOdds('');
    setOddsKindChoice(null);
    setStake('');
    setCustomStake(false);
    setStatus('PENDING');
    setStatusChosen(false);
    setStatusFromAi(false);
    setSettled(nowDateTimeParts());
    setProfitOverride(null);
    setOfficialAmount('');
    setOfficialPotentialReturn('');
    setReason('');
    setShowOptional(false);
    setCalculatedOdds(null);
    setUnreadableMoneyFields([]);
    setFormTouchedSinceApply(false);
    setAppliedNotice(false);
    setPendingAnalysis(null);
    setStaleAiData(false);
    setError(null);
  }

  /**
   * Prellena el formulario ENTERO a partir de una lectura de IA (§1, §12, Fase 10.7): no es un
   * panel aparte con "usar este valor" campo por campo — los valores detectados terminan en los
   * campos reales, como si la persona los hubiera escrito. Solo se toca lo que el ticket sí pudo
   * leer; lo demás se deja exactamente como estaba (nunca se inventa, §2-§10). Sigue siendo
   * 100% editable después, y nada se registra hasta "Registrar apuesta" (§21 de la fase previa).
   */
  function applyExtraction(extraction: TicketExtraction) {
    try {
      applyExtractionData(extraction);
    } catch {
      // Segunda línea de defensa (§7, §13, §16, Fase 10.7.1): si algo inesperado de la IA
      // revienta el prellenado, nunca debe tumbar el formulario — se avisa y se pide revisión
      // manual en vez de una pantalla en blanco. La causa raíz (dinero sin normalizar) se
      // corrige abajo, en `applyExtractionData`; esto es solo la red de seguridad.
      setUnreadableMoneyFields(['algunos datos del ticket']);
      setAppliedNotice(true);
      setFormTouchedSinceApply(false);
      setPendingAnalysis(null);
    }
  }

  function applyExtractionData(extraction: TicketExtraction) {
    const unreadable: string[] = [];
    // Fase 10.7.1: dinero extraído por la IA puede venir con el símbolo de soles (p. ej.
    // "S/10.72"), que no es la forma interna (`isMoneyString`). Se normaliza aquí, en el límite
    // IA → formulario, para no dejar que un string así llegue a `compareMoney`/`multiplyMoney`
    // más abajo ni contaminar el resto del modelo financiero con cifras con símbolo.
    function readMoney(raw: string | undefined, label: string): string | null {
      if (!raw) return null;
      const normalized = normalizeMoneyInput(raw);
      if (normalized === null) unreadable.push(label);
      return normalized;
    }

    if (extraction.house) {
      const needle = extraction.house.trim().toLowerCase();
      const match = houses.find(
        (h) => h.status === 'ACTIVE' && h.name.trim().toLowerCase() === needle,
      );
      if (match) setHouseId(match.id);
    }

    // §2: la fecha/hora del ticket manda cuando existe; nunca se usa "ahora" como sustituto de
    // un dato que la IA no pudo leer (el "ahora" por defecto, de abrir el formulario, ya estaba).
    if (extraction.placedDate) {
      const date = extraction.placedDate;
      setPlaced((p) => ({ date, time: extraction.placedTime ?? p.time }));
      setPlacedTimeKnown(Boolean(extraction.placedTime));
    } else if (extraction.placedTime) {
      const time = extraction.placedTime;
      setPlaced((p) => ({ ...p, time }));
    }

    // Dinero normalizado por adelantado (antes de decidir la cuota): la cuota calculada (más
    // abajo) necesita el importe y el retorno real/potencial, se pueda o no liquidar (§1-§2,
    // Fase 10.8.1) — por eso ya no se leen solo dentro de `if (canSettle)`.
    const normalizedAmount = readMoney(extraction.officialAmount, 'Monto apostado');
    const normalizedRealized = readMoney(extraction.officialRealizedReturn, 'Retorno oficial');
    const normalizedPotential = readMoney(extraction.officialPotentialReturn, 'Retorno potencial');
    if (normalizedAmount) setOfficialAmount(normalizedAmount);
    if (normalizedPotential) setOfficialPotentialReturn(normalizedPotential);
    // El retorno potencial leído se ve en la tesela "Monto potencial · Oficial" de Verificar datos:
    // no hace falta abrir "Datos opcionales" (que haría desplazar la verificación).

    const items = extraction.selections ?? [];

    // Jerarquía de la cuota (§9-§11, Fase 10.8.1; §2-§4, Fase 10.9): la visible del ticket manda
    // siempre; si no existe, LetFer calcula una efectiva con retorno real o potencial ÷ importe;
    // si tampoco hay retorno pero SÍ todas las cuotas individuales, usa su producto como cuota de
    // referencia (nunca si falta la de alguna selección: eso sería inventar, §2). Nunca sustituye
    // una visible existente.
    const oddsResolution = resolveTicketOdds({
      officialTotalOdds: extraction.officialTotalOdds,
      officialAmount: normalizedAmount ?? undefined,
      officialRealizedReturn: normalizedRealized ?? undefined,
      officialPotentialReturn: normalizedPotential ?? undefined,
      individualOdds: collectCompleteIndividualOdds(items),
    });
    // Nota a aplicar junto al campo "Cuota" (§11, §15, Fase 10.8.1; §2, §9, Fase 10.9): nunca
    // afirma que la casa mostró este valor. El producto de las selecciones es solo una
    // referencia (nunca tan exacto como retorno ÷ importe): se redondea a 2 decimales con el
    // mismo formatter de presentación de siempre antes de usarlo como cuota registrable — la
    // precisión completa del cálculo sigue disponible en `resolveTicketOdds`/`multiplyOdds` para
    // quien la necesite (p. ej. el panel del ticket), nunca se pierde, solo no es la que se
    // propone aquí.
    let calculatedOddsInfo: { value: string; note: string } | null = null;
    if (!oddsResolution.visible && oddsResolution.effective) {
      const { value, source } = oddsResolution.effective;
      if (source === 'SELECTIONS_PRODUCT') {
        calculatedOddsInfo = {
          value: formatOdds(value),
          note: 'Calculada desde las selecciones: producto de sus cuotas individuales. Es una referencia, no la cuota oficial de la casa.',
        };
      } else {
        const basisReturn = source === 'REALIZED_RETURN' ? normalizedRealized : normalizedPotential;
        if (normalizedAmount && basisReturn) {
          calculatedOddsInfo = {
            value,
            note:
              `Calculada automáticamente: retorno ${formatPEN(basisReturn)}` +
              `${source === 'POTENTIAL_RETURN' ? ' (potencial)' : ''} ÷ apuesta ` +
              `${formatPEN(normalizedAmount)}. Edítala si la casa muestra otra cifra.`,
          };
        }
      }
    }
    const oddsToApply = oddsResolution.visible
      ? { value: oddsResolution.visible, calculated: false }
      : calculatedOddsInfo
        ? { value: calculatedOddsInfo.value, calculated: true }
        : null;

    let effectiveFormat = format;
    if (items.length > 0) {
      const resolvedFormat = formatFromExtraction(extraction.betType, items);
      let drafts = draftsFromExtraction(extraction.betType, items);
      // §6: para Simple, la cuota total (visible, o calculada si no hay visible) es la misma
      // cifra que la cuota de la única selección — se prefiere por ser la lectura más directa.
      if (resolvedFormat === 'SIMPLE' && oddsToApply) {
        drafts = [{ ...drafts[0]!, visibleOdds: oddsToApply.value }];
      }
      setFormat(resolvedFormat);
      setSelections(drafts);
      effectiveFormat = resolvedFormat;
    }
    if (oddsToApply && effectiveFormat !== 'SIMPLE') {
      setTotalOdds(oddsToApply.value);
      // La cuota visible del ticket es oficial; una calculada se detecta por coincidencia (abajo).
      setOddsKindChoice(oddsToApply.calculated ? null : 'OFFICIAL');
    } else if (oddsToApply && items.length === 0) {
      // Simple sin selecciones nuevas en esta lectura: la cuota total va a la única selección.
      const odds = oddsToApply.value;
      setSelections((list) => list.map((s, i) => (i === 0 ? { ...s, visibleOdds: odds } : s)));
    }
    // Solo para que la interfaz pueda rotular la cuota como calculada (nunca decide nada
    // financiero): si no se usó una calculada, no hay nada que rotular.
    setCalculatedOdds(calculatedOddsInfo);

    // §3-§5: el stake real solo se extrae si el ticket lo muestra EXPLÍCITAMENTE como tal; si no,
    // LetFer lo calcula de forma determinista (`importe ÷ unidad de la etapa activa`, NUNCA con
    // la cuota, el retorno o la ganancia) — la IA nunca adivina ni LetFer redondea a un atajo
    // "parecido" (5.36 nunca se vuelve 5, §19).
    if (extraction.stake && isStakeString(extraction.stake.trim())) {
      const value = extraction.stake.trim();
      setStake(value);
      setCustomStake(!(QUICK_STAKES as readonly number[]).includes(Number(value)));
    } else if (normalizedAmount) {
      const derived = deriveStakeFromAmount(normalizedAmount, unitStake, QUICK_STAKES);
      if (derived) {
        setStake(derived.stake);
        setCustomStake(!derived.isPreset);
      }
    }

    // §9-§10: el resultado solo se propone a quien puede liquidar (la API lo exige igual que en
    // el alta manual); sin coincidencia clara, se queda Pendiente, el valor por defecto de siempre.
    if (canSettle) {
      const mappedStatus = statusFromResultText(extraction.result);
      if (mappedStatus) {
        setStatus(mappedStatus);
        setStatusChosen(true);
        setStatusFromAi(true);
        if (allowsProfitOverride(mappedStatus) && normalizedRealized && normalizedAmount) {
          setProfitOverride(subtractMoney(normalizedRealized, normalizedAmount));
        }
      }
    }

    setUnreadableMoneyFields(unreadable);
    setFormTouchedSinceApply(false);
    setAppliedNotice(true);
    setPendingAnalysis(null);
  }

  /**
   * Una lectura completada prellena el formulario entero de una sola vez (§12): nunca "usar este
   * valor" uno por uno. Si ya se había corregido algo a mano desde el último prellenado, pide
   * confirmación antes de reemplazar (§14) — la IA propone, la persona decide.
   */
  function handleAnalyzed(result: TicketAnalysisSummary) {
    if (result.status !== 'COMPLETED') return; // el error ya se ve en el panel del ticket
    if (formTouchedSinceApply) setPendingAnalysis(result);
    else applyExtraction(result.extraction);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Solo "Registrar apuesta" (Paso 3, Confirmar, antes de tener éxito) registra: Enter en un
    // campo, "Continuar", "Atrás", "Editar ticket" o el stepper nunca envían nada. Y un único envío
    // a la vez (doble clic). Cualquier problema deja a la persona en este paso, con el error visible
    // y nada perdido.
    if (step !== 2 || registered !== null || submitLock.current) return;
    // Un envío que no venga del botón "Registrar apuesta" (Enter implícito, script) no registra.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLElement) || submitter.dataset['action'] !== 'register') return;
    setError(null);
    if (houseId === '') {
      setError('Elige una casa.');
      return;
    }
    const placedAt = fromDateTimeParts(placed);
    if (placedAt === null) {
      setError('Indica la fecha y la hora de colocación.');
      return;
    }
    const usesOfficialAmountValue = officialAmount.trim() !== '';
    const settles = status !== 'PENDING';
    const settledAt = settles ? fromDateTimeParts(settled) : null;
    if (settles && settledAt === null) {
      setError('Indica la fecha y la hora de liquidación.');
      return;
    }
    if (figures.profitOverrideInvalid) {
      setError('Ingresa una ganancia válida, con hasta 2 decimales.');
      return;
    }
    // El importe se determina con las reglas de siempre (monto oficial, o stake × unidad): si no
    // hay ninguno de los dos, se pide aquí — nunca se supone un stake.
    let stakeToSend = stake;
    if (stake.trim() === '') {
      const derived =
        figures.amount !== null && usesOfficialAmountValue
          ? deriveStakeFromAmount(figures.amount, unitStake, QUICK_STAKES)
          : null;
      if (derived) stakeToSend = derived.stake;
      else {
        setError('Indica el stake o el monto oficial para determinar el importe apostado.');
        return;
      }
    }
    if (totalOddsSource === null) {
      setError(
        'Indica si la cuota total la muestra la casa (oficial) o es una referencia calculada.',
      );
      return;
    }
    const parsed = createBetSchema.safeParse({
      houseId,
      stake: stakeToSend,
      visibleTotalOdds,
      totalOddsSource,
      clientRequestId: clientRequestId.current,
      officialAmount: officialAmount.trim() === '' ? undefined : officialAmount,
      officialPotentialReturn:
        officialPotentialReturn.trim() === '' ? undefined : officialPotentialReturn,
      placedAt,
      placedTimeKnown,
      reason: reason.trim() === '' ? undefined : reason,
      selections: toSelectionInputs(selections, format),
      ticketId: ticket?.id,
      settlement:
        settles && settledAt !== null
          ? { status, officialRealizedReturn: figures.officialRealizedReturn, settledAt }
          : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    try {
      const registered = await betsApi.create(project.id, parsed.data);
      // Solo se avisa del éxito después de que el backend lo confirme. El borrador ya cumplió su
      // función: se descarta (si no se pudiera, queda en la lista y se puede descartar a mano).
      if (draftId) {
        try {
          await betDraftsApi.discard(project.id, draftId);
          onDraftsChanged?.();
        } catch {
          /* el borrador queda; no afecta a la apuesta ya registrada */
        }
      }
      setDirty(false);
      // "Registro completado" se pinta con la respuesta de la API, nunca con el formulario. El
      // cerrojo queda puesto: esta apuesta ya no se vuelve a enviar.
      setRegistered(registered);
      setStep(2);
      setSubmitting(false);
      onRegistered(
        registered,
        settles
          ? 'Apuesta registrada correctamente (ya liquidada).'
          : 'Apuesta registrada correctamente.',
        entryMode,
      );
    } catch (caught) {
      setError(describeApiError(caught));
      // Una respuesta 4xx significa que NO se creó nada: el siguiente intento usa otra clave. Sin
      // respuesta (red) o 5xx el resultado es incierto: se conserva la clave y reintentar no duplica.
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        clientRequestId.current = crypto.randomUUID();
      }
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const multi = format !== 'SIMPLE';
  const house = houses.find((candidate) => candidate.id === houseId) ?? null;
  const exceedsAvailable =
    house !== null && figures.amount !== null && compareMoney(figures.amount, house.available) > 0;
  // Vista previa "si gana": el mismo cálculo compartido, con el resultado Ganada.
  const ifWon = betDraftFigures({
    stake,
    unitStake,
    officialAmount,
    visibleTotalOdds,
    status: 'WON',
    profitOverride: '',
  });
  const usesOfficialAmount = officialAmount.trim() !== '';
  // §7 (Fase 10.7): el importe del ticket no sustituye silenciosamente a stake × unidad — si
  // difieren, se avisa con las dos cifras; la regla financiera (cuál manda) no cambia aquí.
  const calculatedOnlyAmount = isStakeString(stake.trim())
    ? multiplyMoney(stage.unitStake, stake.trim())
    : null;
  // Segunda línea de defensa (Fase 10.7.1): un valor inválido (de la IA o escrito a mano) nunca
  // debe llegar a `compareMoney` — se ignora para esta comparación en vez de reventar el render.
  const amountMismatch =
    usesOfficialAmount &&
    isMoneyString(officialAmount.trim()) &&
    calculatedOnlyAmount !== null &&
    compareMoney(officialAmount.trim(), calculatedOnlyAmount) !== 0;

  // §1-§2, §11, §16 (Fase 10.8.1): mientras el valor del campo coincida con el que LetFer calculó
  // (retorno ÷ importe), se rotula como "Calculada automáticamente", nunca como la que muestra la
  // casa. Si la persona la edita, deja de coincidir y el rótulo desaparece solo — la corrección
  // manual queda tal cual, sin que nada la vuelva a pisar.
  const oddsIsCalculated =
    calculatedOdds !== null && calculatedOdds.value === visibleTotalOdds.trim();

  const totalOddsSource = resolveTotalOddsSource({
    format,
    isCalculated: oddsIsCalculated,
    choice: oddsKindChoice,
  });
  const oddsProduct = legOddsProduct(selections, format);

  const amountNote = usesOfficialAmount ? (
    <ConfidenceBadge tone="official">Monto oficial indicado</ConfidenceBadge>
  ) : figures.amount !== null ? (
    `${formatStake(stake.trim())} × ${formatPEN(stage.unitStake)} (stake × unidad)`
  ) : (
    'Sin datos todavía: indica el stake o el monto, o analiza el ticket con IA.'
  );

  // Procedencia de la cuota total, DENTRO del campo (como una unidad): nunca se confunde una cuota
  // calculada por LetFer con la que muestra la casa.
  const oddsBadge = oddsIsCalculated ? (
    <ConfidenceBadge tone="calculated">
      <span aria-hidden="true">Calculada</span>
      <span className="sr-only">Calculada por LetFer</span>
    </ConfidenceBadge>
  ) : multi && totalOddsSource === 'OFFICIAL' && visibleTotalOdds.trim() !== '' ? (
    <ConfidenceBadge tone="official">
      <span aria-hidden="true">Oficial</span>
      <span className="sr-only">Cuota oficial de la casa</span>
    </ConfidenceBadge>
  ) : null;
  const oddsInput = (
    <div className="flex flex-col gap-1">
      {/* Rótulo visible "Cuota total" (como la referencia); el nombre accesible lo amplía: es la
          cuota que muestra la casa, no un cálculo de LetFer. */}
      <label htmlFor="bet-total-odds" className="text-[0.8rem] whitespace-nowrap text-slate-700">
        {multi ? 'Cuota total' : 'Cuota'}
      </label>
      <div className="relative">
        <input
          id="bet-total-odds"
          value={multi ? totalOdds : (selections[0]?.visibleOdds ?? '')}
          onChange={(event) => {
            // El cambio manual cuenta como corrección (§16, Fase 10.8.1/10.9): sin esto, una
            // nueva lectura del ticket podría pisarla sin pedir confirmación (§14).
            markTouched();
            if (multi) {
              setTotalOdds(event.target.value);
              setOddsKindChoice(null); // otra cifra: hay que volver a declarar su procedencia
            } else updateSelection(selections[0]!.key, { visibleOdds: event.target.value });
          }}
          className={`${field} tabular-nums ${oddsBadge ? 'pr-[5.4rem]' : ''}`}
          inputMode="decimal"
          placeholder={multi ? (step === 1 ? '—' : 'La de la casa') : '1.95'}
          aria-label={multi ? 'Cuota total visible' : 'Cuota de la selección 1'}
          title={oddsIsCalculated && calculatedOdds ? calculatedOdds.note : undefined}
        />
        {oddsBadge && (
          <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2">
            {oddsBadge}
          </span>
        )}
      </div>
    </div>
  );

  // Sin stake elegido pero con importe oficial: el stake es importe ÷ unidad (derivado, nunca asumido).
  const derivedStake =
    stake.trim() === '' && usesOfficialAmount && figures.amount !== null
      ? (deriveStakeFromAmount(figures.amount, unitStake, QUICK_STAKES)?.stake ?? null)
      : null;
  const previewLegs = draftPreviewLegs(selections, format, visibleTotalOdds);

  // --- Presentación del asistente (3 pasos) ---------------------------------------------------------

  const aiApplied = appliedNotice;
  const legCount = previewLegs.length;
  const stakeShown = stake.trim() !== '' ? formatStake(stake.trim()) : (derivedStake ?? null);
  const missingForReview: string[] = [];
  if (houseId === '') missingForReview.push('la casa');
  if (figures.amount === null) missingForReview.push('el monto o el stake');
  if (visibleTotalOdds.trim() === '') missingForReview.push('la cuota total');
  if (canSettle && !statusChosen) missingForReview.push('el resultado');
  const isManual = entryMode === 'MANUAL';
  // Solo se dice "leído por IA" si de verdad se aplicó una lectura y el origen sigue siendo IA.
  const aiRead = aiApplied && !isManual;
  const bannerKind: BannerKind = aiRead
    ? missingForReview.length > 0
      ? 'ai-partial'
      : 'ai-complete'
    : !isManual && ticket
      ? 'ticket-unanalyzed'
      : 'manual';
  const subtitle =
    step === 0
      ? 'Carga tu ticket o registra una apuesta manualmente.'
      : step === 1
        ? aiRead
          ? 'Revisa los datos extraídos por IA y confirma que la información sea correcta.'
          : 'Completa los datos de tu apuesta y confirma que la información sea correcta.'
        : registered
          ? 'La apuesta ha sido confirmada y registrada en tu historial.'
          : 'Revisa el resumen completo antes de registrar la apuesta.';

  const officialPotential =
    officialPotentialReturn.trim() !== '' && isMoneyString(officialPotentialReturn.trim())
      ? officialPotentialReturn.trim()
      : null;
  // Una vez liquidada con un retorno oficial confirmado (ganancia ajustada a mano o desde el
  // "Ganancias"/"Retorno" que ya muestra el ticket, §77), ya no hay nada "potencial" que calcular:
  // esa es la cifra, y manda sobre cualquier estimación (regla crítica: lo oficial de la casa
  // prevalece sobre lo calculado). Antes de liquidar, sigue siendo la del ticket o, a falta de
  // ella, la vista previa "si gana" (`ifWon`).
  const confirmedReturn = figures.officialRealizedReturn ?? null;
  const potentialValue = confirmedReturn ?? officialPotential ?? ifWon.returnValue;
  const potentialNote = confirmedReturn
    ? 'Oficial'
    : officialPotential
      ? 'Oficial (ticket)'
      : ifWon.returnValue !== null
        ? totalOddsSource === 'CALCULATED'
          ? 'Calculado · cuota de referencia'
          : 'Calculado: monto × cuota'
        : 'Sin datos suficientes';
  const oddsShown =
    visibleTotalOdds.trim() === ''
      ? '—'
      : isOddsString(visibleTotalOdds.trim())
        ? formatOdds(visibleTotalOdds.trim())
        : visibleTotalOdds.trim();
  const oddsProvenance =
    visibleTotalOdds.trim() === ''
      ? undefined
      : totalOddsSource === 'OFFICIAL'
        ? 'Oficial'
        : totalOddsSource === 'CALCULATED'
          ? 'Calculada de referencia'
          : 'Origen sin declarar';
  const structureProblems = draftStructureIssues(selections, format);
  const typeLabel =
    format === 'SIMPLE'
      ? 'Simple'
      : format === 'CREATED'
        ? `Creada (${selections.length} pronósticos)`
        : `Múltiple (${legCount} ${legCount === 1 ? 'selección' : 'selecciones'})`;

  const stakeSelectValue = customStake
    ? 'custom'
    : stake.trim() === ''
      ? ''
      : (QUICK_STAKES as readonly number[]).includes(Number(stake))
        ? String(Number(stake))
        : 'custom';

  function chooseResult(value: DraftStatus) {
    markTouched();
    setStatusChosen(true);
    setStatusFromAi(false);
    setStatus(value);
  }

  const pill = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[0.8rem]';
  const resultPill = statusChosen ? (
    <span
      className={`${pill} font-medium ${
        status === 'LOST'
          ? 'border-red-300 bg-red-50 text-red-700'
          : status === 'WON'
            ? 'border-green-300 bg-green-50 text-green-700'
            : status === 'PENDING'
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : status === 'CASHOUT'
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-300 bg-slate-100 text-slate-700'
      }`}
    >
      {status === 'LOST' && <XCircleIcon className="h-4 w-4" />}
      {status === 'WON' && <TrophyIcon className="h-4 w-4" />}
      {RESULT_BUTTON_LABELS[status]}
    </span>
  ) : (
    <span className="text-slate-500">Sin definir</span>
  );
  // "Estructura validada" SOLO si la lectura aplicada pasó las validaciones de estructura y no falta
  // nada: es una validación estructural, nunca una garantía de que la lectura de la imagen sea exacta.
  const analysisPill =
    missingForReview.length > 0 || structureProblems.length > 0 ? (
      <Badge tone="amber">Revisión pendiente</Badge>
    ) : aiRead ? (
      <span
        className={`${pill} border-green-300 bg-green-50 text-xs text-green-700`}
        title="Validación de la estructura (legs, condiciones y cuotas), no de la lectura de la imagen."
      >
        <CheckCircleIcon className="h-4 w-4" />
        Estructura validada
      </span>
    ) : (
      <Badge tone="slate">Ticket sin analizar</Badge>
    );

  const summaryRows: SummaryRow[] = [
    { label: 'Casa de apuestas', value: house?.name ?? '—' },
    { label: 'Tipo de apuesta', value: typeLabel },
    {
      label: 'Stake',
      value: stakeShown ?? '—',
      note: stakeShown !== null && stake.trim() === '' ? 'Derivado del monto' : undefined,
    },
    {
      label: 'Monto apostado',
      value: figures.amount === null ? '—' : formatPEN(figures.amount),
      valueLabel: 'Monto apostado calculado',
      note:
        figures.amount === null
          ? undefined
          : usesOfficialAmount
            ? 'Oficial'
            : 'Calculado (stake × unidad)',
    },
    { label: 'Cuota total', value: oddsShown, note: oddsProvenance },
    {
      label: 'Monto potencial',
      value: (
        <span className="text-base font-semibold text-fuchsia-600 dark:text-fuchsia-400">
          {potentialValue === null ? '—' : formatPEN(potentialValue)}
        </span>
      ),
      // La misma cifra que la tarjeta superior; aquí solo su procedencia, en corto.
      note:
        potentialValue === null ? undefined : confirmedReturn || officialPotential ? 'Oficial' : 'Calculado',
    },
    { label: 'Resultado', value: resultPill },
    isManual
      ? {
          label: 'Origen',
          value: (
            <Pill tone="blue" icon={<DocumentIcon />}>
              Manual
            </Pill>
          ),
        }
      : { label: 'Estado del análisis', value: analysisPill },
  ];

  // Columna derecha de "Verificar datos": la imagen (original leída por IA o respaldo manual) y el
  // resumen. Sin imagen, un estado vacío que lleva al Paso 1 para adjuntarla.
  const backToEntry = (label: string) => (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
      <ImageIcon className="h-8 w-8 text-slate-400" />
      <span className="font-medium text-slate-700">
        {isManual ? 'Sin ticket de respaldo' : 'Sin ticket cargado'}
      </span>
      <button
        type="button"
        className="text-sm font-medium text-violet-700 hover:underline"
        onClick={() => setStep(0)}
      >
        {label}
      </button>
    </div>
  );
  const ticketCard = (
    <TicketOriginalCard
      projectId={project.id}
      ticket={ticket}
      title={isManual ? 'Ticket de respaldo' : 'Ticket original'}
      subtitle={
        isManual
          ? 'No analizado por IA'
          : aiRead
            ? 'Capturado por IA'
            : (ticket?.originalFileName ?? 'Sin analizar')
      }
      empty={backToEntry(isManual ? 'Adjuntar respaldo' : 'Cargar ticket')}
      fill={!narrow}
    />
  );
  const summaryCard = <SummaryCard icon={<TicketIcon />} rows={summaryRows} />;
  // Paso 3 ANTES de registrar: resumen de solo lectura de lo que se va a guardar (nunca el
  // `BetDetail` de la API, que todavía no existe). Mismas selecciones que "Verificar datos"
  // (`previewLegs`), con la tabla de solo lectura ("registered": sin botón "Editar").
  const confirmReview = (
    <>
      <WizardCard
        icon={<TicketIcon />}
        title="Confirma los datos antes de registrar"
        ariaLabel="Confirma los datos antes de registrar"
        dense
      >
        <p className="text-sm text-slate-600">
          Revisa el resumen y las selecciones. Nada se guarda hasta que pulses «Registrar apuesta».
        </p>
      </WizardCard>
      <WizardCard
        dense
        icon={<ListIcon />}
        title={`Selecciones (${legCount})`}
        ariaLabel="Selecciones de la apuesta"
      >
        <SelectionsTable legs={previewLegs} variant="registered" />
      </WizardCard>
    </>
  );
  const entryProps = {
    projectId: project.id,
    mode: entryMode,
    onModeChange: chooseMode,
    aiAllowed,
    canUpload: can('tickets.upload'),
    ticket,
    previewUrl: ticket
      ? localPreview?.ticketId === ticket.id
        ? localPreview.url
        : ticketFileUrl(project.id, ticket.id)
      : null,
    imageSize,
    onImageSize: setImageSize,
    uploading,
    fileError,
    onFile: (file: File) => void uploadTicketFile(file),
    onPasteFromClipboard: () => void pasteFromClipboard(),
    onRemove: detachTicket,
    analysis:
      analysis.kind === 'idle' && ticket && analyzedTicketId === ticket.id && aiRead
        ? ({ kind: 'analyzed' } as const)
        : analysis,
    onRetryAnalysis: () => void analyzeTicket(),
    onManualFallback: continueManually,
  };
  const registeredProps = registered && {
    projectId: project.id,
    bet: registered,
    origin: entryMode,
    canViewTickets: can('tickets.view'),
    onViewHistory: () => onViewHistory?.(registered.id),
    onRegisterAnother: () => onRegisterAnother?.(),
    onGoDashboard: () => onGoDashboard?.(),
  };
  // Igual que la columna principal, las columnas derechas de los Pasos 1 y 2 quedan montadas y solo
  // se ocultan (nada se pierde al ir y volver); el Paso 3 reutiliza la misma columna (ticket +
  // resumen) mientras no se haya registrado, y pasa a la del "Registro completado" al registrar.
  const asideContent = (
    <>
      <div className={step === 0 ? 'contents' : 'hidden'}>
        <BetEntryAside {...entryProps} />
      </div>
      <div className={step === 1 || (step === 2 && !registered) ? 'contents' : 'hidden'}>
        {ticketCard}
        <div className="shrink-0">{summaryCard}</div>
      </div>
      {step === 2 && registeredProps && <BetRegisteredAside {...registeredProps} />}
    </>
  );

  // Casa, fecha, tipo, stake, monto, cuota total y monto potencial: UNA sola instancia de cada campo,
  // visible en los pasos 1 y 2 (nunca el mismo control dos veces a la vez).
  const compactChip = (selected: boolean) =>
    `inline-flex min-h-8 items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 ${
      selected
        ? 'border-violet-600 bg-violet-600 text-white'
        : 'border-slate-300 bg-surface text-slate-700 hover:border-violet-400'
    }`;
  const zone = getDisplayTimeZone();

  // Casa, fecha, tipo, stake, monto, cuota total y monto potencial: UNA sola instancia de cada campo,
  // visible en los pasos 1 y 2 (nunca el mismo control dos veces a la vez). En "Verificar datos"
  // (`verifying`) la tarjeta es la de la referencia: dos filas, sin ayudas ni avisos accesorios
  // (siguen en el Paso 1); lo que falta declarar (p. ej. el origen de la cuota) se muestra siempre.
  const verifying = step === 1;
  const fieldLabel = 'text-[0.8rem] text-slate-700';
  const oddsSourceMissing = multi && totalOddsSource === null;
  const canUseProduct = multi && oddsProduct !== null && totalOdds.trim() === '';
  const datosCard = (
    <WizardCard
      icon={<DocumentIcon />}
      title="Datos de la apuesta"
      ariaLabel="Datos de la apuesta"
      dense
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {aiRead && <AiDetectedBadge />}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-violet-500"
            aria-expanded={showOptional}
            aria-controls="bet-optional-data"
            onClick={() => setShowOptional((open) => !open)}
          >
            Datos opcionales
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${showOptional ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      }
    >
      <div className="grid gap-x-3 gap-y-2 @lg:grid-cols-2 @[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col gap-1">
          <label htmlFor="bet-house" className={fieldLabel}>
            Casa de apuestas
          </label>
          <select
            id="bet-house"
            value={houseId}
            onChange={(event) => {
              markTouched();
              setHouseId(event.target.value);
            }}
            className={field}
          >
            <option value="" disabled>
              Elige una casa
            </option>
            {houses
              .filter((candidate) => candidate.status === 'ACTIVE')
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </div>
        {/* Fecha y hora de colocación en una sola columna (la hora sigue siendo un dato propio). */}
        <div className="flex flex-col gap-1">
          <label htmlFor="bet-placed-date" className={fieldLabel}>
            Fecha
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(5.6rem,0.62fr)] gap-2">
            <input
              id="bet-placed-date"
              type="date"
              value={placed.date}
              onChange={(event) => {
                markTouched();
                setPlaced({ ...placed, date: event.target.value });
              }}
              className={field}
            />
            <input
              type="time"
              aria-label="Hora"
              title={placedTimeKnown ? 'Hora de colocación' : 'Hora desconocida'}
              value={placed.time}
              onChange={(event) => {
                markTouched();
                setPlaced({ ...placed, time: event.target.value });
              }}
              className={`${field} px-2`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 @lg:col-span-2 @[44rem]:col-span-1">
          <label htmlFor="bet-format" className={fieldLabel}>
            Tipo de apuesta
          </label>
          <select
            id="bet-format"
            value={format}
            onChange={(event) => chooseFormat(event.target.value as BetType)}
            className={field}
          >
            {FORMATS.map((option) => (
              <option key={option} value={option}>
                {BET_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid items-start gap-x-3 gap-y-2 @lg:grid-cols-2 @[44rem]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-1">
          <span className={`flex items-center gap-1 ${fieldLabel}`} aria-hidden="true">
            Stake <Help term="stake" />
          </span>
          <select
            value={stakeSelectValue}
            onChange={(event) => {
              markTouched();
              const next = event.target.value;
              if (next === 'custom') setCustomStake(true);
              else {
                setCustomStake(false);
                setStake(next);
              }
            }}
            className={field}
            aria-label="Stake rápido"
          >
            <option value="">
              {derivedStake !== null ? `${derivedStake} (derivado)` : 'Elige un stake'}
            </option>
            {QUICK_STAKES.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
            <option value="custom">Otra cantidad…</option>
          </select>
          {stakeSelectValue === 'custom' && (
            <input
              value={stake}
              onChange={(event) => {
                markTouched();
                setStake(event.target.value);
              }}
              className={field}
              inputMode="decimal"
              placeholder="12.5"
              aria-label="Stake"
            />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className={`flex items-center gap-1 whitespace-nowrap ${fieldLabel}`}>
            <label htmlFor="bet-amount">Monto apostado</label>
            <Help term="amount" />
          </span>
          <div className="relative">
            <span
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-500"
              aria-hidden="true"
            >
              S/
            </span>
            <input
              id="bet-amount"
              value={officialAmount}
              onChange={(event) => {
                markTouched();
                setOfficialAmount(event.target.value);
              }}
              className={`${field} pl-8 tabular-nums ${usesOfficialAmount ? 'pr-[4.6rem]' : ''}`}
              inputMode="decimal"
              placeholder={calculatedOnlyAmount ?? (verifying ? '—' : 'Si tienes el ticket')}
              title={typeof amountNote === 'string' ? amountNote : undefined}
            />
            {usesOfficialAmount && (
              <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2">
                <ConfidenceBadge tone="official">
                  <span aria-hidden="true">Oficial</span>
                  <span className="sr-only">Monto oficial indicado</span>
                </ConfidenceBadge>
              </span>
            )}
          </div>
          {!usesOfficialAmount && !verifying && <span className={hintClass}>{amountNote}</span>}
        </div>

        {oddsInput}

        <div
          className="flex items-center gap-3 self-stretch rounded-xl border border-violet-400/70 bg-gradient-to-br from-violet-100 to-fuchsia-50 px-3 py-2 shadow-[0_0_26px_-10px_rgba(168,85,247,0.75)] dark:from-[oklch(0.25_0.11_288)] dark:to-[oklch(0.21_0.08_300)]"
          aria-label="Monto potencial"
          role="group"
        >
          <ChartBarsIcon className="h-7 w-7 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-[0.8rem] text-violet-800">
              Monto potencial
              <span title={potentialNote}>
                <InfoIcon className="h-3.5 w-3.5" />
              </span>
            </span>
            <span className="text-[1.45rem] leading-tight font-semibold text-fuchsia-600 tabular-nums dark:text-fuchsia-400">
              {potentialValue === null ? '—' : formatPEN(potentialValue)}
            </span>
            {!verifying && (
              <span className="truncate text-[0.66rem] leading-tight text-violet-800/80">
                {potentialNote}
              </span>
            )}
          </div>
        </div>
      </div>

      {multi && (!verifying || oddsSourceMissing || canUseProduct) && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
          role="group"
          aria-label="Origen de la cuota total"
        >
          <Caption>¿De dónde sale la cuota total?</Caption>
          {(['OFFICIAL', 'CALCULATED'] as const).map((kind) => {
            const active = totalOddsSource === kind;
            return (
              <button
                key={kind}
                type="button"
                className={compactChip(active)}
                aria-pressed={active}
                disabled={oddsIsCalculated}
                onClick={() => {
                  markTouched();
                  setOddsKindChoice(kind);
                }}
              >
                {TOTAL_ODDS_SOURCE_LABELS[kind]}
              </button>
            );
          })}
          {canUseProduct && (
            <button
              type="button"
              className={`${compactChip(false)} border-dashed text-violet-700`}
              onClick={() => {
                markTouched();
                setTotalOdds(oddsProduct);
                setOddsKindChoice(null);
                setCalculatedOdds({
                  value: oddsProduct,
                  note: 'Calculada desde las selecciones: producto de sus cuotas individuales. Es una referencia, no la cuota oficial de la casa.',
                });
              }}
            >
              Usar el producto de las cuotas ({oddsProduct}) como referencia
            </button>
          )}
          <span className="sr-only">
            Si el ticket no muestra la cuota total, no la marques como oficial: el producto de las
            cuotas es solo una referencia.
          </span>
        </div>
      )}
      {/* Cuota calculada por LetFer: siempre se dice de dónde sale (nunca pasa por oficial). Solo
          aparece cuando la cuota es calculada, así que la verificación de una cuota oficial no crece. */}
      {oddsIsCalculated && calculatedOdds && (
        <p className="text-xs text-slate-500">{calculatedOdds.note}</p>
      )}

      {/* "Datos opcionales": siempre montados (un valor que la IA ya puso aquí nunca desaparece ni
          deja de enviarse porque el panel esté cerrado); se abre solo si la IA rellenó algo. */}
      <div
        id="bet-optional-data"
        className={
          showOptional
            ? 'flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface-2 p-3'
            : 'hidden'
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={!placedTimeKnown}
              onChange={(event) => {
                markTouched();
                setPlacedTimeKnown(!event.target.checked);
              }}
              className="h-3.5 w-3.5 accent-violet-600"
            />
            No conozco la hora exacta
          </label>
          {zone && <span>{`Hora del proyecto (${zone}).`}</span>}
          {house && (
            <span className="sm:ml-auto">
              Disponible: <strong className="text-slate-800">{formatPEN(house.available)}</strong>
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 @lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="bet-official-potential-return" className={fieldLabel}>
              Retorno potencial (opcional)
            </label>
            <input
              id="bet-official-potential-return"
              value={officialPotentialReturn}
              onChange={(event) => {
                markTouched();
                setOfficialPotentialReturn(event.target.value);
              }}
              className={field}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bet-reason" className={fieldLabel}>
              Motivo / observaciones (opcional)
            </label>
            <input
              id="bet-reason"
              value={reason}
              onChange={(event) => {
                markTouched();
                setReason(event.target.value);
              }}
              className={field}
            />
          </div>
        </div>
      </div>

      {amountMismatch && calculatedOnlyAmount !== null && (
        <Notice tone="warning">
          El ticket indica {formatPEN(officialAmount.trim())}, pero el cálculo de LetFer para stake{' '}
          {formatStake(stake.trim())} es {formatPEN(calculatedOnlyAmount)}. Revisa cuál es correcto:
          LetFer no cambia la regla en silencio para que coincidan.
        </Notice>
      )}
      {exceedsAvailable && house && (
        <Notice tone="warning">
          El importe supera el disponible de {house.name} ({formatPEN(house.available)}). LetFer no
          permite apostar más de lo disponible: reduce el stake o elige otra casa.
        </Notice>
      )}
    </WizardCard>
  );

  const resultCard = (
    <SettlementSection
      options={canSettle ? DRAFT_STATUS_OPTIONS : null}
      notSettleableText="Pendiente: la liquida quien tiene permiso para liquidar."
      status={status}
      onStatus={chooseResult}
      settled={settled}
      onSettled={(value) => {
        markTouched();
        setSettled(value);
      }}
      figures={figures}
      profitOverride={profitOverride}
      onProfitOverride={(value) => {
        markTouched();
        setProfitOverride(value);
      }}
      visibleTotalOdds={visibleTotalOdds}
      premium={{ chosen: statusChosen, detectedByAi: statusFromAi }}
    />
  );

  const editedLegRows =
    editingLeg === null ? [] : selections.filter((r) => r.eventGroup === editingLeg);
  const editedLeg = previewLegs.find((leg) => leg.eventGroup === editingLeg) ?? null;
  // Un leg se puede quitar si la estructura lo admite: en una Múltiple quedan al menos dos.
  const canRemoveEditedLeg = format === 'MULTIPLE' && previewLegs.length > 2;
  const completeLegs = previewLegs.filter((leg) =>
    leg.selections.some((row) => row.event.trim() !== '' && row.selection.trim() !== ''),
  );

  const mobileHalf = 'max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[calc(50%-0.25rem)] max-sm:px-2';
  const alreadyAnalyzed =
    entryMode === 'AI' && ticket !== null && analyzedTicketId === ticket.id && aiRead;
  const analyzing = analysis.kind === 'analyzing';

  // "Añadir selección": en la verificación de una lectura de IA, un botón de icono en la cabecera (la
  // tabla debe caber sin desplazarse); en manual o sin selecciones, el botón completo bajo la tabla.
  const addSelectionButton = (compact: boolean) =>
    compact ? (
      <button
        type="button"
        onClick={addSelectionFromReview}
        aria-label="Añadir selección"
        title="Añadir selección"
        className={`${wizardButton.small} w-8 shrink-0 border-violet-400 px-0 text-violet-700`}
      >
        <PlusIcon />
      </button>
    ) : (
      <button
        type="button"
        onClick={addSelectionFromReview}
        className={`${wizardButton.violet} self-start`}
      >
        <PlusIcon />
        Añadir selección
      </button>
    );

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      // Enter dentro de un campo nunca envía ni avanza: solo "Registrar apuesta" (Paso 3) registra.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Añadir apuesta"
      noValidate
    >
      <WizardHeader subtitle={subtitle} onClose={onCancel} disabled={submitting} />
      <WizardStepper
        labels={STEP_LABELS}
        current={step}
        onSelect={setStep}
        // Se puede volver a un paso anterior mientras no se haya registrado; nunca se salta hacia
        // adelante con el indicador (eso es cosa de "Continuar"/"Registrar apuesta"). Tras
        // registrar, el asistente queda bloqueado.
        canSelect={(index) => !confirmed && index <= step && !analyzing && !submitting}
      />

      {step === 2 && registered && (
        <div className="px-4 pb-2 sm:px-6">
          <Strip tone="success" live>
            <strong className="font-semibold">Apuesta registrada correctamente.</strong>{' '}
            {isManual
              ? 'El registro manual fue guardado en tu historial.'
              : 'El ticket leído por IA fue guardado en tu historial.'}
          </Strip>
        </div>
      )}
      {step === 1 && (
        <div className="pb-2">
          <WizardBanner
            kind={bannerKind}
            legs={legCount}
            hasResult={statusChosen && statusFromAi}
            missing={missingForReview}
          />
        </div>
      )}

      {step < 2 &&
        (pendingAnalysis ||
          staleAiData ||
          (aiRead && !pendingAnalysis && step === 0) ||
          unreadableMoneyFields.length > 0) && (
          <div className="flex flex-col gap-2 px-4 pb-3 sm:px-6">
            {staleAiData && (
              <Notice tone="warning">
                <p>
                  Los datos del formulario vienen de una lectura de IA que ya no se usa (cambiaste
                  la imagen o el origen). No se atribuyen a otra imagen: ¿los descartas o los
                  conservas como datos manuales?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} onClick={resetForm}>
                    Descartar los datos leídos
                  </button>
                  <button type="button" className={btn} onClick={() => setStaleAiData(false)}>
                    Conservar como datos manuales
                  </button>
                </div>
              </Notice>
            )}
            {pendingAnalysis && (
              <Notice tone="warning">
                <p>
                  Volvimos a leer el ticket, pero ya habías corregido algunos datos a mano.
                  ¿Reemplazar el formulario con esta nueva lectura?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => applyExtraction(pendingAnalysis.extraction)}
                  >
                    Reemplazar con esta lectura
                  </button>
                  <button type="button" className={btn} onClick={() => setPendingAnalysis(null)}>
                    Mantener mis cambios
                  </button>
                </div>
              </Notice>
            )}
            {aiRead && !pendingAnalysis && step === 0 && (
              <div
                role="status"
                className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800"
              >
                <CheckIcon className="h-4 w-4 shrink-0" />
                Datos aplicados desde el ticket. Revísalos en «Verificar datos» antes de registrar.
              </div>
            )}
            {unreadableMoneyFields.length > 0 && !pendingAnalysis && (
              <Notice tone="warning">
                {unreadableMoneyFields.join(' y ')} detectado en el ticket no pudo interpretarse
                automáticamente. Revísalo antes de registrar la apuesta.
              </Notice>
            )}
          </div>
        )}

      {/* ~70 % datos / ~30 % ticket y resumen. UNA sola zona con desplazamiento para las dos columnas
          (nunca dos barras paralelas): la cabecera, el progreso y la barra de acciones quedan fijas.
          Por debajo de `lg:` (`narrow`) todo va en una sola columna: la derecha, después. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-6">
        <div
          className={`grid gap-x-4 gap-y-3 ${
            narrow ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(17rem,29%)]'
          }`}
        >
          <div className="@container flex min-w-0 flex-col gap-3">
            {/* Los pasos 1 y 2 quedan siempre montados (nunca se pierde lo escrito al ir y volver):
                solo se oculta lo que no toca. `contents` deja que sus hijos formen parte de la columna. */}
            <div className={step === 0 ? 'contents' : 'hidden'}>
              <BetEntryMain {...entryProps} />
            </div>

            <div className={step === 1 ? 'contents' : 'hidden'}>
              <div className="flex flex-col gap-2">
                {datosCard}
                {resultCard}
                <WizardCard
                  icon={<ListIcon />}
                  dense
                  title={
                    aiRead
                      ? `Selecciones detectadas (${legCount})`
                      : `Selecciones de la apuesta (${legCount})`
                  }
                  ariaLabel="Selecciones de la apuesta"
                  aside={
                    <div className="flex items-center gap-3">
                      <p className="max-w-[21rem] text-[0.7rem] leading-4 text-slate-500">
                        Cada fila representa una selección del ticket. Las apuestas creadas agrupan
                        varios pronósticos dentro de una sola selección.
                      </p>
                      {!isManual && completeLegs.length > 0 && addSelectionButton(true)}
                    </div>
                  }
                >
                  {completeLegs.length === 0 ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-slate-300 p-4">
                      <p className="text-sm text-slate-500">
                        Aún no hay selecciones. Añade la primera para continuar.
                      </p>
                      {addSelectionButton(false)}
                    </div>
                  ) : (
                    <>
                      <SelectionsTable legs={previewLegs} onEdit={setEditingLeg} />
                      {isManual && addSelectionButton(false)}
                    </>
                  )}
                </WizardCard>
              </div>
            </div>

            {step === 2 && !registered && (
              <div className="flex flex-col gap-2">{confirmReview}</div>
            )}
            {step === 2 && registeredProps && <BetRegisteredMain {...registeredProps} />}

            {narrow && <div className="flex flex-col gap-3">{asideContent}</div>}
          </div>

          {!narrow && (
            // En "Verificar datos" se estira al alto de la columna de datos (el ticket ocupa el espacio
            // libre). En los Pasos 1 y 3 se ajusta a su contenido.
            <aside aria-label="Ticket y resumen" className="flex min-w-0 flex-col gap-3">
              {asideContent}
            </aside>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 pb-2 sm:px-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 bg-slate-50 px-4 pt-2 pb-2.5 sm:px-6">
        {step === 0 && (
          <button
            type="button"
            className={`${wizardButton.text} ${mobileHalf}`}
            onClick={onCancel}
            disabled={analyzing}
          >
            Cancelar
          </button>
        )}
        {step === 1 && (
          <button
            type="button"
            className={`${wizardButton.outline} ${mobileHalf}`}
            onClick={() => setStep(0)}
            disabled={submitting}
          >
            Atrás
          </button>
        )}
        {step === 2 && !registered && (
          <button
            type="button"
            className={`${wizardButton.outline} ${mobileHalf}`}
            onClick={() => setStep(1)}
            disabled={submitting}
          >
            Atrás
          </button>
        )}
        {step === 2 && registered && (
          <button
            type="button"
            className={`${wizardButton.outline} ${mobileHalf}`}
            onClick={onCancel}
          >
            Cerrar
          </button>
        )}
        {/* En móvil los botones forman una rejilla de dos por fila (nunca tres filas de pie). */}
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:contents sm:ml-auto">
          {draftMessage && !confirmed && (
            <span
              role="status"
              className="text-xs text-green-700 max-sm:order-first max-sm:basis-full"
            >
              {draftMessage}
            </span>
          )}
          {step === 2 && !registered && figures.amount !== null && (
            // Transparencia financiera: qué hará el registro, justo antes de confirmarlo.
            <span className="text-xs text-slate-500 max-sm:order-first max-sm:basis-full">
              {status === 'PENDING' || !statusChosen
                ? `Reservará ${formatPEN(figures.amount)} en ${house?.name ?? 'la casa elegida'}.`
                : `Se registrará ya liquidada como ${RESULT_BUTTON_LABELS[status].toLowerCase()}.`}
            </span>
          )}
          {!confirmed && (
            <button
              type="button"
              className={`${wizardButton.outline} ${mobileHalf}`}
              onClick={() => void saveDraft()}
              disabled={submitting || savingDraft || analyzing || uploading}
            >
              <SaveIcon />
              {savingDraft ? 'Guardando…' : 'Guardar borrador'}
            </button>
          )}
          {step === 0 && entryMode === 'AI' && alreadyAnalyzed && (
            <button
              type="button"
              className={`${wizardButton.text} ${mobileHalf}`}
              onClick={() => void analyzeTicket()}
              disabled={analyzing}
            >
              <SparkleIcon />
              Volver a analizar
            </button>
          )}
          {step === 0 &&
            (entryMode === 'AI' && !alreadyAnalyzed ? (
              <button
                key="analyze"
                type="button"
                className={`${wizardButton.primary} ${mobileHalf}`}
                onClick={() => void analyzeTicket()}
                disabled={!ticket || uploading || analyzing}
              >
                {analyzing ? <SpinnerIcon className="animate-spin" /> : <SparkleIcon />}
                {analyzing ? 'Analizando…' : 'Analizar y continuar'}
                {!analyzing && <ChevronRightIcon />}
              </button>
            ) : (
              <button
                key="continue"
                type="button"
                className={`${wizardButton.primary} ${mobileHalf}`}
                onClick={() => setStep(1)}
                disabled={uploading}
              >
                {entryMode === 'AI' ? 'Continuar' : 'Continuar a verificar datos'}
                <ArrowRightIcon />
              </button>
            ))}
          {step === 1 && ticket && (
            <button
              type="button"
              className={`${wizardButton.violet} ${mobileHalf}`}
              onClick={() => setStep(0)}
              disabled={submitting}
            >
              <PencilIcon />
              Editar ticket
            </button>
          )}
          {step === 1 && (
            // `type="button"`: nunca envía el formulario. Solo avanza al resumen del Paso 3; el
            // registro ocurre allí, con "Registrar apuesta".
            <button
              key="continue-review"
              type="button"
              className={`${wizardButton.primary} ${mobileHalf}`}
              onClick={() => setStep(2)}
            >
              Continuar a confirmar
              <ArrowRightIcon />
            </button>
          )}
          {step === 2 && !registered && (
            // `key` distinto a propósito: el botón de avance del Paso 1/2 y este ocupan la misma
            // posición con distinto `type`; sin `key`, React reutilizaría el nodo y un clic en curso
            // podría disparar el envío.
            <button
              key="submit"
              type="submit"
              data-action="register"
              disabled={submitting}
              className={`${wizardButton.primary} ${mobileHalf}`}
            >
              {submitting ? <SpinnerIcon className="animate-spin" /> : <CheckIcon />}
              {submitting ? 'Registrando…' : 'Registrar apuesta'}
            </button>
          )}
          {step === 2 && registered && (
            <>
              <button
                type="button"
                className={`${wizardButton.violet} ${mobileHalf}`}
                onClick={() => onViewHistory?.(registered.id)}
              >
                <ListIcon />
                Ver historial
              </button>
              <button
                type="button"
                className={`${wizardButton.primary} ${mobileHalf}`}
                onClick={() => onRegisterAnother?.()}
              >
                <PlusCircleIcon />
                Registrar otra apuesta
              </button>
            </>
          )}
        </div>
      </footer>

      {editingLeg !== null && editedLeg !== null && (
        <NestedDialog
          title={`Editar leg ${editedLeg.number}`}
          onClose={() => setEditingLeg(null)}
          footer={
            <>
              {canRemoveEditedLeg ? (
                <button
                  type="button"
                  className={`${wizardButton.danger} mr-auto`}
                  onClick={() => {
                    removeLegCard(editedLeg.eventGroup);
                    setEditingLeg(null);
                  }}
                >
                  <TrashIcon />
                  Eliminar leg
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className={wizardButton.primary}
                onClick={() => setEditingLeg(null)}
              >
                Listo
              </button>
            </>
          }
        >
          <LegsEditor
            format={format}
            selections={format === 'MULTIPLE' ? editedLegRows : selections}
            onPatch={updateSelection}
            onAddLeg={addLegCard}
            onAddCondition={addConditionTo}
            onRemoveRow={removeSelection}
            onRemoveLeg={removeLegCard}
            fixedLeg={format === 'MULTIPLE' ? { number: editedLeg.number } : undefined}
          />
        </NestedDialog>
      )}
    </form>
  );
}
