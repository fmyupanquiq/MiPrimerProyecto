import { Link } from 'react-router';
import { useImportBatches } from '../../../hooks/useImportBatches.js';
import { UploadIcon } from '../../../icons.js';
import { formatDateTime } from '../../../labels.js';
import { btnPrimary, EmptyState, LoadingBlock, Notice, PageHeader, Section } from '../../../ui.js';
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

/** Cómo funciona una importación, en el orden en que se hace (texto fijo, sin estado). */
const HOW_IT_WORKS = [
  { title: 'Sube el archivo', text: 'El historial exportado de la casa (.xlsx).' },
  { title: 'Revisa la vista previa', text: 'Filas válidas, avisos y diferencias de cifras.' },
  {
    title: 'Confirma casa y etapas',
    text: 'A qué casa pertenece y en qué etapa cae cada periodo.',
  },
  { title: 'Reconoce los avisos', text: 'Solo si el lote lo pide, con un motivo.' },
  { title: 'Confirma la importación', text: 'Recién aquí se registra en el ledger.' },
];

function ImportBatchList() {
  const { project, can } = useProject();
  const batches = useImportBatches(project.id);
  const upload = can('import.run') && (
    <Link to={importUploadPath(project.id)} className={btnPrimary}>
      <UploadIcon className="h-4 w-4" />
      Subir archivo
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Importaciones"
        description="Trae el historial de apuestas de una casa desde un archivo. Cada lote corresponde a un archivo del historial. Subirlo no cambia ningún saldo: solo se registra en el ledger al confirmarlo."
        actions={upload}
      />
      <Section title="Cómo funciona">
        <ol className="grid gap-3 sm:grid-cols-5">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-2 sm:flex-col">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-medium">{step.title}</span>
                <span className="block text-xs text-slate-500">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Lotes">
        {batches.error && <Notice tone="error">{batches.error}</Notice>}
        {batches.loading && !batches.data && <LoadingBlock lines={3} label="Cargando…" />}
        {batches.data && batches.data.length === 0 && (
          <EmptyState
            icon={<UploadIcon />}
            title="Todavía no se ha subido ningún archivo."
            text="Sube el historial de una casa para revisarlo antes de registrarlo."
            action={upload || undefined}
          />
        )}
        {batches.data && batches.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Lotes de importación">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Archivo</th>
                  <th className="py-2 pr-3 font-medium">Origen</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 font-medium">Filas</th>
                  <th className="py-2 font-medium">Subido</th>
                </tr>
              </thead>
              <tbody>
                {batches.data.map((batch) => (
                  <tr key={batch.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <Link
                        to={importBatchPath(project.id, batch.id)}
                        className="font-medium text-violet-700 underline hover:text-violet-900"
                      >
                        {batch.originalName}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{batch.origin}</td>
                    <td className="py-2 pr-3">
                      <ImportBatchStatusBadge status={batch.status} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{batch.rowsTotal}</td>
                    <td className="py-2 whitespace-nowrap">
                      {formatDateTime(toIso(batch.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
