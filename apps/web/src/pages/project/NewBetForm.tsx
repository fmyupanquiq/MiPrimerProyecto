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
  type BetSelectionInput,
  type BetType,
  type HouseSummary,
  type TicketAnalysisSummary,
  type TicketExtraction,
  type TicketExtractionSelection,
  type TicketSummary,
} from '@letfer/shared';
import { type FormEvent, type ReactElement, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router';
import { betsApi } from '../../api/bets.js';
import { describeApiError } from '../../api/errors.js';
import { fromDateTimeParts, nowDateTimeParts, type DateTimeParts } from '../../date-inputs.js';
import { formatStake } from '../../format.js';
import { Help } from '../../glossary.js';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  CloseIcon,
  LayersIcon,
  MenuIcon,
  PlusIcon,
  SparkleIcon,
  SwapIcon,
  TicketIcon,
  TrashIcon,
} from '../../icons.js';
import { BET_STATUS_LABELS, BET_TYPE_LABELS } from '../../labels.js';
import { btn, btnGhost, btnPrimary, hintClass, Notice } from '../../ui.js';
import { useIsNarrow } from '../AppShell.js';
import { allowsProfitOverride, betDraftFigures, type DraftStatus } from './bet-draft.js';
import {
  collectCompleteIndividualOdds,
  composeForecastText,
  deriveStakeFromAmount,
} from './ticket-prefill.js';
import {
  Caption,
  chip,
  ConfidenceBadge,
  DateTimeFields,
  field,
  FinancialSummary,
  FormStep,
  SettlementSection,
  StepIndicator,
} from './BetSettlementFields.js';
import { useProject } from './ProjectContext.js';
import { TicketPanel, TicketThumbnail } from './TicketPanel.js';

/*
 * Formulario "Añadir apuesta" (Fase 11.1, rediseño UX/UI del alta): asistente de 3 pasos (Origen,
 * Apuesta, Confirmar) dentro de `<Modal>` (`ui.tsx`), con un resumen financiero en vivo en una
 * columna derecha a partir de `lg:`. Los pasos son orientación, nunca una validación: se puede
 * saltar libremente entre ellos (`StepIndicator`) y "Registrar apuesta" sigue siendo el único
 * momento en que algo se valida y se envía de verdad — igual que en el formulario de siempre.
 *
 * La etapa nunca se elige aquí: toda apuesta nueva va a la etapa activa del proyecto (§1); para
 * cambiarla después está "Mover de etapa" (`bets.move_stage`, con reautenticación). Solo organiza
 * la entrada y muestra las cifras que calcula `bet-draft.ts` con las funciones de `@letfer/shared`;
 * la API vuelve a calcular y validar todo al registrar, y es quien deriva el tipo de apuesta de la
 * estructura de selecciones (§90).
 */

// --- Selecciones --------------------------------------------------------------------------------

let nextKey = 0;

export interface SelectionDraft {
  key: number;
  eventGroup: number;
  position: number;
  sport: string;
  event: string;
  market: string;
  selection: string;
  visibleOdds: string;
}

/** Deporte inicial más habitual (Fase 10.3); se puede cambiar en cada selección. */
const DEFAULT_SPORT = 'Fútbol';
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
 * contenedor, no de ventana: la columna mide distinto según haya o no ticket al lado); apilados
 * por debajo, para no cortar el nombre del partido.
 */
const eventSportGrid = 'grid gap-2 @md:grid-cols-[minmax(0,3fr)_minmax(9rem,1fr)]';

export const newSelection = (eventGroup: number, position: number): SelectionDraft => ({
  key: nextKey++,
  eventGroup,
  position,
  sport: DEFAULT_SPORT,
  event: '',
  market: '',
  selection: '',
  visibleOdds: '',
});

function toSelectionInputs(selections: SelectionDraft[]): BetSelectionInput[] {
  return selections.map((s) => ({
    eventGroup: s.eventGroup,
    position: s.position,
    sport: s.sport.trim() === '' ? undefined : s.sport,
    event: s.event,
    market: s.market.trim() === '' ? undefined : s.market,
    selection: s.selection,
    // Fase 10.6: sin cuota individual (p. ej. una Creada con solo cuota total), se omite en vez
    // de mandar una cadena vacía — nunca se inventa ni se distribuye la cuota total (§90).
    visibleOdds: s.visibleOdds.trim() === '' ? undefined : s.visibleOdds,
  }));
}

/**
 * Formato elegido: decide cómo se organizan las selecciones para que el tipo que la API derive
 * (§90) sea justamente ese: una selección (Simple), varios eventos (Múltiple) o varias
 * selecciones del mismo evento (Creada).
 */
const FORMATS: BetType[] = ['SIMPLE', 'MULTIPLE', 'CREATED'];
/** Un icono por formato (Fase 11.3, §8): el selector se lee como una elección de producto, no
 * como tres botones de texto sueltos. El estado activo real sigue siendo `format === option`. */
