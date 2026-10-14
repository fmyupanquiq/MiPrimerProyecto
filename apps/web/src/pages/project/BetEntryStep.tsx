import type { BetEntryMode, TicketSummary } from '@letfer/shared';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ticketFileUrl } from '../../api/client.js';
import {
  AlertIcon,
  BankIcon,
  BanknoteIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  CloudUploadIcon,
  CoinsIcon,
  DocumentIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileIcon,
  ImageIcon,
  LayersIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  ScanIcon,
  SearchIcon,
  SparkleIcon,
  SpinnerIcon,
  SwapIcon,
  TrashIcon,
  TrendIcon,
  TrophyIcon,
  XCircleIcon,
} from '../../icons.js';
import { Lightbox } from '../../ui.js';
import { Pill, Strip, wizardButton } from './bet-wizard.js';
import {
  acceptedFormatsLabel,
  formatFileSize,
  IMAGE_QUALITY_LABELS,
  imageQuality,
  pastedTicketFile,
  TICKET_ACCEPT,
  ticketFormatName,
} from './ticket-files.js';
import { CardIcon, WizardCard } from './WizardCard.js';

/*
 * Paso 1 del asistente "Añadir apuesta" (rediseño de los tres pasos, ADR 0024): elegir el ORIGEN del
 * registro (ticket leído con IA o manual) y el archivo. No contiene ningún campo de la apuesta (todos
 * viven en "Verificar datos"). Solo presenta: subir, analizar y el estado del formulario los lleva
 * `NewBetForm`. En modo Manual la imagen es solo un respaldo y nunca se analiza.
 *
 * Se exporta en dos piezas (columna principal y columna derecha) para que el formulario las coloque
 * en su rejilla de dos columnas o, en pantallas estrechas, una debajo de la otra.
 */

/** Estado del análisis del ticket en el Paso 1 (modo IA). */
export type AnalysisState =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | { kind: 'failed'; message: string }
  /** La lectura de este mismo ticket ya se aplicó al formulario. */
  | { kind: 'analyzed' };

export interface BetEntryProps {
  projectId: string;
  mode: BetEntryMode;
  onModeChange: (mode: BetEntryMode) => void;
  /** Puede subir Y analizar tickets: si no, el modo IA queda deshabilitado. */
  aiAllowed: boolean;
  canUpload: boolean;
  ticket: TicketSummary | null;
  /** URL de la imagen (objeto local recién subido o el archivo del servidor al retomar). */
  previewUrl: string | null;
  /** Dimensiones reales de la imagen (al cargarse la vista previa). */
  imageSize: { width: number; height: number } | null;
  onImageSize: (size: { width: number; height: number }) => void;
  uploading: boolean;
  fileError: string | null;
  onFile: (file: File) => void;
  onPasteFromClipboard: () => void;
  onRemove: () => void;
  analysis: AnalysisState;
  onRetryAnalysis: () => void;
  onManualFallback: () => void;
}

// --- Selector de origen ---------------------------------------------------------------------------

const MODES: { mode: BetEntryMode; title: string; text: string; icon: ReactNode }[] = [
  {
    mode: 'AI',
    title: 'Ticket con IA',
    text: 'Sube tu ticket y extraemos los datos con IA.',
    icon: <ScanIcon />,
  },
  {
    mode: 'MANUAL',
    title: 'Manual',
    text: 'Completa los datos de tu apuesta manualmente.',
    icon: <PencilIcon />,
  },
];

