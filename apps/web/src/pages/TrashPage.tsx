import { useState } from 'react';
import { projectsApi } from '../api/projects.js';
import { describeApiError } from '../api/errors.js';
import { isReauthCancelled, useReauth } from '../auth/ReauthContext.js';
import { useLoad } from '../hooks/useLoad.js';
import { formatDate, PROJECT_STATUS_LABELS } from '../labels.js';
import { Badge, btnPrimary, Notice } from '../ui.js';

/**
 * Papelera de proyectos (§9, §105.5): los propios (o todos, para el Administrador Global). Un
 * proyecto queda restaurable al menos 90 días; restaurar exige confirmar la contraseña.
 */
export function TrashPage() {
  const trash = useLoad('projects:trash', () => projectsApi.trash());
  const runWithReauth = useReauth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  async function restore(id: string, name: string) {
    setBusyId(id);
    setError(null);
    setRestored(null);
    try {
      await runWithReauth(() => projectsApi.restore(id));
      setRestored(name);
      trash.reload();
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Papelera</h1>
      <p className="text-sm text-slate-600">
        Los proyectos enviados a la papelera se conservan al menos 90 días y se pueden restaurar.
        Pasado ese plazo quedan elegibles para purga, pero no se eliminan automáticamente.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {restored && <Notice tone="success">«{restored}» se restauró correctamente.</Notice>}
      {trash.error && <Notice tone="error">{trash.error}</Notice>}
      {trash.loading && !trash.data && <p>Cargando papelera…</p>}
      {trash.data && trash.data.length === 0 && (
        <Notice tone="info">La papelera está vacía.</Notice>
      )}
      <ul className="flex flex-col gap-3">
        {trash.data?.map((project) => (
          <li
            key={project.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4"
          >
            <div>
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {project.name}
                {project.purgeEligibleAt && new Date(project.purgeEligibleAt) <= new Date() && (
                  <Badge tone="amber">Elegible para purga</Badge>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {project.deletedAt && `Enviado a la papelera el ${formatDate(project.deletedAt)}`}
                {project.previousStatus &&
                  ` · Estado anterior: ${PROJECT_STATUS_LABELS[project.previousStatus]}`}
                {project.purgeEligibleAt &&
                  ` · Restaurable como mínimo hasta el ${formatDate(project.purgeEligibleAt)}`}
              </p>
            </div>
            <button
              type="button"
              className={btnPrimary}
              disabled={busyId === project.id}
              onClick={() => void restore(project.id, project.name)}
              aria-label={`Restaurar ${project.name}`}
            >
              {busyId === project.id ? 'Restaurando…' : 'Restaurar'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