const FORMAT_ICONS: Record<BetType, (p: { className?: string }) => ReactElement> = {
  SIMPLE: CircleIcon,
  MULTIPLE: SwapIcon,
  CREATED: LayersIcon,
};

function restructure(format: BetType, selections: SelectionDraft[]): SelectionDraft[] {
  const first = selections[0] ?? newSelection(0, 0);
  if (format === 'SIMPLE') return [{ ...first, eventGroup: 0, position: 0 }];
  if (format === 'MULTIPLE') {
    const list = selections.map((s, index) => ({ ...s, eventGroup: index, position: 0 }));
    return list.length >= 2 ? list : [...list, newSelection(list.length, 0)];
  }
  const list = selections.map((s, index) => ({
    ...s,
    eventGroup: 0,
    position: index,
    event: first.event,
    sport: first.sport,
  }));
  return list.length >= 2
    ? list
    : [...list, { ...newSelection(0, list.length), event: first.event, sport: first.sport }];
}

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

/**
 * Construye las tarjetas de selección a partir de lo que leyó la IA (§5, Fase 10.7), con la
 * misma agrupación `eventGroup`/`position` que usa el formulario manual para que el tipo
 * resultante sea el correcto: CREATED comparte partido/deporte entre todas; MULTIPLE da a cada
 * selección su propio evento; SIMPLE deja solo la primera. Ningún campo ausente se inventa.
 */
function selectionDraftsFromExtraction(
  betType: string | undefined,
  items: TicketExtractionSelection[],
): SelectionDraft[] {
  if (items.length === 0) return [newSelection(0, 0)];
  if (betType === 'CREATED') {
    const first = items[0]!;
    return items.map((item, index) => ({
      ...newSelection(0, index),
      sport: item.sport ?? first.sport ?? DEFAULT_SPORT,
      event: first.event ?? '',
      market: item.market ?? '',
      selection: composeForecastText(item.market, item.selection),
      visibleOdds: item.visibleOdds ?? '',
    }));
  }
  if (betType === 'MULTIPLE' || items.length > 1) {
    return items.map((item, index) => ({
      ...newSelection(index, 0),
      sport: item.sport ?? DEFAULT_SPORT,
      event: item.event ?? '',
      market: item.market ?? '',
      selection: composeForecastText(item.market, item.selection),
      visibleOdds: item.visibleOdds ?? '',
    }));
  }
  const only = items[0]!;
  return [
    {
      ...newSelection(0, 0),
      sport: only.sport ?? DEFAULT_SPORT,
      event: only.event ?? '',
      market: only.market ?? '',
      selection: composeForecastText(only.market, only.selection),
      visibleOdds: only.visibleOdds ?? '',
    },
  ];
}

/** El tipo que de verdad usará el formulario, igual que derivará la API de la estructura real. */
function formatFromExtraction(betType: string | undefined, selectionCount: number): BetType {
  if (betType === 'CREATED') return 'CREATED';
  if (betType === 'MULTIPLE' || selectionCount > 1) return 'MULTIPLE';
  return 'SIMPLE';
}

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

// --- Casa -----------------------------------------------------------------------------------

