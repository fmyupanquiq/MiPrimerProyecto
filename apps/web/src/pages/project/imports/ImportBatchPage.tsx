import { Link, useLocation, useParams } from 'react-router';
import type { ImportBatchSummaryRow } from '@letfer/shared';
import { useImportBatch, useImportPreview } from '../../../hooks/useImportBatches.js';
import { formatDateTime } from '../../../labels.js';
import { Badge, Notice, Section } from '../../../ui.js';
import { useProject } from '../ProjectContext.js';
import {
  type ImportBatchLocationState,
  ImportBatchStatusBadge,
  ImportsGate,
  importsPath,
  toIso,
} from './ImportsCommon.js';
import { ImportPreviewSection } from './ImportPreviewPanels.js';

/**
 * Detalle de un lote de importación (§113.9). Resumen y estado del lote (9.4.3) y vista previa
 * (9.4.5, `ImportPreviewPanels`).
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
        <Link to={importsPath(project.id)} className="text-sm underline">
          ← Volver a importaciones
        </Link>
      </p>
      {loaded.loading && !batch && <p>Cargando lote…</p>}
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
              <dt className="text-slate-600">Origen</dt>
              <dd>{batch.origin}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Subido</dt>
              <dd>{formatDateTime(toIso(batch.createdAt))}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Filas</dt>
              <dd>
                {batch.rowsTotal} en total · {batch.rowsValid} válidas · {batch.rowsPartial}{' '}
                parciales · {batch.rowsInvalid} inválidas
              </dd>
            </div>
            {batch.importedAt && (
              <div>
                <dt className="text-slate-600">Importado</dt>
                <dd>
                  {formatDateTime(toIso(batch.importedAt))}
                  {batch.importReason && ` · ${batch.importReason}`}
                </dd>
              </div>
            )}
            {batch.annulledAt && (
              <div>
                <dt className="text-slate-600">Anulado</dt>
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
 * Vista previa de un lote ya cargado (se pide solo tras cargar el lote: uno inexistente ya se
 * informa arriba, sin un segundo error).
 */
function ImportBatchWorkspace({
  batch,
  initialNotice,
}: {
  batch: ImportBatchSummaryRow;
  /** Aviso con el que se abre (p. ej. tras subir). */
  initialNotice: string | null;
}) {
  const { project } = useProject();
  const preview = useImportPreview(project.id, batch.id);

  return (
    <>
      {initialNotice && <Notice tone="success">{initialNotice}</Notice>}
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
      <ImportPreviewSection preview={preview} />
    </>
  );
}
