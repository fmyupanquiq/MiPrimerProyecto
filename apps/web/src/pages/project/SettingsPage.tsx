import {
  DATE_FORMATS,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  updateProjectSchema,
  type DateFormat,
  type ProjectDetail,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { describeApiError } from '../../api/errors.js';
import { membersApi, projectsApi } from '../../api/projects.js';
import { ApiError } from '../../api/client.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { DATE_FORMAT_LABELS, timeZones } from '../../labels.js';
import { btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../ui.js';
import { useProject } from './ProjectContext.js';

/** Configuración del proyecto (§105.6) y acciones sobre su ciclo de vida (§105.5). */
export function SettingsPage() {
  const { project, can, setProject, reload } = useProject();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice && <Notice tone="success">{notice}</Notice>}
      <Section title="Datos del proyecto">
        {can('project.update') ? (
          <EditForm
            key={project.version}
            project={project}
            onSaved={(updated) => {
              setProject(updated);
              setNotice('Los cambios se guardaron.');
            }}
            onReload={() => {
              setNotice(null);
              reload();
            }}
          />
        ) : (
          <ReadOnlyData project={project} />
        )}
      </Section>
      <LifecycleSection onNotice={setNotice} />
    </>
  );
}

function ReadOnlyData({ project }: { project: ProjectDetail }) {
  return (
    <>
      <Notice tone="info">No tienes permiso para modificar los datos del proyecto.</Notice>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Nombre</dt>
          <dd>{project.name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Zona horaria</dt>
          <dd>{project.timezone}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Formato de fecha</dt>
          <dd>{DATE_FORMAT_LABELS[project.dateFormat]}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Moneda</dt>
          <dd>{project.currency}</dd>
        </div>
      </dl>
    </>
  );
}

function EditForm({
  project,
  onSaved,
  onReload,
}: {
  project: ProjectDetail;
  onSaved: (project: ProjectDetail) => void;
  onReload: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [timezone, setTimezone] = useState(project.timezone);
  const [dateFormat, setDateFormat] = useState<DateFormat>(project.dateFormat);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = updateProjectSchema.safeParse({
      name,
      description,
      timezone,
      dateFormat,
      version: project.version,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSaving(true);
    try {
      onSaved(await projectsApi.update(project.id, parsed.data));
    } catch (caught) {
      setConflict(caught instanceof ApiError && caught.code === 'CONCURRENCY_CONFLICT');
      setError(describeApiError(caught));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Datos del proyecto"
      noValidate
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nombre
        <input
          value={name}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Descripción
        <textarea
          value={description}
          rows={3}
          maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => setDescription(event.target.value)}
          className={inputClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Zona horaria
          <input
            list="settings-time-zones"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className={inputClass}
          />
          <datalist id="settings-time-zones">
            {timeZones().map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Formato de fecha
          <select
            value={dateFormat}
            onChange={(event) => setDateFormat(event.target.value as DateFormat)}
            className={inputClass}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {DATE_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Moneda: {project.currency} (no se puede cambiar). Cambiar la zona horaria queda auditado.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {conflict && (
          <button type="button" onClick={onReload} className={btn}>
            Recargar datos
          </button>
        )}
      </div>
    </form>
  );
}

type Action = 'close' | 'reopen' | 'trash' | 'leave';

const ACTION_TEXT: Record<Action, { title: string; description: string; confirm: string }> = {
  close: {
    title: 'Cerrar proyecto',
    description:
      'Un proyecto cerrado se conserva y se puede consultar, pero no admite nuevas invitaciones.',
    confirm: '¿Cerrar el proyecto? Podrá reabrirlo su propietario.',
  },
  reopen: {
    title: 'Reabrir proyecto',
    description: 'Vuelve a dejar el proyecto activo.',
    confirm: '¿Reabrir el proyecto?',
  },
  trash: {
    title: 'Enviar a la papelera',
    description:
      'El proyecto deja de estar disponible para sus miembros. Se conserva al menos 90 días y se puede restaurar.',
    confirm: '¿Enviar el proyecto a la papelera?',
  },
  leave: {
    title: 'Salir del proyecto',
    description:
      'Dejarás de ver el proyecto. Para volver necesitarás una invitación nueva. El propietario no puede salir.',
    confirm: '¿Salir del proyecto?',
  },
};

function LifecycleSection({ onNotice }: { onNotice: (message: string | null) => void }) {
  const { project, can, setProject } = useProject();
  const navigate = useNavigate();
  const runWithReauth = useReauth();
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available: Action[] = [];
  if (project.status === 'ACTIVE' && can('project.close')) available.push('close');
  if (project.status === 'CLOSED' && can('project.reopen')) available.push('reopen');
  if (can('project.trash')) available.push('trash');
  if (!project.isOwner && project.myRole !== null) available.push('leave');
  if (available.length === 0) return null;

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    onNotice(null);
    try {
      if (action === 'close') {
        setProject(await runWithReauth(() => projectsApi.close(project.id)));
        onNotice('El proyecto se cerró.');
      } else if (action === 'reopen') {
        setProject(await runWithReauth(() => projectsApi.reopen(project.id)));
        onNotice('El proyecto se reabrió.');
      } else if (action === 'trash') {
        await runWithReauth(() => projectsApi.sendToTrash(project.id, reason.trim() || undefined));
        void navigate('/projects/trash');
        return;
      } else {
        await membersApi.leave(project.id);
        void navigate('/');
        return;
      }
      setPending(null);
    } catch (caught) {
      // Cancelar la confirmación de contraseña no es un error: la acción simplemente no se hizo.
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Estado del proyecto">
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="flex flex-col gap-3">
        {available.map((action) => (
          <li key={action} className="rounded border border-slate-200 p-3">
            <p className="font-medium">{ACTION_TEXT[action].title}</p>
            <p className="text-sm text-slate-600">{ACTION_TEXT[action].description}</p>
            {pending === action ? (
              <div className="mt-2 flex flex-col gap-2" role="group" aria-label="Confirmación">
                <p className="text-sm font-medium">{ACTION_TEXT[action].confirm}</p>
                {action === 'trash' && (
                  <label className="flex flex-col gap-1 text-sm">
                    Motivo (opcional)
                    <input
                      value={reason}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={action === 'trash' || action === 'leave' ? btnDanger : btnPrimary}
                    disabled={busy}
                    onClick={() => void run(action)}
                  >
                    {busy ? 'Procesando…' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={() => {
                      setPending(null);
                      setError(null);
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`${btn} mt-2`}
                onClick={() => {
                  setPending(action);
                  setError(null);
                }}
              >
                {ACTION_TEXT[action].title}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
