import {
  ErrorCode,
  formatOdds,
  isOddsString,
  normalizeMoneyInput,
  resolveTicketOdds,
  TICKET_MIME_TYPES,
  type TicketAnalysisSummary,
  type TicketEffectiveOddsSource,
  type TicketExtraction,
  type TicketMimeType,
  type TicketSummary,
} from '@letfer/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, ticketFileUrl } from '../../api/client.js';
import { describeApiError } from '../../api/errors.js';
import { ticketsApi } from '../../api/tickets.js';
import { formatDateTime, TICKET_FIELD_LABELS } from '../../labels.js';
import { CheckCircleIcon, ExpandIcon, SparkleIcon, TicketIcon } from '../../icons.js';
import { Badge, btn, btnPrimary, Lightbox, Notice, Skeleton } from '../../ui.js';
import { ConfidenceBadge } from './BetSettlementFields.js';
import { collectCompleteIndividualOdds } from './ticket-prefill.js';

const TICKET_ACCEPT = TICKET_MIME_TYPES.join(',');

function extensionForMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'application/pdf') return '.pdf';
  return '.jpg';
}

/** ¿Es uno de los formatos que LetFer admite para un ticket (D-T3)? Mismo criterio que el backend. */
function isAcceptedTicketFile(file: File): file is File & { type: TicketMimeType } {
  return (TICKET_MIME_TYPES as readonly string[]).includes(file.type);
}

/**
 * Campos de la extracción (§53) que tienen un campo equivalente en el formulario de apuesta y
 * por tanto admiten "usar este valor" (D-T5, §16 Fase 10.6: fecha y hora detectadas también se
 * pueden aplicar). El resto se muestra solo como referencia: el formulario actual no tiene un
 * campo editable para casa, tipo o resultado.
 */
const APPLICABLE_FIELDS: { key: keyof TicketExtraction; formField: string }[] = [
  { key: 'officialAmount', formField: 'officialAmount' },
  { key: 'officialTotalOdds', formField: 'visibleTotalOdds' },
  { key: 'officialPotentialReturn', formField: 'officialPotentialReturn' },
  { key: 'placedDate', formField: 'placedDate' },
  { key: 'placedTime', formField: 'placedTime' },
];

/** D-T6: alta confianza se ve normal, baja confianza se resalta para dirigir la revisión. */
const LOW_CONFIDENCE = 0.6;

/**
 * Rótulo y nota por fuente de la cuota calculada (§6-§10 Fase 10.8, §2-§4 y §9 Fase 10.9): nunca
 * dice "oficial" — la única cuota oficial de la casa es la visible (`officialTotalOdds`),
 * conservada aparte y listada por su cuenta más arriba. "Efectiva" (retorno ÷ importe) y
 * "calculada" (producto de las selecciones) son dos cosas distintas para quien revisa: la
 * primera es matemáticamente exacta con el dinero real/potencial; la segunda es solo una
 * referencia (cada cuota individual ya viene redondeada por la casa).
 */
const EFFECTIVE_ODDS_LABELS: Record<TicketEffectiveOddsSource, string> = {
  REALIZED_RETURN: 'Cuota efectiva',
  POTENTIAL_RETURN: 'Cuota efectiva',
  SELECTIONS_PRODUCT: 'Cuota calculada',
};
const EFFECTIVE_ODDS_NOTES: Record<TicketEffectiveOddsSource, string> = {
  REALIZED_RETURN: 'Calculada: retorno real ÷ importe apostado.',
  POTENTIAL_RETURN:
    'Calculada a partir del retorno potencial: la apuesta sigue pendiente, no es un retorno oficial.',
  SELECTIONS_PRODUCT:
    'Producto de las cuotas individuales: solo de referencia, no es la cuota oficial de la casa.',
};

