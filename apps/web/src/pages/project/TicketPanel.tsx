import type { TicketAnalysisSummary, TicketExtraction, TicketSummary } from '@letfer/shared';
import { useState } from 'react';
import { ticketFileUrl } from '../../api/client.js';
import { describeApiError } from '../../api/errors.js';
import { ticketsApi } from '../../api/tickets.js';
import { formatDateTime, TICKET_FIELD_LABELS } from '../../labels.js';
import { btn, btnPrimary, Notice } from '../../ui.js';

/**
 * Campos de la extracción (§53) que tienen un campo equivalente en el formulario de apuesta y
 * por tanto admiten "usar este valor" (D-T5). El resto se muestra solo como referencia: el
 * formulario actual no tiene un campo editable para casa/fecha/tipo/resultado.
 */
const APPLICABLE_FIELDS: { key: keyof TicketExtraction; formField: string }[] = [
  { key: 'officialAmount', formField: 'officialAmount' },
  { key: 'officialTotalOdds', formField: 'visibleTotalOdds' },
  { key: 'officialPotentialReturn', formField: 'officialPotentialReturn' },
];

/** D-T6: alta confianza se ve normal, baja confianza se resalta para dirigir la revisión. */
const LOW_CONFIDENCE = 0.6;

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
      <span>
        <span className="font-medium">{TICKET_FIELD_LABELS[fieldKey]}:</span> {value}
        {confidence !== null && (
          <span className={`ml-2 text-xs ${lowConfidence ? 'text-amber-700' : 'text-slate-500'}`}>
            confianza {Math.round(confidence * 100)}%{lowConfidence && ' — revisa este dato'}
          </span>
        )}
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
  onApplyField: (formField: string, value: string) => void;
}) {
  if (analysis.status === 'FAILED') {
    return (
      <Notice tone="error">
        No se pudo analizar: {analysis.errorMessage ?? 'error desconocido del proveedor.'}
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
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500">La IA no pudo leer ningún campo de este ticket.</p>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-2">
      {entries.map((key) => {
        const applicable = APPLICABLE_FIELDS.find((f) => f.key === key);
        const value = String(extraction[key]);
        return (
          <FieldRow
            key={key}
            fieldKey={key}
            value={value}
            confidence={confidenceByField?.[key] ?? null}
            onApply={applicable ? () => onApplyField(applicable.formField, value) : undefined}
          />
        );
      })}
    </div>
  );
}

function TicketCard({
  projectId,
  ticket,
  canAnalyze,
  onApplyField,
}: {
  projectId: string;
  ticket: TicketSummary;
  canAnalyze: boolean;
  onApplyField: (formField: string, value: string) => void;
}) {
  const [analysis, setAnalysis] = useState<TicketAnalysisSummary | null>(ticket.lastAnalysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isImage = ticket.mimeType !== 'application/pdf';

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await ticketsApi.analyze(projectId, ticket.id);
      setAnalysis(result);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 p-2">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={ticketFileUrl(projectId, ticket.id)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0"
        >
          {isImage ? (
            <img
              src={ticketFileUrl(projectId, ticket.id)}
              alt={ticket.originalFileName}
              className="h-16 w-16 rounded border border-slate-200 object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded border border-slate-200 text-xs text-slate-500">
              PDF
            </span>
          )}
        </a>
        <div className="flex-1">
          <p className="text-sm font-medium">{ticket.originalFileName}</p>
          <p className="text-xs text-slate-500">
            Subido por {ticket.uploadedBy.name} · {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        {canAnalyze && (
          <button type="button" className={btn} disabled={analyzing} onClick={() => void analyze()}>
            {analyzing ? 'Analizando…' : analysis ? 'Volver a analizar' : 'Analizar con IA'}
          </button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {analysis && <AnalysisView analysis={analysis} onApplyField={onApplyField} />}
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
  canUpload,
  canAnalyze,
}: {
  projectId: string;
  tickets: TicketSummary[];
  onUploaded: (ticket: TicketSummary) => void;
  onApplyField: (formField: string, value: string) => void;
  canUpload: boolean;
  canAnalyze: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
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

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-medium">Tickets</h3>
      {tickets.length === 0 && <p className="text-xs text-slate-500">Todavía no hay tickets.</p>}
      {tickets.map((ticket) => (
        <TicketCard
          key={ticket.id}
          projectId={projectId}
          ticket={ticket}
          canAnalyze={canAnalyze}
          onApplyField={onApplyField}
        />
      ))}
      {canUpload && (
        <label className={`${btnPrimary} inline-flex w-fit cursor-pointer items-center`}>
          {uploading ? 'Subiendo…' : 'Adjuntar ticket'}
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(event) => void onFileSelected(event)}
          />
        </label>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
