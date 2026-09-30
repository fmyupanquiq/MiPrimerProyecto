import { Link } from 'react-router';
import { useImportBatches } from '../../../hooks/useImportBatches.js';
import { formatDateTime } from '../../../labels.js';
import { btnPrimary, Notice, Section } from '../../../ui.js';
import { useProject } from '../ProjectContext.js';
import {
  ImportBatchStatusBadge,
  importBatchPath,
  ImportsGate,
  importUploadPath,
  toIso,
} from './ImportsCommon.js';

/** Lotes de importación del historial del proyecto (§113.9). */
export function ImportsPage() {
  return (
    <ImportsGate permission="imports.view">
      <ImportBatchList />
    </ImportsGate>
  );
}

function ImportBatchList() {
  const { project, can } = useProject();
  const batches = useImportBatches(project.id);

  return (
    <Section title="Importaciones">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Cada lote corresponde a un archivo del historial. Subirlo no cambia ningún saldo: solo se
          registra en el ledger al confirmarlo.
        </p>
        {can('import.run') && (
          <Link to={importUploadPath(project.id)} className={btnPrimary}>
            Subir archivo
          </Link>
        )}
      </div>
      {batches.error && <Notice tone="error">{batches.error}</Notice>}
      {batches.loading && !batches.data && <p>Cargando…</p>}
      {batches.data && batches.data.length === 0 && (
        <Notice tone="info">Todavía no se ha subido ningún archivo.</Notice>
      )}
      {batches.data && batches.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Lotes de importación">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-1 pr-3 font-medium">Archivo</th>
                <th className="py-1 pr-3 font-medium">Origen</th>
                <th className="py-1 pr-3 font-medium">Estado</th>
                <th className="py-1 pr-3 font-medium">Filas</th>
                <th className="py-1 font-medium">Subido</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.map((batch) => (
                <tr key={batch.id} className="border-b border-slate-100">
                  <td className="py-1 pr-3">
                    <Link to={importBatchPath(project.id, batch.id)} className="underline">
                      {batch.originalName}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">{batch.origin}</td>
                  <td className="py-1 pr-3">
                    <ImportBatchStatusBadge status={batch.status} />
                  </td>
                  <td className="py-1 pr-3">{batch.rowsTotal}</td>
                  <td className="py-1">{formatDateTime(toIso(batch.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
