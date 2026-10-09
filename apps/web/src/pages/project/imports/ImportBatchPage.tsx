import { Link, useLocation, useParams } from 'react-router';
import type { ImportBatchSummaryRow } from '@letfer/shared';
import { useState } from 'react';
import { housesApi } from '../../../api/finance.js';
import {
  useImportBatch,
  useImportPreview,
  useImportReadiness,
} from '../../../hooks/useImportBatches.js';
import { useLoad } from '../../../hooks/useLoad.js';
import { formatDateTime } from '../../../labels.js';
import { Badge, LoadingBlock, Notice, Section } from '../../../ui.js';
import { useProject } from '../ProjectContext.js';
import {
  type ImportBatchLocationState,
  ImportBatchStatusBadge,
  ImportsGate,
  importsPath,
  isBatchOpen,
  toIso,
} from './ImportsCommon.js';
import { ImportPreviewSection } from './ImportPreviewPanels.js';
import { ImportProgress } from './ImportProgress.js';
import { HouseResolutionPanel, StagePlanPanel } from './ImportResolutionPanels.js';
import {
  AcknowledgmentPanel,
  AnnulmentPanel,
  ConfirmationPanel,
} from './ImportConfirmationPanels.js';

/**
 * Detalle de un lote de importación (§113.9). Resumen y estado del lote (9.4.3), resolución de casa
 * y plan de etapas (9.4.6, `ImportResolutionPanels`) y vista previa (9.4.5, `ImportPreviewPanels`),
 * reconocimiento, confirmación y anulación (9.4.7, `ImportConfirmationPanels`).
 */
export function ImportBatchPage() {
  return (
    <ImportsGate permission="imports.view">
      <ImportBatchDetail />
    </ImportsGate>
  );
}

function ImportBatchDetail() {
  const { project } = useProject();
  const { batchId = '' } = useParams();
  const locationState = useLocation().state as ImportBatchLocationState | null;
  const loaded = useImportBatch(project.id, batchId);
  const batch = loaded.data;

  return (
    <>
      <p>
        <Link
          to={importsPath(project.id)}
          className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-900"
        >
          ← Volver a importaciones
        </Link>
      </p>
      {loaded.loading && !batch && <LoadingBlock lines={3} label="Cargando lote…" />}
      {!loaded.loading && !batch && (
        <Notice tone="error">
          {loaded.errorStatus === 404
            ? 'No se encontró el lote de importación.'
            : (loaded.error ?? 'No se pudo cargar el lote de importación.')}
        </Notice>
      )}
      {batch && (
        <Section title={batch.originalName}>
          <div className="flex flex-wrap items-center gap-2">
            <ImportBatchStatusBadge status={batch.status} />
            {batch.isRehearsal && <Badge tone="blue">Ensayo</Badge>}
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Origen</dt>
              <dd>{batch.origin}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Subido</dt>
              <dd>{formatDateTime(toIso(batch.createdAt))}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Filas</dt>
              <dd>
                {batch.rowsTotal} en total · {batch.rowsValid} válidas · {batch.rowsPartial}{' '}
                parciales · {batch.rowsInvalid} inválidas
              </dd>
            </div>
            {batch.importedAt && (
              <div>
                <dt className="text-xs text-slate-500">Importado</dt>
                <dd>
                  {formatDateTime(toIso(batch.importedAt))}
                  {batch.importReason && ` · ${batch.importReason}`}
                </dd>
              </div>
            )}
            {batch.annulledAt && (
              <div>
                <dt className="text-xs text-slate-500">Anulado</dt>
                <dd>
                  {formatDateTime(toIso(batch.annulledAt))}
                  {batch.annulmentReason && ` · ${batch.annulmentReason}`}
                </dd>
              </div>
            )}
          </dl>
        </Section>
      )}
      {/* Solo tras cargar el lote: uno inexistente ya se informa arriba, sin un segundo error. */}
      {batch && (
        <ImportBatchWorkspace
          batch={batch}
          onBatchChange={loaded.setData}
          initialNotice={
            locationState?.uploaded
              ? 'Se subió el archivo. Todavía no se ha registrado nada en el ledger.'
              : null
          }
        />
      )}
    </>
  );
}

/**
 * Resolución, reconocimiento, confirmación y vista previa de un lote ya cargado. Las consultas
 * viven aquí porque cada acción cambia lo que muestran las demás: tras guardar, se actualiza el
 * lote con la respuesta y se vuelven a pedir la vista previa y la disponibilidad a la API (nunca
 * se deducen en la web).
 */
function ImportBatchWorkspace({
  batch,
  onBatchChange,
  initialNotice,
}: {
  batch: ImportBatchSummaryRow;
  onBatchChange: (batch: ImportBatchSummaryRow) => void;
  /** Aviso con el que se abre (p. ej. tras subir); la siguiente acción lo sustituye. */
  initialNotice: string | null;
}) {
  const { project } = useProject();
  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const preview = useImportPreview(project.id, batch.id);
  const readiness = useImportReadiness(project.id, batch.id);
  const [notice, setNotice] = useState<string | null>(initialNotice);

  // Qué vuelve a pedirse tras cada acción: la vista previa depende de la casa (duplicados contra lo
  // ya importado) y del estado del lote; la disponibilidad, además, del reconocimiento. El plan de
  // etapas no cambia ninguna de las dos.
  const refresh = (updated: ImportBatchSummaryRow) => {
    onBatchChange(updated);
    preview.reload();
    readiness.reload();
  };
  const refreshReadiness = (updated: ImportBatchSummaryRow) => {
    onBatchChange(updated);
    readiness.reload();
  };
  const open = isBatchOpen(batch);

  return (
    <>
      {notice && <Notice tone="success">{notice}</Notice>}
      <ImportProgress batch={batch} readiness={readiness.data} />
      {batch.status === 'IMPORTED' && (
        <Notice tone="info">
          Este lote ya está registrado en el ledger. Su casa y su plan de etapas ya no se pueden
          cambiar; solo puede anularse.
        </Notice>
      )}
      {batch.status === 'ANNULLED' && (
        <Notice tone="info">
          Este lote está anulado: lo que registró se revirtió en el ledger y sus apuestas quedaron
          eliminadas. Se conserva solo como historial y ya no admite cambios.
        </Notice>
      )}
      <HouseResolutionPanel
        batch={batch}
        houses={houses}
        houseCandidate={preview.data?.capital.houseCandidate ?? null}
        onSaved={refresh}
        onNotice={setNotice}
      />
      <StagePlanPanel
        batch={batch}
        candidates={preview.data?.stages.candidates ?? null}
        onSaved={onBatchChange}
        onNotice={setNotice}
      />
      {open && (
        <>
          <AcknowledgmentPanel
            batch={batch}
            readiness={readiness}
            onSaved={refreshReadiness}
            onNotice={setNotice}
          />
          <ConfirmationPanel
            batch={batch}
            houses={houses.data}
            preview={preview.data}
            readiness={readiness.data}
            onConfirmed={refresh}
            onNotice={setNotice}
          />
        </>
      )}
      <AnnulmentPanel batch={batch} onAnnulled={refresh} onNotice={setNotice} />
      <ImportPreviewSection preview={preview} />
    </>
  );
}