function OriginSelector({
  mode,
  onChange,
  aiAllowed,
  locked,
}: {
  mode: BetEntryMode;
  onChange: (mode: BetEntryMode) => void;
  aiAllowed: boolean;
  /** Mientras se analiza no se cambia de modo. */
  locked: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = (m: BetEntryMode) => !locked && (m === 'MANUAL' || aiAllowed);
  // Grupo de radio accesible: flechas para moverse entre opciones (y elegirlas), Espacio/Enter elige.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (index + step + MODES.length) % MODES.length;
    const target = MODES[next]!;
    if (!enabled(target.mode)) return;
    onChange(target.mode);
    refs.current[next]?.focus();
  }
  return (
    <WizardCard icon={<DocumentIcon />} title="Origen del registro" headingId="entry-origin">
      <div
        role="radiogroup"
        aria-labelledby="entry-origin"
        className="grid gap-3 @[30rem]:grid-cols-2"
      >
        {MODES.map((option, index) => {
          const selected = option.mode === mode;
          const disabled = !enabled(option.mode);
          return (
            <button
              key={option.mode}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => !disabled && onChange(option.mode)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`relative flex items-center gap-3 rounded-xl p-3 pr-10 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                selected
                  ? 'border-[1.5px] border-violet-500 bg-violet-50'
                  : 'border border-slate-200 bg-surface hover:border-violet-300'
              } ${disabled ? 'cursor-not-allowed opacity-55' : ''}`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[22px] [&>svg]:w-[22px] ${
                  selected ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
                aria-hidden="true"
              >
                {option.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.95rem] font-semibold text-slate-900">
                  {option.title}
                </span>
                <span className="block text-xs text-slate-500">{option.text}</span>
              </span>
              <span
                className={`absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full ${
                  selected ? 'bg-violet-600 text-white' : 'border-[1.5px] border-slate-300'
                }`}
                aria-hidden="true"
              >
                {selected && <CheckIcon className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>
      {!aiAllowed && (
        <p className="text-xs text-slate-500">No tienes permiso para analizar tickets.</p>
      )}
    </WizardCard>
  );
}

// --- Zona de carga --------------------------------------------------------------------------------

function DropZone({
  tone,
  uploading,
  onFile,
  onBrowse,
  onPasteFromClipboard,
  text,
}: {
  tone: 'violet' | 'neutral';
  uploading: boolean;
  onFile: (file: File) => void;
  onBrowse: () => void;
  onPasteFromClipboard: () => void;
  text: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  const idle =
    tone === 'violet'
      ? 'border-dashed border-violet-400/70 bg-violet-50/30'
      : 'border-dashed border-slate-300 bg-surface';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Sube tu ticket"
      title="Arrastra el archivo, pégalo con Ctrl+V o pulsa para seleccionarlo"
      aria-disabled={uploading || undefined}
      onClick={() => !uploading && onBrowse()}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!uploading) onBrowse();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file && !uploading) onFile(file);
      }}
      // Ctrl+V sobre la zona: una imagen del portapapeles se trata como un archivo elegido.
      onPaste={(event) => {
        const item = Array.from(event.clipboardData.items).find((i) => i.type.startsWith('image/'));
        const blob = item?.getAsFile();
        if (!item || !blob) return;
        event.preventDefault();
        if (!uploading) onFile(pastedTicketFile(blob, item.type));
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] px-4 text-center ${
        tone === 'violet' ? 'min-h-[12.5rem] py-6' : 'min-h-[10.5rem] py-4'
      } transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        dragOver ? 'border-solid border-violet-500 bg-violet-100/60' : idle
      }`}
    >
      <CloudUploadIcon
        className={`h-10 w-10 ${tone === 'violet' ? 'text-violet-600' : 'text-slate-500'}`}
      />
      <p className="text-[0.95rem] text-slate-900">{text}</p>
      <p className="text-xs text-slate-500">{acceptedFormatsLabel()}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className={`${wizardButton.primary} min-w-48`}
          disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();
            onBrowse();
          }}
        >
          {uploading ? <SpinnerIcon className="animate-spin" /> : <ImageIcon />}
          {uploading ? 'Subiendo…' : 'Seleccionar archivo'}
        </button>
        <button
          type="button"
          className={`${wizardButton.outline} min-w-48`}
          disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();
            onPasteFromClipboard();
          }}
        >
          <ClipboardIcon />
          Pegar desde portapapeles
        </button>
      </div>
    </div>
  );
}

/** Miniatura del archivo: la imagen en `object-contain`, o una ficha "PDF". */
function FileThumb({
  ticket,
  url,
  className,
}: {
  ticket: TicketSummary;
  url: string | null;
  className: string;
}) {
  if (ticket.mimeType === 'application/pdf' || !url) {
    return (
      <span
        className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-600 ${className}`}
        aria-hidden="true"
      >
        <FileIcon className="h-5 w-5" />
        {ticketFormatName(ticket.mimeType)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={`shrink-0 rounded-md border border-slate-200 bg-slate-100 object-contain ${className}`}
    />
  );
}

/** "234 KB • JPG • 1080 × 1812" (sin dimensiones para PDF o mientras no se conocen). */
function fileMeta(ticket: TicketSummary, size: BetEntryProps['imageSize']): string {
  const parts = [formatFileSize(ticket.sizeBytes), ticketFormatName(ticket.mimeType)];
  if (size && ticket.mimeType !== 'application/pdf') parts.push(`${size.width} × ${size.height}`);
  return parts.join(' • ');
}

// --- Columna principal ----------------------------------------------------------------------------

export function BetEntryMain(props: BetEntryProps) {
  const {
    mode,
    onModeChange,
    aiAllowed,
    canUpload,
    ticket,
    previewUrl,
    imageSize,
    uploading,
    fileError,
    onFile,
    onPasteFromClipboard,
    onRemove,
    analysis,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const browse = () => inputRef.current?.click();
  const analyzing = analysis.kind === 'analyzing';
  const isImage = ticket !== null && ticket.mimeType !== 'application/pdf';
  const quality = isImage && imageSize ? imageQuality(imageSize.width, imageSize.height) : null;

  // Sin permiso para subir no hay selector de archivos (manda la API, esto solo mejora la interfaz).
  const input = canUpload && (
    <input
      ref={inputRef}
      type="file"
      accept={TICKET_ACCEPT}
      className="hidden"
      aria-label="Adjuntar ticket"
      disabled={uploading || analyzing}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onFile(file);
      }}
    />
  );

  const fileActions = ticket && (
    <div className="flex shrink-0 gap-2 @max-[34rem]:w-full">
      <button
        type="button"
        className={wizardButton.outline}
        onClick={browse}
        disabled={uploading || analyzing}
      >
        <SwapIcon />
        Cambiar
      </button>
      <button
        type="button"
        className={wizardButton.danger}
        onClick={onRemove}
        disabled={uploading || analyzing}
      >
        <TrashIcon />
        Eliminar
      </button>
    </div>
  );

  const fileStatus = (
    <div aria-live="polite" className="contents">
      {uploading ? (
        <p className="flex items-center gap-2 text-sm text-violet-700">
          <SpinnerIcon className="h-4 w-4 animate-spin" /> Subiendo…
        </p>
      ) : null}
      {fileError && (
        <p className="flex items-center gap-2 text-sm text-red-700">
          <XCircleIcon className="h-4 w-4 shrink-0" />
          {fileError}
        </p>
      )}
    </div>
  );

  if (mode === 'AI') {
    return (
      <>
        {input}
        <OriginSelector
          mode={mode}
          onChange={onModeChange}
          aiAllowed={aiAllowed}
          locked={analyzing}
        />
        <WizardCard icon={<DocumentIcon />} title="Cargar ticket">
          <DropZone
            tone="violet"
            uploading={uploading || analyzing}
            onFile={onFile}
            onBrowse={browse}
            onPasteFromClipboard={onPasteFromClipboard}
            text="Arrastra tu ticket aquí o selecciona una imagen"
          />
        </WizardCard>
        <WizardCard icon={<ClockIcon />} title="Estado del archivo">
          <div
            aria-live="polite"
            className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 p-3"
          >
            {ticket ? (
              <>
                <FileThumb ticket={ticket} url={previewUrl} className="h-[72px] w-14" />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[0.95rem] font-semibold text-slate-900"
                    title={ticket.originalFileName}
                  >
                    {ticket.originalFileName}
                  </p>
                  <p className="text-sm text-slate-500 tabular-nums">
                    {fileMeta(ticket, imageSize)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {quality && (
                      <Pill
                        tone={quality === 'HIGH' ? 'green' : quality === 'MEDIUM' ? 'amber' : 'red'}
                        icon={quality === 'LOW' ? <AlertIcon /> : <CheckCircleIcon />}
                        title="Estimada por la resolución de la imagen."
                      >
                        {IMAGE_QUALITY_LABELS[quality]}
                      </Pill>
                    )}
                    <Pill tone="green" icon={<CheckCircleIcon />}>
                      Listo para analizar
                    </Pill>
                  </div>
                  {quality === 'LOW' && (
                    <p className="mt-1 text-xs text-red-700">
                      Puede que la IA no lea bien este ticket.
                    </p>
                  )}
                </div>
                {fileActions}
              </>
            ) : (
              <>
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
                  aria-hidden="true"
                >
                  <FileIcon className="h-7 w-7" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.95rem] font-semibold text-slate-900">
                    Ningún archivo cargado
                  </p>
                  <p className="text-sm text-slate-500">
                    Aún no has seleccionado una imagen para analizar.
                  </p>
                </div>
                <Pill tone="slate" icon={<ClockIcon />}>
                  Esperando archivo
                </Pill>
              </>
            )}
          </div>
          {fileStatus}
        </WizardCard>
        <Strip tone="info">
          ¿No tienes un ticket? Puedes cambiar a{' '}
          <button
            type="button"
            className="font-medium text-violet-700 hover:underline disabled:opacity-55"
            disabled={analyzing}
            onClick={() => onModeChange('MANUAL')}
          >
            modo Manual
          </button>{' '}
          para registrar la apuesta paso a paso.
        </Strip>
      </>
    );
  }

  // --- Manual ---
  return (
    <>
      {input}
      <OriginSelector mode={mode} onChange={onModeChange} aiAllowed={aiAllowed} locked={false} />
      <WizardCard
        icon={<DocumentIcon />}
        tone="blue"
        title="Registro manual"
        description="Completa los datos de tu apuesta en el siguiente paso. No usaremos IA para extraer información."
      />
      {canUpload && (
        <>
          <WizardCard
            icon={<ImageIcon />}
            title="Ticket de respaldo (opcional)"
            description="Puedes adjuntar una imagen de tu ticket solo como respaldo. No será analizada con IA."
            aside={<Pill tone="slate">Opcional</Pill>}
          >
            {ticket ? (
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 p-3">
                <FileThumb ticket={ticket} url={previewUrl} className="h-[130px] w-[100px]" />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[0.95rem] font-semibold text-slate-900"
                    title={ticket.originalFileName}
                  >
                    {ticket.originalFileName}
                  </p>
                  <p className="text-sm text-slate-500">
                    {ticketFormatName(ticket.mimeType)} • {formatFileSize(ticket.sizeBytes)}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-green-700">
                    <CheckCircleIcon className="h-4 w-4" />
                    Archivo adjunto
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    className={wizardButton.outline}
                    onClick={browse}
                    disabled={uploading}
                  >
                    <SwapIcon />
                    Cambiar
                  </button>
                  <button
                    type="button"
                    className={wizardButton.danger}
                    onClick={onRemove}
                    disabled={uploading}
                  >
                    <TrashIcon />
                    Eliminar
                  </button>
                </div>
              </div>
            ) : (
              <DropZone
                tone="neutral"
                uploading={uploading}
                onFile={onFile}
                onBrowse={browse}
                onPasteFromClipboard={onPasteFromClipboard}
                text={
                  <>
                    Arrastra una imagen aquí o{' '}
                    <span className="font-medium text-violet-700">selecciona un archivo</span>
                  </>
                }
              />
            )}
            {fileStatus}
          </WizardCard>
          <WizardCard
            dense
            icon={<FileIcon />}
            tone="slate"
            title="Estado del archivo"
            aside={<Pill tone="slate">Opcional</Pill>}
          >
            <div aria-live="polite">
              {ticket ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">1 archivo adjunto</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                      <FileIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate" title={ticket.originalFileName}>
                        {ticket.originalFileName}
                      </span>
                      <span className="shrink-0">• {formatFileSize(ticket.sizeBytes)}</span>
                    </p>
                  </div>
                  <Pill tone="green" icon={<CheckCircleIcon />}>
                    Listo
                  </Pill>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-slate-900">Ningún archivo adjunto</p>
                  <p className="text-sm text-slate-500">
                    Puedes continuar sin adjuntar una imagen.
                  </p>
                </>
              )}
            </div>
          </WizardCard>
        </>
      )}
      <Strip tone="info">
        En el siguiente paso podrás ingresar casa de apuestas, fecha, tipo de apuesta, selecciones,
        stake, cuota y resultado.
      </Strip>
    </>
  );
}

