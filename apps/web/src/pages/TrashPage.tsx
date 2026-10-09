import { useState } from 'react';
import { projectsApi } from '../api/projects.js';
import { describeApiError } from '../api/errors.js';
import { isReauthCancelled, useReauth } from '../auth/ReauthContext.js';
import { useLoad } from '../hooks/useLoad.js';
import { formatDate, PROJECT_STATUS_LABELS } from '../labels.js';
import { Badge, btnPrimary, LoadingBlock, Notice, PageHeader } from '../ui.js';

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
      {/* "Proyectos eliminados" (Fase 11, §35): distinto de "Eliminados" dentro de un proyecto
          (esa es la papelera de apuestas y etapas; esta es de proyectos completos). */}
      <PageHeader
        title="Proyectos eliminados"
        description="Se conservan al menos 90 días y se pueden restaurar."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {restored && <Notice tone="success">«{restored}» se restauró correctamente.</Notice>}
      {trash.error && <Notice tone="error">{trash.error}</Notice>}
      {trash.loading && !trash.data && <LoadingBlock lines={2} label="Cargando papelera…" />}
      {trash.data && trash.data.length === 0 && (
        <Notice tone="info">La papelera está vacía.</Notice>
      )}
      <ul className="flex flex-col gap-3">
        {trash.data?.map((project) => (
          <li
            key={project.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-surface p-4"
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
