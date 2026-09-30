import { IMPORT_MAX_FILE_BYTES } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useUploadImportBatch } from '../../../hooks/useImportBatches.js';
import { btnPrimary, inputClass, Notice, Section } from '../../../ui.js';
import { useProject } from '../ProjectContext.js';
import {
  IMPORT_ORIGIN_OPTIONS,
  importBatchPath,
  type ImportBatchLocationState,
  ImportsGate,
  importsPath,
} from './ImportsCommon.js';

const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_MEGABYTES = IMPORT_MAX_FILE_BYTES / (1024 * 1024);

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Comprobación mínima antes de enviar, para no subir 10 MB en vano: extensión y tamaño (el mismo
 * límite que aplica la API, §113.9). Si el contenido es un `.xlsx` válido de ese origen lo decide
 * únicamente la API al subirlo.
 */
function checkFile(file: File | null): string | null {
  if (!file) return 'Elige un archivo .xlsx.';
  if (!file.name.toLowerCase().endsWith('.xlsx')) return 'El archivo debe ser un .xlsx.';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    return `El archivo supera el tamaño máximo de ${MAX_MEGABYTES} MB.`;
  }
  return null;
}

/** Subida de un archivo del historial (§113.9, `import.run`). */
export function ImportUploadPage() {
  return (
    <ImportsGate permission="import.run">
      <ImportUploadForm />
    </ImportsGate>
  );
}

function ImportUploadForm() {
  const { project } = useProject();
  const navigate = useNavigate();
  const { upload, loading, error: uploadError } = useUploadImportBatch(project.id);
  const [origin, setOrigin] = useState<string>(IMPORT_ORIGIN_OPTIONS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = checkFile(file);
    setFileError(problem);
    if (problem || !file) return;
    try {
      const batch = await upload(file, origin);
      const state: ImportBatchLocationState = { uploaded: true };
      void navigate(importBatchPath(project.id, batch.id), { state });
    } catch {
      // El hook ya dejó el mensaje en `uploadError`; la página no reintenta ni decide nada más.
    }
  }

  const error = fileError ?? uploadError;

  return (
    <>
      <p>
        <Link to={importsPath(project.id)} className="text-sm underline">
          ← Volver a importaciones
        </Link>
      </p>
      <Section title="Subir archivo">
        <p className="text-sm text-slate-600">
          Sube el archivo del historial exportado por la casa. Se conserva el original y se genera
          una vista previa; nada se registra en el ledger hasta confirmar el lote.
        </p>
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-4"
          aria-label="Subir archivo"
          noValidate
        >
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
            Origen
            <select
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              className={inputClass}
              disabled={loading}
            >
              {IMPORT_ORIGIN_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Archivo (.xlsx)
              <input
                type="file"
                accept={XLSX_ACCEPT}
                disabled={loading}
                aria-describedby="import-file-help"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setFileError(null);
                }}
              />
            </label>
            <span id="import-file-help" className="text-xs text-slate-500">
              Tamaño máximo: {MAX_MEGABYTES} MB.
            </span>
            {file && (
              <p className="text-sm text-slate-600">
                {file.name} · {formatSize(file.size)}
              </p>
            )}
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" disabled={loading} className={`${btnPrimary} self-start`}>
            {loading ? 'Subiendo…' : 'Subir archivo'}
          </button>
        </form>
      </Section>
    </>
  );
}