// --- Columna derecha ------------------------------------------------------------------------------

function ProcessCard({
  tone,
  icon,
  title,
  text,
  children,
}: {
  tone: 'amber' | 'violet' | 'red' | 'green';
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  const circle = {
    amber: 'bg-amber-100 text-amber-600',
    violet: 'bg-violet-100 text-violet-600',
    red: 'bg-red-100 text-red-600',
    green: 'bg-green-100 text-green-600',
  }[tone];
  const titleTone = {
    amber: 'text-amber-700',
    violet: 'text-violet-700',
    red: 'text-red-700',
    green: 'text-green-700',
  }[tone];
  return (
    <WizardCard
      compact
      icon={<PlusIcon />}
      title="Estado del proceso"
      ariaLabel="Estado del proceso"
    >
      <div aria-live="polite" className="flex items-center gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6 ${circle}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className={`text-[0.95rem] font-semibold ${titleTone}`}>{title}</p>
          <p className="text-sm text-slate-500">{text}</p>
        </div>
      </div>
      {children}
    </WizardCard>
  );
}

const AI_DETECTS: { label: string; icon: ReactNode }[] = [
  { label: 'Casa de apuestas', icon: <BankIcon /> },
  { label: 'Fecha', icon: <CalendarIcon /> },
  { label: 'Tipo de apuesta', icon: <LayersIcon /> },
  { label: 'Selecciones', icon: <ListIcon /> },
  { label: 'Stake', icon: <CoinsIcon /> },
  { label: 'Monto apostado', icon: <BanknoteIcon /> },
  { label: 'Cuota', icon: <TrendIcon /> },
  { label: 'Resultado', icon: <TrophyIcon /> },
];

const MANUAL_CAN: { label: string; icon: ReactNode }[] = [
  { label: 'Ingresar los datos manualmente', icon: <PencilIcon /> },
  { label: 'Añadir una o varias selecciones', icon: <ListIcon /> },
  { label: 'Guardar el ticket como respaldo', icon: <ImageIcon /> },
  { label: 'Revisar antes de confirmar', icon: <EyeIcon /> },
];

function PreviewCard({
  projectId,
  ticket,
  previewUrl,
  onImageSize,
  manual,
}: {
  projectId: string;
  ticket: TicketSummary | null;
  previewUrl: string | null;
  onImageSize: BetEntryProps['onImageSize'];
  manual: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isImage = ticket !== null && ticket.mimeType !== 'application/pdf';
  const fullUrl = ticket ? ticketFileUrl(projectId, ticket.id) : null;
  const openFull = () => {
    if (!ticket || !fullUrl) return;
    if (isImage) setOpen(true);
    else window.open(fullUrl, '_blank', 'noopener');
  };
  const title = manual ? 'Vista previa del respaldo' : 'Vista previa del ticket';
  return (
    <WizardCard
      compact
      icon={manual ? <ImageIcon /> : <EyeIcon />}
      title={title}
      aside={
        !manual && (
          <button
            type="button"
            className={wizardButton.small}
            disabled={!ticket}
            onClick={openFull}
          >
            <ExternalLinkIcon />
            Ver ticket
          </button>
        )
      }
    >
      {ticket ? (
        <div className="relative flex h-[15.5rem] items-center justify-center overflow-hidden rounded-lg bg-slate-100">
          {isImage && previewUrl ? (
            <img
              src={previewUrl}
              alt={`Vista previa de ${ticket.originalFileName}`}
              className="h-full w-full object-contain"
              onLoad={(event) =>
                onImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
              <FileIcon className="h-12 w-12 text-slate-400" />
              Documento {ticketFormatName(ticket.mimeType)}
            </div>
          )}
          {manual && (
            <button
              type="button"
              onClick={openFull}
              className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-violet-400"
            >
              <SearchIcon className="h-3.5 w-3.5" />
              Ver imagen
            </button>
          )}
        </div>
      ) : (
        <div className="flex h-[15.5rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 text-center">
          <ImageIcon className="h-12 w-12 text-slate-400" />
          <p className="text-[0.95rem] font-medium text-slate-900">
            {manual ? 'Sin imagen adjunta' : 'Sin vista previa'}
          </p>
          <p className="text-sm text-slate-500">
            {manual
              ? 'Si adjuntas un respaldo, lo verás aquí.'
              : 'Carga un ticket para ver aquí su previsualización.'}
          </p>
        </div>
      )}
      {open && isImage && fullUrl && ticket && (
        <Lightbox src={fullUrl} alt={ticket.originalFileName} onClose={() => setOpen(false)} />
      )}
    </WizardCard>
  );
}

function IconList({
  items,
  columns,
}: {
  items: { label: string; icon: ReactNode }[];
  columns: 1 | 2;
}) {
  return (
    <ul
      className={`grid gap-x-3 gap-y-2.5 text-[0.8rem] text-slate-800 ${
        columns === 2 ? 'grid-flow-col grid-cols-2 grid-rows-4' : ''
      }`}
    >
      {items.map((item) => (
        <li key={item.label} className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <span className="shrink-0 text-slate-500 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function BetEntryAside(props: BetEntryProps) {
  const { projectId, mode, ticket, previewUrl, onImageSize, analysis } = props;
  if (mode === 'MANUAL') {
    return (
      <>
        <PreviewCard
          projectId={projectId}
          ticket={ticket}
          previewUrl={previewUrl}
          onImageSize={onImageSize}
          manual
        />
        <WizardCard compact icon={<ImageIcon />} title="¿Qué podrás hacer?">
          <IconList items={MANUAL_CAN} columns={1} />
        </WizardCard>
        {ticket ? (
          <section
            aria-label="Estado del proceso"
            className="flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50/60 p-4"
          >
            <CardIcon icon={<AlertIcon />} tone="amber" />
            <div aria-live="polite" className="min-w-0">
              <h4 className="text-[0.98rem] font-semibold text-slate-900">Estado del proceso</h4>
              <p className="text-sm font-semibold text-amber-700">Listo para continuar</p>
              <p className="text-sm text-slate-500">
                Puedes seguir al siguiente paso para verificar y completar los datos de tu apuesta.
              </p>
            </div>
          </section>
        ) : (
          <ProcessCard
            tone="amber"
            icon={<ClockIcon />}
            title="Listo para continuar"
            text="Puedes seguir aunque no adjuntes un archivo."
          />
        )}
      </>
    );
  }

  let process: ReactNode;
  if (analysis.kind === 'analyzing') {
    process = (
      <ProcessCard
        tone="violet"
        icon={<SpinnerIcon className="animate-spin" />}
        title="Analizando ticket…"
        text="Esto puede tardar unos segundos."
      />
    );
  } else if (analysis.kind === 'failed') {
    process = (
      <ProcessCard
        tone="red"
        icon={<XCircleIcon />}
        title="No se pudo analizar el ticket"
        text={analysis.message}
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" className={wizardButton.outline} onClick={props.onRetryAnalysis}>
            <SparkleIcon />
            Reintentar
          </button>
          <button type="button" className={wizardButton.violet} onClick={props.onManualFallback}>
            <PencilIcon />
            Continuar en modo Manual
          </button>
        </div>
      </ProcessCard>
    );
  } else if (analysis.kind === 'analyzed' && ticket) {
    process = (
      <ProcessCard
        tone="green"
        icon={<CheckCircleIcon />}
        title="Ticket analizado"
        text="Los datos ya están en el formulario: continúa para verificarlos."
      />
    );
  } else if (ticket) {
    process = (
      <ProcessCard
        tone="amber"
        icon={<ClockIcon />}
        title="Pendiente de análisis"
        text="El ticket está listo para ser procesado."
      />
    );
  } else {
    process = (
      <ProcessCard
        tone="amber"
        icon={<ClockIcon />}
        title="Esperando ticket"
        text="Sube una imagen para iniciar el análisis."
      />
    );
  }

  return (
    <>
      <PreviewCard
        projectId={projectId}
        ticket={ticket}
        previewUrl={previewUrl}
        onImageSize={onImageSize}
        manual={false}
      />
      <WizardCard compact icon={<SparkleIcon />} title="La IA detectará">
        <IconList items={AI_DETECTS} columns={2} />
      </WizardCard>
      {process}
    </>
  );
}
