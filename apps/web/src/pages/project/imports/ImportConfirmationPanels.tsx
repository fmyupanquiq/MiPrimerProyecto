import {
  formatPEN,
  type HouseSummary,
  type ImportBatchSummaryRow,
  type ImportConfirmationReadiness,
  type ImportPreview,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { isReauthCancelled } from '../../../auth/ReauthContext.js';
import {
  useAcknowledgeImport,
  useAnnulImport,
  useConfirmImport,
} from '../../../hooks/useImportBatches.js';
import type { Loaded } from '../../../hooks/useLoad.js';
import { formatDateTime } from '../../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../../ui.js';
import { useProject } from '../ProjectContext.js';
import {
  apiIssues,
  FinancialSemaphoreBadge,
  ImportActionError,
  ImportBatchStatusBadge,
  isBatchOpen,
  toIso,
} from './ImportsCommon.js';
import { savedPlan } from './ImportResolutionPanels.js';

/*
 * Reconocimiento, confirmación y anulación de un lote (Fase 9.4.7; D-X17b, §113.6–§113.8, D-X26).
 * Si el lote está bloqueado, si necesita reconocimiento y por qué lo dice la API
 * (`GET /readiness`, la misma comprobación que aplica `confirm`); esta pantalla no lo deduce, no
 * calcula nada financiero y no toca el ledger. Las tres acciones exigen reautenticación reciente
 * (los hooks usan `useReauth`).
 */

function ReasonList({ reasons }: { reasons: string[] }) {
  return (
    <ul className="list-disc pl-5 text-sm">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}

// --- Reconocimiento (D-X17b) --------------------------------------------------------------------

export function AcknowledgmentPanel({
  batch,
  readiness,
  onSaved,
  onNotice,
}: {
  batch: ImportBatchSummaryRow;
  readiness: Loaded<ImportConfirmationReadiness>;
  onSaved: (batch: ImportBatchSummaryRow) => void;
  onNotice: (message: string) => void;
}) {
  const { project, can } = useProject();
  const { acknowledge, loading, error } = useAcknowledgeImport(project.id, batch.id);
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const data = readiness.data;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssues([]);
    try {
      const updated = await acknowledge({ reason });
      setReason('');
      onNotice('Se registró el reconocimiento del lote.');
      onSaved(updated);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setIssues(apiIssues(caught));
    }
  }

  return (
    <Section title="Reconocimiento">
      {readiness.loading && !data && <p className="text-sm">Comprobando el lote…</p>}
      {readiness.error && <Notice tone="error">{readiness.error}</Notice>}
      {data?.blocked && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          <p className="font-medium">El lote está bloqueado: no puede confirmarse.</p>
          <p>Un reconocimiento no levanta estos motivos:</p>
          <ReasonList reasons={data.blockingReasons} />
        </div>
      )}
      {data && !data.needsAcknowledgment && (
        <p className="text-sm text-slate-600">Este lote no necesita reconocimiento.</p>
      )}
      {data?.needsAcknowledgment && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            Este lote necesita un reconocimiento explícito antes de confirmarse:
          </p>
          <ReasonList reasons={data.acknowledgmentReasons} />
        </div>
      )}
      {batch.acknowledgedAt && (
        <p className="text-sm">
          <Badge tone="green">Reconocido</Badge> {formatDateTime(toIso(batch.acknowledgedAt))}
          {batch.acknowledgmentReason && ` · Motivo: ${batch.acknowledgmentReason}`}
        </p>
      )}
      {data?.needsAcknowledgment && can('import.run') && isBatchOpen(batch) && (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-2"
          aria-label="Reconocer el lote"
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Motivo del reconocimiento
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={inputClass}
              rows={2}
              disabled={loading}
            />
          </label>
          <ImportActionError error={error} issues={issues} />
          <button
            type="submit"
            className={`${btnPrimary} self-start`}
            disabled={loading || reason.trim() === ''}
          >
            {loading ? 'Guardando…' : batch.acknowledgedAt ? 'Volver a reconocer' : 'Reconocer'}
          </button>
        </form>
      )}
    </Section>
  );
}

// --- Preparación y confirmación (§113.6, D-X26) -------------------------------------------------