export function HouseSelect({
  houses,
  value,
  onChange,
  className = '',
}: {
  houses: HouseSummary[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${className}`}>
      Casa
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

/** Las tres etapas conceptuales del asistente (Fase 11.1, §6 del encargo de rediseño). */
const STEP_LABELS = ['Origen', 'Apuesta', 'Confirmar'] as const;

// --- Formulario ---------------------------------------------------------------------------------

export function NewBetForm({
  houses,
  onDone,
  onCancel,
  onWideChange,
}: {
  houses: HouseSummary[];
  onDone: (message: string) => void;
  onCancel: () => void;
  /**
   * Fase 11, §11 (y Fase 11.7): el ancho del panel flotante (`<Modal>`, fuera de este componente)
   * depende de lo que hay que mostrar — Simple sin ticket cabe compacto; Múltiple/Creada (varias
   * selecciones) o cualquier formato con ticket adjunto (la imagen ocupa media pantalla para
   * comparar ticket ↔ datos) necesitan el panel ancho. Se avisa aquí (en vez de que `NewBetForm`
   * controle su propio `<Modal>`) porque el panel ya lo monta `BetsPage`.
   */
  onWideChange?: (wide: boolean) => void;
}) {
  const { project, can } = useProject();
  // Registrar con resultado también liquida: solo se ofrece a quien puede liquidar (la API lo exige).
  const canSettle = can('bets.settle');
  // Resumen financiero (Fase 11.1, §22): en una columna derecha fija desde `lg:`, o en línea solo
  // en el paso "Confirmar" por debajo de ese ancho — en un único lugar a la vez (nunca los dos
  // montados a la vez: ni el mismo dato repetido en pantalla ni duplicado para quien usa un
  // lector de pantalla). Por debajo de `lg:` (1024px) no hay columna derecha.
  const narrow = useIsNarrow(1023);

  // Asistente de 3 pasos (Fase 11.1): puramente de navegación, nunca de validación — se puede
  // saltar libremente entre pasos con `StepIndicator`; solo "Registrar apuesta" valida de verdad.
  const [step, setStep] = useState(0);

  // Creación: fecha y hora actuales por defecto (convención de la Fase 10.3), editables.
  const [placed, setPlaced] = useState<DateTimeParts>(nowDateTimeParts);
  const [placedTimeKnown, setPlacedTimeKnown] = useState(true);
  const [houseId, setHouseId] = useState('');
  const [format, setFormat] = useState<BetType>('SIMPLE');
  const [selections, setSelections] = useState<SelectionDraft[]>([newSelection(0, 0)]);
  const [openDetails, setOpenDetails] = useState<Set<number>>(new Set());
  const [totalOdds, setTotalOdds] = useState('');
  // El primer atajo (10) queda seleccionado por defecto, igual que cualquier otro preset.
  const [stake, setStake] = useState('10');
  /** El stake rápido (5-50) tiene su fila de botones; "Otra cantidad" revela el campo manual. */
  const [customStake, setCustomStake] = useState(false);
  const [status, setStatus] = useState<DraftStatus>('PENDING');
  const [settled, setSettled] = useState<DateTimeParts>(nowDateTimeParts);
  /** `null`: la ganancia calculada; texto: la escrita para coincidir con la casa. */
  const [profitOverride, setProfitOverride] = useState<string | null>(null);
  const [officialAmount, setOfficialAmount] = useState('');
  const [officialPotentialReturn, setOfficialPotentialReturn] = useState('');
  const [reason, setReason] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prellenado por IA (Fase 10.7, §1-§14): un análisis completo rellena el formulario entero de
  // una vez; si la persona ya corrigió algo a mano, una nueva lectura pide confirmación antes de
  // reemplazar (nunca pisa silenciosamente una corrección manual).
  const [formTouchedSinceApply, setFormTouchedSinceApply] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<TicketAnalysisSummary | null>(null);
  const [appliedNotice, setAppliedNotice] = useState(false);
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
    null,
  );

  function markTouched() {
    setFormTouchedSinceApply(true);
  }

  // Antes del `return` temprano de abajo (sin etapa activa): los hooks no pueden ser condicionales.
  // `useLayoutEffect`: el panel cambia de ancho antes de pintarse, sin un fotograma intermedio.
  const wide = format !== 'SIMPLE' || ticket !== null;
  useLayoutEffect(() => {
    onWideChange?.(wide);
  }, [wide, onWideChange]);

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

  function updateSelection(key: number, patch: Partial<SelectionDraft>) {
    markTouched();
    setSelections((list) =>
      list.map((s) =>
        // En una Creada, partido y deporte son del evento: se comparten entre sus selecciones.
        s.key === key || (format === 'CREATED' && ('event' in patch || 'sport' in patch))
          ? {
              ...s,
              ...(s.key === key
                ? patch
                : {
                    ...('event' in patch ? { event: patch.event } : {}),
                    ...('sport' in patch ? { sport: patch.sport } : {}),
                  }),
            }
          : s,
      ),
    );
  }

  function chooseFormat(next: BetType) {
    markTouched();
    setFormat(next);
    setSelections((list) => restructure(next, list));
  }

  function addSelection() {
    markTouched();
    setSelections((list) => {
      const first = list[0]!;
      return format === 'MULTIPLE'
        ? [...list, newSelection(list.length, 0)]
        : [...list, { ...newSelection(0, list.length), event: first.event, sport: first.sport }];
    });
  }

  function chooseQuickStake(value: number) {
    markTouched();
    setStake(String(value));
    setCustomStake(false);
  }

  function removeSelection(key: number) {
    markTouched();
    setSelections((list) =>
      restructure(
        format,
        list.filter((s) => s.key !== key),
      ),
    );
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
    // Fase 11.1: si la IA rellenó algo de "Datos opcionales", el panel se abre solo — nunca debe
    // quedar un dato ya escrito escondido detrás de un "Mostrar" sin que la persona lo sepa.
    if (normalizedAmount || normalizedPotential) setShowOptional(true);

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
      const resolvedFormat = formatFromExtraction(extraction.betType, items.length);
      let drafts = selectionDraftsFromExtraction(extraction.betType, items);
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
    // Asistente de 3 pasos (Fase 11.1): Enter en un campo de los pasos 1-2 no debe registrar la
    // apuesta a medio llenar — avanza al siguiente paso, igual que el botón "Siguiente".
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setError(null);
    if (houseId === '') {
      setError('Elige una casa.');
      setStep(0);
      return;
    }
    const placedAt = fromDateTimeParts(placed);
    if (placedAt === null) {
      setError('Indica la fecha y la hora de colocación.');
      setStep(0);
      return;
    }
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
    const parsed = createBetSchema.safeParse({
      houseId,
      stake,
      visibleTotalOdds,
      officialAmount: officialAmount.trim() === '' ? undefined : officialAmount,
      officialPotentialReturn:
        officialPotentialReturn.trim() === '' ? undefined : officialPotentialReturn,
      placedAt,
      placedTimeKnown,
      reason: reason.trim() === '' ? undefined : reason,
      selections: toSelectionInputs(selections),
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
    setSubmitting(true);
    try {
      await betsApi.create(project.id, parsed.data);
      onDone(settles ? 'Se registró la apuesta ya liquidada.' : 'Se registró la apuesta.');
    } catch (caught) {
      setError(describeApiError(caught));
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

  const amountNote = usesOfficialAmount ? (
    <ConfidenceBadge tone="official">Monto oficial indicado</ConfidenceBadge>
  ) : figures.amount !== null ? (
    `${formatStake(stake.trim())} × ${formatPEN(stage.unitStake)} (stake × unidad)`
  ) : (
    'Stake × unidad de stake.'
  );

  const oddsInput = (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {multi ? 'Cuota total visible' : 'Cuota'}
        <input
          value={multi ? totalOdds : (selections[0]?.visibleOdds ?? '')}
          onChange={(event) => {
            // El cambio manual cuenta como corrección (§16, Fase 10.8.1/10.9): sin esto, una
            // nueva lectura del ticket podría pisarla sin pedir confirmación (§14).
            markTouched();
            if (multi) setTotalOdds(event.target.value);
            else updateSelection(selections[0]!.key, { visibleOdds: event.target.value });
          }}
          className={field}
          inputMode="decimal"
          placeholder={multi ? 'La que muestra la casa' : '1.95'}
          aria-label={multi ? undefined : 'Cuota de la selección 1'}
        />
      </label>
      {oddsIsCalculated && calculatedOdds && (
        <div className="flex flex-col gap-1">
          <ConfidenceBadge tone="calculated">Calculada por LetFer</ConfidenceBadge>
          <p className="text-xs text-slate-500">{calculatedOdds.note}</p>
        </div>
      )}
    </div>
  );

  const stepDone = [
    houseId !== '',
    selections.every((s) => s.event.trim() !== '' && s.selection.trim() !== ''),
    false,
  ];

  const summaryAside = (
    <FinancialSummary
      stake={stake}
      shownOdds={
        visibleTotalOdds.trim() === ''
          ? '-'
          : isOddsString(visibleTotalOdds.trim())
            ? formatOdds(visibleTotalOdds.trim())
            : visibleTotalOdds.trim()
      }
      amount={figures.amount}
      amountNote={amountNote}
      potentialReturn={ifWon.returnValue}
      potentialProfit={ifWon.profit}
      status={status}
    />
  );

  /**
   * Tarjeta "Ticket original" (Fase 11.7): en la columna derecha (`fill`, ocupa el alto libre y
   * casi media pantalla como mínimo: con poco alto, la imagen manda y es el resumen el que se
   * desplaza, no al revés) o,
   * sin columna derecha (por debajo de `lg:`), al principio del paso "Apuesta" con un alto fijo —
   * nunca en los dos sitios a la vez (`narrow` decide cuál se monta).
   */
  function renderTicketCard(attached: TicketSummary, fill: boolean) {
    return (
      <section
        aria-label="Ticket original"
        className={`flex flex-col gap-2 rounded-xl border border-slate-200 bg-surface p-2.5 ${
          fill ? 'min-h-[max(18rem,45vh)] flex-1' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
              aria-hidden="true"
            >
              <TicketIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-slate-900">
                Ticket original
                {appliedNotice && <ConfidenceBadge tone="ai">Analizado por IA</ConfidenceBadge>}
              </p>
              <p className="truncate text-xs text-slate-500" title={attached.originalFileName}>
                {attached.originalFileName}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`${btn} shrink-0 px-2.5 py-1 text-xs`}
            onClick={() => {
              // Cambiarlo es, en realidad, subir otro: esa zona vive en el paso Origen
              // (§7, Fase 11.1) — no se duplica el flujo de subida aquí.
              setTicket(null);
              setStep(0);
            }}
          >
            Cambiar imagen
          </button>
        </div>
        <div className={`relative ${fill ? 'min-h-0 flex-1' : 'h-56 sm:h-80'}`}>
          <TicketThumbnail projectId={project.id} ticket={attached} fill />
        </div>
        {!appliedNotice && (
          <span className="text-xs text-slate-500">Todavía no se analizó con IA.</span>
        )}
      </section>
    );
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Añadir apuesta"
      noValidate
    >
      {/* Fase 11.6, §2: encabezado y stepper más bajos — el espacio que ahorran es, sobre todo,
          el que necesitaba la columna de contenido para no obligar a un scroll temprano. */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"
            aria-hidden="true"
          >
            <TicketIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base leading-tight font-semibold text-slate-900 sm:text-lg">
              Añadir apuesta
            </h3>
            <p className="text-xs text-slate-500">
              Registra los datos de tu apuesta de forma rápida y organizada.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          aria-label="Cerrar"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="border-b border-slate-200 px-3 py-1.5 sm:px-4">
        <StepIndicator labels={STEP_LABELS} current={step} done={stepDone} onSelect={setStep} />
      </div>

      {(pendingAnalysis ||
        (appliedNotice && !pendingAnalysis) ||
        unreadableMoneyFields.length > 0) && (
        <div className="flex flex-col gap-2 px-3 pt-2.5 sm:px-4 lg:pb-0.5">
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
          {/* Fase 11.4, §18: informativo, sin ninguna decisión pendiente (a diferencia del aviso
              de arriba) — una franja compacta en vez de un `Notice` a todo lo ancho; la tarjeta
              "Ticket original" ya lo refuerza con su propia insignia "Analizado por IA". */}
          {appliedNotice && !pendingAnalysis && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800"
            >
              <CheckCircleIcon className="h-4 w-4 shrink-0" />
              Datos aplicados desde el ticket. Revísalos antes de registrar.
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

      {/* Fase 11.7: con ticket, 50/50 real (`minmax(0, 1fr)` en las dos columnas: ninguna empuja a
          la otra con su contenido) — la imagen necesita tanto ancho como los datos para poder
          compararlos lado a lado. Sin ticket, la derecha solo lleva el resumen financiero y se
          queda en un ancho fijo. Una sola fila `minmax(0, 1fr)`: cada columna se desplaza por su
          cuenta y la cabecera, los pasos y la barra de acciones no se mueven nunca. Por debajo de
          `lg:` (`narrow`) no hay columna derecha: todo va en una sola columna desplazable. */}
      <div
        className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden ${
          narrow
            ? 'grid-cols-1'
            : ticket
              ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
              : 'grid-cols-[minmax(0,1fr)_19rem]'
        }`}
      >
        <div className="@container flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
          {/* Fase 11.1: los tres pasos quedan siempre montados (nunca se pierde lo escrito al
              cambiar de paso) y solo se oculta visualmente el que no está activo — nunca el
              mismo campo visible dos veces a la vez, pero tampoco un remonte que perdiera foco
              o estado local (p. ej. "Más detalles" de una selección). */}
          <div className={step === 0 ? 'flex flex-col gap-4' : 'hidden'}>
            <>
              <FormStep title="¿Dónde y cuándo?" ariaLabel="Dónde y cuándo">
                <div className="flex flex-col gap-1.5 sm:max-w-sm">
                  <HouseSelect
                    houses={houses}
                    value={houseId}
                    onChange={(value) => {
                      markTouched();
                      setHouseId(value);
                    }}
                  />
                  {house && (
                    <p className="text-xs text-slate-500">
                      Disponible:{' '}
                      <strong className="text-slate-800">{formatPEN(house.available)}</strong>
                    </p>
                  )}
                </div>
                <DateTimeFields
                  dateLabel="Fecha"
                  timeLabel="Hora"
                  value={placed}
                  onChange={(value) => {
                    markTouched();
                    setPlaced(value);
                  }}
                />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={!placedTimeKnown}
                    onChange={(event) => {
                      markTouched();
                      setPlacedTimeKnown(!event.target.checked);
                    }}
                    className="h-4 w-4 accent-violet-600"
                  />
                  No conozco la hora exacta
                </label>
              </FormStep>

              {/* Fase 11.1, §7: el ticket deja de ser "datos opcionales" al final del formulario
                  — es la vía más rápida y va primero, con peso visual propio. `aria-label` (Fase
                  11.3) también sirve para acotar aquí las pruebas: el nombre del archivo y su
                  estado se repiten, a propósito, en la tarjeta "Ticket original" de la columna
                  derecha (visible durante todo el asistente una vez adjunto, §6) — nunca el mismo
                  control dos veces, pero sí la misma referencia en dos lugares legítimos. */}
              <section
                aria-label="Completa con IA"
                className="flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50/40 p-4"
              >
                <div className="flex items-start gap-2.5">
                  <SparkleIcon className="h-5 w-5 shrink-0 text-violet-600" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">Completa con IA</p>
                    <p className="text-xs text-slate-500">
                      Sube el ticket y LetFer rellena el formulario entero. Tú revisas y confirmas
                      antes de registrar.
                    </p>
                  </div>
                </div>
                {(can('tickets.upload') || ticket) && (
                  <TicketPanel
                    projectId={project.id}
                    tickets={ticket ? [ticket] : []}
                    onUploaded={setTicket}
                    onAnalyzed={handleAnalyzed}
                    canUpload={can('tickets.upload') && !ticket}
                    canAnalyze={can('tickets.analyze')}
                    onRemoveDraft={() => setTicket(null)}
                  />
                )}
              </section>
            </>
          </div>

          <div className={step === 1 ? 'flex flex-col gap-3' : 'hidden'}>
            {/* Fase 11.7: sin columna derecha (por debajo de `lg:`), el ticket encabeza este paso
                para que siga a mano mientras se revisan las selecciones. */}
            {narrow && ticket && renderTicketCard(ticket, false)}

            <FormStep
              compact
              icon={<SwapIcon />}
              title="Tipo de apuesta"
              ariaLabel="Tipo de apuesta"
            >
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Formato de apuesta">
                {FORMATS.map((option) => {
                  const Icon = FORMAT_ICONS[option];
                  return (
                    <button
                      key={option}
                      type="button"
                      className={chip(format === option)}
                      aria-pressed={format === option}
                      onClick={() => chooseFormat(option)}
                    >
                      <Icon className="h-4 w-4" />
                      {BET_TYPE_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </FormStep>

            {/* Fase 11.4: el partido se pregunta una sola vez para Simple y Creada (todas sus
                selecciones son del mismo evento, §90) — Múltiple sigue preguntándolo dentro de
                cada tarjeta, porque ahí cada selección SÍ puede ser de un partido distinto. */}
            {format !== 'MULTIPLE' && (
              <FormStep compact icon={<CircleIcon />} title="Partido" ariaLabel="Sección Partido">
                <div className={eventSportGrid}>
                  <label className="flex min-w-0 flex-col gap-1">
                    <Caption>Partido</Caption>
                    <input
                      value={selections[0]?.event ?? ''}
                      onChange={(event) =>
                        updateSelection(selections[0]!.key, { event: event.target.value })
                      }
                      className={field}
                      placeholder="Arsenal vs Manchester City"
                      title={selections[0]?.event || undefined}
                      aria-label="Partido"
                    />
                  </label>
                  <SportSelect
                    value={selections[0]?.sport ?? DEFAULT_SPORT}
                    onChange={(sport) => updateSelection(selections[0]!.key, { sport })}
                    label="Deporte"
                  />
                </div>
              </FormStep>
            )}

            <FormStep
              compact
              icon={<MenuIcon />}
              title={multi ? `Selecciones (${selections.length})` : 'Selección'}
              ariaLabel="Selecciones"
            >
              {/* Fase 11.5, §2 / Fase 11.7: siempre una debajo de otra — cada selección es una
                  unidad que se lee de principio a fin y se compara con su línea del ticket, nunca
                  compitiendo al lado de otra. Orden de lectura: número, partido, pronóstico,
                  cuota y detalles. */}
              <div className="flex flex-col gap-2">
                {selections.map((selection, index) => {
                  const n = index + 1;
                  const detailsOpen = openDetails.has(selection.key);
                  return (
                    <section
                      key={selection.key}
                      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface-2 px-2.5 pt-2 pb-1.5"
                      aria-label={`Selección ${n}`}
                    >
                      {multi && (
                        <div className="flex min-h-6 items-center justify-between gap-2">
                          {/* El nombre accesible ya lo da la región (`aria-label`): la cabecera
                              visible no se repite para los lectores de pantalla. */}
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
                              className="-my-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                              onClick={() => removeSelection(selection.key)}
                              aria-label={`Quitar la selección ${n}`}
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                      {/* Fase 11.4: Partido/Deporte por tarjeta solo en Múltiple (arriba, §90);
                          en Simple/Creada ya se preguntó una sola vez en la sección "Partido". */}
                      {format === 'MULTIPLE' && (
                        <div className={eventSportGrid}>
                          <label className="flex min-w-0 flex-col gap-1">
                            <Caption>Partido</Caption>
                            <input
                              value={selection.event}
                              onChange={(event) =>
                                updateSelection(selection.key, { event: event.target.value })
                              }
                              className={field}
                              placeholder="Arsenal vs Manchester City"
                              title={selection.event || undefined}
                              aria-label={`Partido de la selección ${n}`}
                            />
                          </label>
                          <SportSelect
                            value={selection.sport}
                            onChange={(sport) => updateSelection(selection.key, { sport })}
                            label={`Deporte de la selección ${n}`}
                          />
                        </div>
                      )}
                      {/* Fase 11.2: Pronóstico a todo lo ancho de la tarjeta — es el dato que más
                          espacio necesita (textos largos leídos por IA como "Hándicap Resultado
                          del Partido Inglaterra -1"); nunca comparte la fila con la Cuota. */}
                      <label className="flex flex-col gap-1">
                        <Caption>Pronóstico</Caption>
                        <input
                          value={selection.selection}
                          onChange={(event) =>
                            updateSelection(selection.key, { selection: event.target.value })
                          }
                          className={`${field} font-medium`}
                          placeholder="Gana Arsenal"
                          title={selection.selection || undefined}
                          aria-label={`Pronóstico de la selección ${n}`}
                        />
                      </label>
                      {/* Cuota (angosta: una cifra) y "Más detalles" comparten la última fila:
                          una fila menos por tarjeta sin quitarle ancho al Pronóstico. */}
                      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                        {multi && (
                          <label className="flex flex-col gap-1">
                            <Caption>
                              Cuota de esta selección{format === 'CREATED' ? ' (opcional)' : ''}
                            </Caption>
                            <input
                              value={selection.visibleOdds}
                              onChange={(event) =>
                                updateSelection(selection.key, { visibleOdds: event.target.value })
                              }
                              className={`${field} max-w-36 tabular-nums`}
                              inputMode="decimal"
                              placeholder={format === 'CREATED' ? 'No indicada' : '1.52'}
                              aria-label={`Cuota de la selección ${n}`}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                          aria-expanded={detailsOpen}
                          onClick={() =>
                            setOpenDetails((open) => {
                              const next = new Set(open);
                              if (next.has(selection.key)) next.delete(selection.key);
                              else next.add(selection.key);
                              return next;
                            })
                          }
                        >
                          {detailsOpen ? 'Menos detalles' : 'Más detalles'}
                          <ChevronDownIcon
                            className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                          />
                        </button>
                      </div>
                      {detailsOpen && (
                        <label className="flex flex-col gap-1 pb-1">
                          <Caption>Mercado (opcional)</Caption>
                          <input
                            value={selection.market}
                            onChange={(event) =>
                              updateSelection(selection.key, { market: event.target.value })
                            }
                            className={field}
                            placeholder="Resultado final"
                            title={selection.market || undefined}
                            aria-label={`Mercado de la selección ${n}`}
                          />
                        </label>
                      )}
                    </section>
                  );
                })}
              </div>
              {multi && (
                <button
                  type="button"
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-600 transition-colors hover:border-violet-400 hover:bg-violet-50/50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  onClick={addSelection}
                >
                  <PlusIcon className="h-4 w-4" />
                  {format === 'MULTIPLE' ? 'Añadir evento' : 'Añadir selección'}
                </button>
              )}
            </FormStep>
          </div>

          <div className={step === 2 ? 'flex flex-col gap-4' : 'hidden'}>
            <>
              <FormStep title="¿Cuánto?" ariaLabel="Stake y monto">
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-1">
                    <Caption>Stake</Caption>
                    <Help term="stake" />
                  </span>
                  <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Stake rápido">
                    {QUICK_STAKES.map((value) => {
                      const active = !customStake && Number(stake) === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={chip(active)}
                          aria-pressed={active}
                          aria-label={`Stake ${value}`}
                          onClick={() => chooseQuickStake(value)}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                  {/* Campo aparte: la única vía para un stake que no sea uno de los atajos de arriba. */}
                  <button
                    type="button"
                    className={`${chip(customStake)} self-start`}
                    aria-pressed={customStake}
                    onClick={() => setCustomStake(true)}
                  >
                    Otra cantidad
                  </button>
                  {customStake && (
                    <div className="flex flex-col gap-1.5 sm:max-w-40">
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Stake
                        <input
                          value={stake}
                          onChange={(event) => setStake(event.target.value)}
                          className={field}
                          inputMode="decimal"
                          placeholder="12.5"
                          autoFocus
                        />
                      </label>
                      <span className={hintClass}>Otro valor válido (p. ej. 12.5).</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 sm:max-w-56">
                  {oddsInput}
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    {oddsIsCalculated
                      ? 'LetFer la calculó porque el ticket no mostraba una cuota total.'
                      : multi
                        ? 'La cuota combinada que muestra la casa.'
                        : 'La que muestra la casa.'}
                    <Help term={oddsIsCalculated ? 'calculatedOdds' : 'odds'} />
                  </span>
                </div>

                {/* Resumen financiero: desde `lg:` ya se ve en la columna derecha (siempre
                    visible); por debajo de ese ancho, sin columna derecha, se muestra aquí en el
                    paso final — en un único lugar a la vez, nunca los dos montados (§23). */}
                {narrow && summaryAside}

                {amountMismatch && calculatedOnlyAmount !== null && (
                  <Notice tone="warning">
                    El ticket indica {formatPEN(officialAmount.trim())}, pero el cálculo de LetFer
                    para stake {formatStake(stake.trim())} es {formatPEN(calculatedOnlyAmount)}.
                    Revisa cuál es correcto: LetFer no cambia la regla en silencio para que
                    coincidan.
                  </Notice>
                )}
                {exceedsAvailable && house && (
                  <Notice tone="warning">
                    El importe supera el disponible de {house.name} ({formatPEN(house.available)}).
                    LetFer no permite apostar más de lo disponible: reduce el stake o elige otra
                    casa.
                  </Notice>
                )}
              </FormStep>

              <SettlementSection
                options={canSettle ? DRAFT_STATUS_OPTIONS : null}
                notSettleableText="Pendiente: la liquida quien tiene permiso para liquidar."
                status={status}
                onStatus={(value) => {
                  markTouched();
                  setStatus(value);
                }}
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
              />

              <div className="flex flex-col gap-3 rounded-xl bg-slate-50/60 p-3">
                <button
                  type="button"
                  className="flex items-center justify-between text-left"
                  aria-expanded={showOptional}
                  onClick={() => setShowOptional((v) => !v)}
                >
                  <Caption>Datos opcionales</Caption>
                  <span className="text-xs text-violet-700 underline">
                    {showOptional ? 'Ocultar' : 'Mostrar'}
                  </span>
                </button>
                {/* Siempre montados, solo ocultos visualmente cuando está cerrado (mismo
                    criterio que los pasos del asistente): un valor que la IA ya puso aquí no
                    desaparece del formulario ni dejar de enviarse solo porque el panel está
                    cerrado — y se abre solo cuando corresponde (ver `applyExtractionData`). */}
                <div
                  className={
                    showOptional ? 'grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-3' : 'hidden'
                  }
                >
                  <label htmlFor="bet-official-amount" className="text-sm font-medium">
                    Monto oficial (opcional)
                  </label>
                  <label htmlFor="bet-official-potential-return" className="text-sm font-medium">
                    Retorno potencial (opcional)
                  </label>
                  <label htmlFor="bet-reason" className="text-sm font-medium">
                    Motivo / observaciones (opcional)
                  </label>
                  <input
                    id="bet-official-amount"
                    value={officialAmount}
                    onChange={(event) => {
                      markTouched();
                      setOfficialAmount(event.target.value);
                    }}
                    className={field}
                    placeholder="Si tienes el ticket"
                  />
                  <input
                    id="bet-official-potential-return"
                    value={officialPotentialReturn}
                    onChange={(event) => {
                      markTouched();
                      setOfficialPotentialReturn(event.target.value);
                    }}
                    className={field}
                  />
                  <input
                    id="bet-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className={field}
                  />
                </div>
              </div>
            </>
          </div>
        </div>

        {!narrow && (
          <aside
            aria-label="Ticket y resumen"
            className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-slate-50/40 p-3 sm:p-4"
          >
            {/* Fase 11.4, §13 / Fase 11.7: el ticket original con presencia real — la imagen que
                subió la persona (nunca una representación inventada de su contenido), visible
                durante todo el asistente una vez adjunto y ocupando todo el alto que deja el
                resumen, para poder compararla con las selecciones sin abrir nada. */}
            {ticket && renderTicketCard(ticket, true)}
            <div className="shrink-0">{summaryAside}</div>
          </aside>
        )}
      </div>

      {error && (
        <div className="px-4 sm:px-5">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-surface px-3 py-2.5 sm:px-4 sm:py-3">
        {step > 0 && (
          <button
            type="button"
            className={btn}
            onClick={() => setStep(step - 1)}
            disabled={submitting}
          >
            Atrás
          </button>
        )}
        {step < 2 ? (
          // `key` distinto a propósito: este botón y el de abajo ("Registrar apuesta") ocupan la
          // misma posición del árbol con distinto `type` ("button" vs "submit"). Sin `key`, React
          // reutiliza el mismo nodo del DOM y solo cambia sus atributos — y un cambio de `type` a
          // "submit" aplicado al nodo que el clic todavía está procesando puede hacer que ese
          // mismo clic dispare el envío del formulario (bug real, encontrado en el QA visual).
          <button key="next" type="button" className={btnPrimary} onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        ) : (
          <button key="submit" type="submit" disabled={submitting} className={`${btnPrimary} px-5`}>
            {submitting ? 'Registrando…' : 'Registrar apuesta'}
          </button>
        )}
        <button type="button" className={btnGhost} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
        {step === 2 && figures.amount !== null && (
          <span className="text-xs text-slate-500">
            {status === 'PENDING'
              ? `Reservará ${formatPEN(figures.amount)} en ${house?.name ?? 'la casa elegida'}.`
              : `Se registrará ya liquidada como ${BET_STATUS_LABELS[status].toLowerCase()}.`}
          </span>
        )}
      </footer>
    </form>
  );
}
