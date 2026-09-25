import type { MemberSummary, ProjectSummary } from '@letfer/shared';
import { useState } from 'react';
import { describeApiError } from '../../api/errors.js';
import { membersApi, projectsApi } from '../../api/projects.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { formatDate, roleLabel } from '../../labels.js';
import { btn, btnPrimary, inputClass, Notice, ProjectStatusBadge, Section } from '../../ui.js';

/**
 * Todos los proyectos del sistema (§5, §6, §87, §111.5): el Administrador Global consulta su
 * estado y transfiere su propiedad (también la de proyectos en la papelera, para poder liberar la
 * cuenta de quien los posee, D8-6). No hay eliminación definitiva: solo se ve la elegibilidad.
 */
export function AdminProjectsPage() {
  const { can } = useAuth();
  const allowed = can('projects.list_all');
  const projects = useLoad('admin-projects', async () => {
    if (!allowed) return [] as ProjectSummary[];
    const [active, trashed] = await Promise.all([projectsApi.list('all'), projectsApi.trash()]);
    return [...active, ...trashed];
  });
  const [transferring, setTransferring] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!allowed) return <Notice tone="info">No tienes permiso para ver todos los proyectos.</Notice>;

  return (
    <Section title="Proyectos del sistema">
      <p className="text-sm text-slate-600">
        La propiedad de un proyecto solo la transfiere el Administrador Global (§6). Mientras una
        persona sea propietaria de algún proyecto, su cuenta no se puede deshabilitar ni eliminar.
      </p>
      {notice && <Notice tone="success">{notice}</Notice>}
      {projects.error && <Notice tone="error">{projects.error}</Notice>}
      {projects.loading && !projects.data && <p>Cargando proyectos…</p>}
      {projects.data && projects.data.length === 0 && (
        <Notice tone="info">No hay proyectos.</Notice>
      )}
      <ul className="flex flex-col gap-3" aria-label="Proyectos">
        {projects.data?.map((project) => (
          <li
            key={project.id}
            className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {project.name} <ProjectStatusBadge status={project.status} />
                </p>
                <p className="text-xs text-slate-500">
                  Propietario: {project.ownerName} · Creado el {formatDate(project.createdAt)}
                  {project.status === 'TRASHED' &&
                    project.purgeEligibleAt &&
                    ` · Elegible para purga desde el ${formatDate(project.purgeEligibleAt)}`}
                </p>
              </div>
              {can('projects.transfer_ownership') && transferring !== project.id && (
                <button
                  type="button"
                  className={btn}
                  aria-label={`Transferir la propiedad de ${project.name}`}
                  onClick={() => setTransferring(project.id)}
                >
                  Transferir propiedad
                </button>
              )}
            </div>
            {transferring === project.id && (
              <TransferForm
                project={project}
                onDone={(name) => {
                  setTransferring(null);
                  setNotice(`La propiedad de «${project.name}» pasó a ${name}.`);
                  projects.reload();
                }}
                onCancel={() => setTransferring(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TransferForm({
  project,
  onDone,
  onCancel,
}: {
  project: ProjectSummary;
  onDone: (newOwnerName: string) => void;
  onCancel: () => void;
}) {
  const runWithReauth = useReauth();
  const members = useLoad(`transfer-members:${project.id}`, () =>
    membersApi.list(project.id, 'ACTIVE'),
  );
  const [newOwnerId, setNewOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = (members.data ?? []).filter((member: MemberSummary) => !member.isOwner);

  async function submit() {
    const chosen = candidates.find((member) => member.userId === newOwnerId);
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() => projectsApi.transferOwnership(project.id, chosen.userId));
      onDone(`${chosen.firstName} ${chosen.lastName}`);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Transferir propiedad de ${project.name}`}
      className="flex flex-col gap-3 rounded bg-slate-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {members.error && <Notice tone="error">{members.error}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {members.data && candidates.length === 0 && (
        <Notice tone="info">
          No hay otros miembros activos. Invita o reactiva a alguien antes de transferir la
          propiedad.
        </Notice>
      )}
      <label className="flex max-w-sm flex-col gap-1 text-sm">
        Nueva persona propietaria
        <select
          className={inputClass}
          value={newOwnerId}
          onChange={(event) => setNewOwnerId(event.target.value)}
        >
          <option value="">Elige un miembro…</option>
          {candidates.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.firstName} {member.lastName} ({roleLabel(member.roleKey, member.roleName)})
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-500">
        Pasará a ser Administrador de Proyecto; quien era propietario conserva su membresía de
        Administrador.
      </p>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy || !newOwnerId}>
          Confirmar transferencia
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