/**
 * Cuota visible vs. efectiva/calculada de la extracción (§6-§11 Fase 10.8, §2-§4 Fase 10.9):
 * nunca sustituye la una por la otra. Las cifras de dinero pueden venir con el símbolo de soles
 * (Fase 10.7.1); se normalizan aquí antes de dividir, sin dejar que un valor no interpretable
 * rompa el cálculo (se ignora ese dato, nunca se inventa ni revienta el render). El producto de
 * las cuotas individuales solo se intenta si TODAS las selecciones la muestran (§2): si falta la
 * de una sola, no se inventa nada.
 */
function ticketOddsSummary(extraction: TicketExtraction) {
  const money = (raw: string | undefined) =>
    raw ? (normalizeMoneyInput(raw) ?? undefined) : undefined;
  return resolveTicketOdds({
    officialTotalOdds: extraction.officialTotalOdds,
    officialAmount: money(extraction.officialAmount),
    officialRealizedReturn: money(extraction.officialRealizedReturn),
    officialPotentialReturn: money(extraction.officialPotentialReturn),
    individualOdds: collectCompleteIndividualOdds(extraction.selections),
  });
}

function FieldRow({
  fieldKey,
  value,
  confidence,
  onApply,
}: {
  fieldKey: keyof TicketExtraction;
  value: string;
  confidence: number | null;
  onApply?: () => void;
}) {
  const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1 text-sm ${
        lowConfidence ? 'bg-amber-50' : ''
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span>
          <span className="font-medium">{TICKET_FIELD_LABELS[fieldKey]}:</span> {value}
        </span>
        <ConfidenceBadge tone="ai">Detectado por IA</ConfidenceBadge>
        {lowConfidence && <span className="text-xs text-amber-700">Revisa este dato</span>}
      </span>
      {onApply && (
        <button type="button" className={btn} onClick={onApply}>
          Usar este valor
        </button>
      )}
    </div>
  );
}