export function ConfirmationPanel({
  batch,
  houses,
  preview,
  readiness,
  onConfirmed,
  onNotice,
}: {
  batch: ImportBatchSummaryRow;
  houses: HouseSummary[] | null;
  preview: ImportPreview | null;
  readiness: ImportConfirmationReadiness | null;
  onConfirmed: (batch: ImportBatchSummaryRow) => void;
  onNotice: (message: string) => void;
}) {
  const { project, can } = useProject();
  const { confirm, loading, error } = useConfirmImport(project.id, batch.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isRehearsal, setIsRehearsal] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  const house = houses?.find((candidate) => candidate.id === batch.houseId) ?? null;
  const plan = savedPlan(batch);
  const canRun = can('import.run') && isBatchOpen(batch);
  // Lo que falta para confirmar, para no ofrecer lo que la API rechazaría: el estado y el plan se
  // ven en el propio lote; bloqueo y reconocimiento, en el veredicto de la API (`readiness`).
  const missing: string[] = [];
  if (batch.status === 'UPLOADED') missing.push('Confirma la casa del lote.');
  if (plan === null) missing.push('Guarda el plan de etapas.');
  if (readiness?.blocked) missing.push('El lote está bloqueado: revisa las filas con errores.');
  else if (readiness?.needsAcknowledgment && !readiness.acknowledged) {
    missing.push('Falta el reconocimiento del lote.');
  }
  const ready = missing.length === 0 && readiness?.canConfirm === true;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssues([]);
    try {
      const result = await confirm({ reason, isRehearsal });
      setOpen(false);
      setReason('');
      onNotice(
        `Se importó el lote: ${result.report.bets.total} apuestas y ${result.report.stages} etapas registradas.`,
      );
      onConfirmed(result.batch);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setIssues(apiIssues(caught));
    }
  }

  return (
    <Section title="Confirmación">
      <p className="text-sm text-slate-600">
        Confirmar registra el lote en el ledger en una sola operación. Revisa el resumen antes de
        hacerlo.
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-600">Estado del lote</dt>
          <dd>
            <ImportBatchStatusBadge status={batch.status} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Casa</dt>
          <dd>{batch.houseId === null ? 'Sin confirmar' : (house?.name ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Plan de etapas</dt>
          <dd>{plan ? `${plan.stages.length} etapa(s) guardada(s)` : 'Sin plan guardado'}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Apuestas que entrarían</dt>
          <dd>{preview ? preview.summary.preliminaryBets : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Estado financiero</dt>
          <dd>
            {readiness ? <FinancialSemaphoreBadge semaphore={readiness.financialSemaphore} /> : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Requiere reconocimiento</dt>
          <dd>
            {readiness === null
              ? '—'
              : !readiness.needsAcknowledgment
                ? 'No'
                : readiness.acknowledged
                  ? 'Sí, ya reconocido'
                  : `Sí, pendiente (${readiness.acknowledgmentReasons.length} motivo(s))`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Puede confirmarse</dt>
          <dd>{readiness === null ? '—' : readiness.canConfirm ? 'Sí' : 'No'}</dd>
        </div>
      </dl>
      {missing.length > 0 && (
        <div className="text-sm text-slate-600">
          <p>Antes de confirmar:</p>
          <ReasonList reasons={missing} />
        </div>
      )}

      {canRun && !open && (
        <button
          type="button"
          className={`${btnPrimary} self-start`}
          disabled={!ready}
          onClick={() => setOpen(true)}
        >
          Confirmar importación
        </button>
      )}
      {canRun && open && (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-2 rounded border border-slate-200 p-3"
          aria-label="Confirmar importación"
        >
          <p className="text-sm font-medium">¿Confirmar la importación?</p>
          <ul className="list-disc pl-5 text-sm">
            <li>
              Se registrarán en el ledger {preview ? preview.summary.preliminaryBets : '—'} apuestas
              en {house?.name ?? 'la casa del lote'}, repartidas en {plan?.stages.length ?? 0}{' '}
              etapa(s) nuevas.
            </li>
            {preview?.capital.detected && preview.capital.amount && (
              <li>
                También el capital inicial declarado en el archivo:{' '}
                {formatPEN(preview.capital.amount)}.
              </li>
            )}
            <li>Todo se escribe en una sola operación; si algo falla, no se registra nada.</li>
            <li>Solo podrá deshacerse anulando el lote, que revierte lo registrado.</li>
          </ul>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Motivo de la confirmación
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={inputClass}
              rows={2}
              disabled={loading}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={isRehearsal}
              onChange={(event) => setIsRehearsal(event.target.checked)}
              disabled={loading}
            />
            <span>
              Es un ensayo: no corresponde a datos reales. Un ensayo no exige un backup reciente;
              una importación real sí (D-X26).
            </span>
          </label>
          <ImportActionError error={error} issues={issues} />
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={loading || reason.trim() === ''}>
              {loading ? 'Importando…' : 'Confirmar'}
            </button>
            <button type="button" className={btn} disabled={loading} onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

// --- Anulación (§113.8) ------------------------------------------------------------------------

export function AnnulmentPanel({
  batch,
  onAnnulled,
  onNotice,
}: {
  batch: ImportBatchSummaryRow;
  onAnnulled: (batch: ImportBatchSummaryRow) => void;
  onNotice: (message: string) => void;
}) {
  const { project, can } = useProject();
  const { annul, loading, error } = useAnnulImport(project.id, batch.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<string[]>([]);

  if (batch.status !== 'IMPORTED' || !can('import.run')) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssues([]);
    try {
      const result = await annul({ reason });
      setOpen(false);
      onNotice(
        `Se anuló el lote: ${result.annulledBetIds.length} apuestas anuladas y ${result.reversedMovementIds.length} movimientos revertidos.`,
      );
      onAnnulled(result.batch);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setIssues(apiIssues(caught));
    }
  }

  return (
    <Section title="Anulación">
      <p className="text-sm text-slate-600">
        Anular revierte en el ledger lo que el lote registró (con reversiones, sin borrar nada). Sus
        apuestas quedan eliminadas y no pueden restaurarse una a una.
      </p>
      {!open ? (
        <button type="button" className={`${btn} self-start`} onClick={() => setOpen(true)}>
          Anular lote
        </button>
      ) : (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-2 rounded border border-red-200 p-3"
          aria-label="Anular lote"
        >
          <p className="text-sm font-medium">
            ¿Anular este lote? Esta acción no se puede deshacer.
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Motivo de la anulación
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={inputClass}
              rows={2}
              disabled={loading}
            />
          </label>
          <ImportActionError error={error} issues={issues} />
          <div className="flex gap-2">
            <button type="submit" className={btnDanger} disabled={loading || reason.trim() === ''}>
              {loading ? 'Anulando…' : 'Confirmar anulación'}
            </button>
            <button type="button" className={btn} disabled={loading} onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