function AnalysisView({
  analysis,
  onApplyField,
}: {
  analysis: TicketAnalysisSummary;
  /** Sin él (solo lectura), los campos se muestran pero no se ofrece aplicarlos. */
  onApplyField?: (formField: string, value: string) => void;
}) {
  if (analysis.status === 'FAILED') {
    return (
      <Notice tone="error">
        ⚠ No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.
      </Notice>
    );
  }
  const { extraction, confidenceByField } = analysis;
  // `selections` es el único campo no escalar del contrato (§53): se excluye aquí, la revisión
  // de una apuesta múltiple queda para una iteración futura de esta pantalla.
  type ScalarField = Exclude<keyof TicketExtraction, 'selections'>;
  const entries = (Object.keys(extraction) as (keyof TicketExtraction)[]).filter(
    (key) => key !== 'selections' && extraction[key] !== undefined,
  ) as ScalarField[];
  // Cuota efectiva calculada (§6-§10, Fase 10.8): nunca sustituye la cuota visible (ya listada
  // arriba si el ticket la mostró); solo se añade cuando hay algo que calcular.
  const odds = ticketOddsSummary(extraction);
  return (
    <div className="flex flex-col gap-2">
      <Badge tone="green" icon={<CheckCircleIcon className="h-3.5 w-3.5" />}>
        Ticket leído
      </Badge>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">La IA no pudo leer ningún campo de este ticket.</p>
      ) : (
        <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2">
          {entries.map((key) => {
            const applicable = APPLICABLE_FIELDS.find((f) => f.key === key);
            const value = String(extraction[key]);
            // Presentación (§7-§8, Fase 10.9): la cuota visible nunca se muestra con más de 2
            // decimales, aunque "Usar este valor" sigue aplicando el valor exacto tal cual lo
            // leyó la IA (nunca el redondeado para mostrarla).
            const displayValue =
              key === 'officialTotalOdds' && isOddsString(value) ? formatOdds(value) : value;
            return (
              <FieldRow
                key={key}
                fieldKey={key}
                value={displayValue}
                confidence={confidenceByField?.[key] ?? null}
                onApply={
                  applicable && onApplyField
                    ? () => onApplyField(applicable.formField, value)
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
      {odds.effective && (
        <div className="flex flex-col gap-1 rounded-xl px-2 py-1.5 text-sm bg-violet-50">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {/* La cuota EFECTIVA (retorno ÷ importe) se muestra exacta, nunca a 2 decimales: p.
                  ej. "2.175" debe seguir viéndose así, no "2.18" (§5, §7 Fase 10.9) — recortar
                  aquí sería perder la cifra reproducible con el dinero real/potencial. Solo la
                  CALCULADA por producto de selecciones usa el formatter de 2 decimales (§2, §7). */}
              {odds.effective.source === 'SELECTIONS_PRODUCT'
                ? formatOdds(odds.effective.value)
                : odds.effective.value}
            </span>
            <ConfidenceBadge tone="calculated">
              {EFFECTIVE_ODDS_LABELS[odds.effective.source]}
            </ConfidenceBadge>
          </span>
          <span className="text-xs text-slate-500">
            {EFFECTIVE_ODDS_NOTES[odds.effective.source]}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Miniatura de un ticket con visor en grande (Fase 11, §16; Fase 11.3): la misma pieza la usa
 * `TicketCard` (64×64, al subir/analizar) y el panel "Ticket original" del Paso 2 del asistente
 * (más grande, de referencia) — un solo sitio que decide cómo se ve y se abre un ticket, nunca
 * una representación inventada de su contenido. Un PDF sigue abriéndose en una pestaña nueva,
 * porque el navegador ya lo muestra bien por su cuenta y un lightbox de imagen no sirve para
 * varias páginas.
 */
export function TicketThumbnail({
  projectId,
  ticket,
  className = 'h-16 w-16 object-cover',
  fill = false,
}: {
  projectId: string;
  ticket: TicketSummary;
  /** Tamaño y ajuste de la imagen; el marco (borde, radius, fondo) se añade aquí siempre igual. */
  className?: string;
  /**
   * Ocupa todo su contenedor, que debe estar posicionado (`relative`; la tarjeta "Ticket
   * original" de "Añadir apuesta"): la imagen se ajusta sin recortarse ni deformarse (`object-contain`) y muestra la
   * pista "Ampliar" — la vista principal de verificación, no una miniatura.
   */
  fill?: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isImage = ticket.mimeType !== 'application/pdf';
  const frame = fill ? 'group absolute inset-0 flex' : 'shrink-0';
  return (
    <>
      {isImage ? (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className={`${frame} rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500`}
          aria-label={`Ver ${ticket.originalFileName} en grande`}
        >
          <img
            src={ticketFileUrl(projectId, ticket.id)}
            alt={ticket.originalFileName}
            className={`rounded-xl border border-slate-200 transition-opacity hover:opacity-90 ${
              fill ? 'h-full w-full bg-slate-50 object-contain' : className
            }`}
          />
          {fill && (
            <span
              className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-slate-900/75 px-2 py-1 text-xs font-medium text-white opacity-80 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-black/70"
              aria-hidden="true"
            >
              <ExpandIcon className="h-3.5 w-3.5" />
              Ampliar
            </span>
          )}
        </button>
      ) : (
        <a
          href={ticketFileUrl(projectId, ticket.id)}
          target="_blank"
          rel="noreferrer"
          className={fill ? 'absolute inset-0 flex' : 'shrink-0'}
        >
          <span
            className={`flex items-center justify-center rounded-xl border border-slate-200 text-xs text-slate-500 ${
              fill ? 'h-full min-h-32 w-full bg-slate-50' : className
            }`}
          >
            PDF
          </span>
        </a>
      )}
      {lightboxOpen && isImage && (
        <Lightbox
          src={ticketFileUrl(projectId, ticket.id)}
          alt={ticket.originalFileName}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

function TicketCard({
  projectId,
  ticket,
  canAnalyze,
  onApplyField,
  onAnalyzed,
  onRemove,
}: {
  projectId: string;
  ticket: TicketSummary;
  canAnalyze: boolean;
  onApplyField?: (formField: string, value: string) => void;
  /**
   * Fase 10.7: cuando se da, el formulario se prellena completo con el resultado (sin pedir
   * "Usar este valor" campo por campo) — `onApplyField` se ignora en ese caso, lo decide quien
   * llama (`TicketPanel`).
   */
  onAnalyzed?: (result: TicketAnalysisSummary) => void;
  /** Solo en el alta (ticket todavía sin apuesta): permite quitarlo o subir otro en su lugar. */
  onRemove?: () => void;
}) {
  const [analysis, setAnalysis] = useState<TicketAnalysisSummary | null>(ticket.lastAnalysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await ticketsApi.analyze(projectId, ticket.id);
      setAnalysis(result);
      onAnalyzed?.(result);
    } catch (caught) {
      // `INTERNAL_ERROR` (corrección posterior al rediseño): `describeApiError` trata este código
      // como "no confiable" a propósito (otros puntos de la API, como los backups, pueden meter
      // ahí texto técnico) y lo sustituye por un genérico que no ayuda a nadie aquí. Un fallo al
      // leer el ticket con IA SÍ tiene un motivo conocido y seguro (proveedor caído, sin clave
      // configurada, imagen no procesable…): se muestra ese, en vez del genérico de servidor.
      setError(
        caught instanceof ApiError && caught.code === ErrorCode.INTERNAL_ERROR
          ? 'No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.'
          : describeApiError(caught),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        <TicketThumbnail projectId={projectId} ticket={ticket} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={ticket.originalFileName}>
            {ticket.originalFileName}
          </p>
          <p className="text-xs text-slate-500">
            Subido por {ticket.uploadedBy.name} · {formatDateTime(ticket.createdAt)}
          </p>
          {!analyzing && !analysis && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-green-700">
              <CheckCircleIcon className="h-3.5 w-3.5" /> Ticket listo
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAnalyze && (
            <button
              type="button"
              className={btnPrimary}
              disabled={analyzing}
              onClick={() => void analyze()}
            >
              {analyzing ? 'Analizando…' : analysis ? 'Volver a analizar' : 'Leer ticket con IA'}
            </button>
          )}
          {onRemove && (
            <button type="button" className={btn} onClick={onRemove} disabled={analyzing}>
              Cambiar ticket
            </button>
          )}
        </div>
      </div>
      {analyzing && (
        // Nunca un spinner genérico (Fase 11.1, §8): mientras se analiza se ve una "lectura" en
        // marcha (bloques de carga, no un círculo girando) y un texto que dice exactamente qué
        // está pasando, sin detalles técnicos del proveedor de IA.
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
            <SparkleIcon className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            Analizando tu ticket: identificando casa, importe, selecciones y resultado…
          </p>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      )}
      {error && <Notice tone="error">⚠ {error}</Notice>}
      {analysis && (
        <AnalysisView analysis={analysis} onApplyField={onAnalyzed ? undefined : onApplyField} />
      )}
    </div>
  );
}

/**
 * Zona para subir el ticket (§28, Fase 10.6): seleccionar archivo, arrastrar y soltar, o pegar
 * una imagen del portapapeles (Ctrl+V). No analiza nada por sí misma (D-T4): solo sube el
 * archivo; "Leer ticket con IA" es un paso explícito aparte, en `TicketCard`.
 */
function UploadZone({
  uploading,
  error,
  onFile,
}: {
  uploading: boolean;
  error: string | null;
  onFile: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function acceptOrReject(file: File) {
    if (!isAcceptedTicketFile(file)) {
      setLocalError('Solo se admiten imágenes (JPG, PNG) o PDF.');
      return;
    }
    setLocalError(null);
    onFile(file);
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) acceptOrReject(file);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) acceptOrReject(file);
  }

  // Ctrl+V sobre la zona: una imagen del portapapeles (captura, imagen copiada desde el
  // navegador, WhatsApp/Telegram, Paint…) se trata igual que un archivo seleccionado o
  // arrastrado. Solo actúa si el portapapeles trae de verdad una imagen (pegar texto en otro
  // campo del formulario no se ve afectado).
  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const item = Array.from(event.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    const blob = item.getAsFile();
    if (!blob) return;
    const name =
      blob.name && blob.name !== 'image.png'
        ? blob.name
        : `ticket-pegado${extensionForMime(item.type)}`;
    acceptOrReject(new File([blob], name, { type: item.type }));
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Sube tu ticket"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        dragOver
          ? 'border-violet-400 bg-violet-50'
          : 'border-slate-300 bg-surface hover:border-violet-300'
      }`}
    >
      <TicketIcon className="h-8 w-8 text-slate-400" />
      <p className="text-sm font-medium text-slate-800">Sube tu ticket</p>
      <p className="text-xs text-slate-500">Arrastra una imagen aquí o pega con Ctrl + V</p>
      <button
        type="button"
        className={btnPrimary}
        disabled={uploading}
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
      >
        {uploading ? 'Subiendo…' : 'Seleccionar archivo'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={TICKET_ACCEPT}
        className="hidden"
        aria-label="Adjuntar ticket"
        disabled={uploading}
        onChange={onFileInputChange}
      />
      {(localError ?? error) && <Notice tone="error">⚠ {localError ?? error}</Notice>}
    </div>
  );
}

/**
 * Tickets de una apuesta (§28-§31, §110): subir, ver y analizar con IA. `betId` es `null`
 * mientras se está registrando una apuesta nueva (el ticket se sube antes, huérfano, y se
 * vincula al enviar el formulario con `ticketId`, §110.3).
 */
export function TicketPanel({
  projectId,
  tickets,
  onUploaded,
  onApplyField,
  onAnalyzed,
  canUpload,
  canAnalyze,
  readOnly = false,
  onRemoveDraft,
}: {
  projectId: string;
  tickets: TicketSummary[];
  onUploaded: (ticket: TicketSummary) => void;
  /** Modo D-T5 clásico (campo por campo); se ignora si se da `onAnalyzed`. */
  onApplyField?: (formField: string, value: string) => void;
  /** Fase 10.7: modo de prellenado completo (§1-§12); lo usa "Añadir apuesta". */
  onAnalyzed?: (result: TicketAnalysisSummary) => void;
  canUpload: boolean;
  canAnalyze: boolean;
  /** Solo ver (botón "Ver ticket", Fase 10.3): sin subir, analizar ni aplicar campos. */
  readOnly?: boolean;
  /** Solo en el alta (§7, Fase 10.6): quita el ticket subido del borrador, sin tocar el servidor. */
  onRemoveDraft?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const ticket = await ticketsApi.upload(projectId, file);
      onUploaded(ticket);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setUploading(false);
    }
  }

  // Ctrl+V funciona también fuera de la zona de subida mientras no haya ningún ticket todavía:
  // solo actúa si el portapapeles trae una imagen (nunca interfiere con pegar texto en otro
  // campo del formulario).
  useEffect(() => {
    if (!canUpload || readOnly || tickets.length > 0) return;
    function onWindowPaste(event: ClipboardEvent) {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob || !isAcceptedTicketFile(blob)) return;
      event.preventDefault();
      const name =
        blob.name && blob.name !== 'image.png'
          ? blob.name
          : `ticket-pegado${extensionForMime(item.type)}`;
      void uploadFile(new File([blob], name, { type: item.type }));
    }
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUpload, readOnly, tickets.length]);

  return (
    <div className="flex flex-col gap-2">
      {tickets.map((ticket) => (
        <TicketCard
          key={ticket.id}
          projectId={projectId}
          ticket={ticket}
          canAnalyze={canAnalyze && !readOnly}
          onApplyField={readOnly ? undefined : onApplyField}
          onAnalyzed={readOnly ? undefined : onAnalyzed}
          onRemove={onRemoveDraft && !readOnly ? onRemoveDraft : undefined}
        />
      ))}
      {tickets.length === 0 && canUpload && !readOnly && (
        <UploadZone uploading={uploading} error={error} onFile={(file) => void uploadFile(file)} />
      )}
      {tickets.length === 0 && !canUpload && (
        <p className="text-xs text-slate-500">Todavía no hay tickets.</p>
      )}
    </div>
  );
}
