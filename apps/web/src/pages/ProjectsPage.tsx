import {
  createProjectSchema,
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIMEZONE,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  type DateFormat,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { projectsApi } from '../api/projects.js';
import { describeApiError } from '../api/errors.js';
import { useAuth } from '../auth/AuthContext.js';
import { useLoad } from '../hooks/useLoad.js';
import { DATE_FORMAT_LABELS, roleLabel, timeZones } from '../labels.js';
import { FolderIcon, PlusIcon } from '../icons.js';
import {
  btn,
  btnPrimary,
  EmptyState,
  inputClass,
  LoadingBlock,
  Notice,
  ProjectStatusBadge,
} from '../ui.js';

/** "Mis proyectos": los proyectos en los que participa la persona y el alta de uno nuevo (§105.1). */
export function ProjectsPage() {
  const { can } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [all, setAll] = useState(false);
  const scope = all && can('projects.list_all') ? 'all' : 'mine';
  const projects = useLoad(`projects:${scope}`, () => projectsApi.list(scope));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight">Mis proyectos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Un proyecto agrupa una banca de apuestas: sus casas, sus etapas y todas sus apuestas.
            Puedes trabajar en varios y compartirlos con otras personas.
          </p>
        </div>
        {can('projects.create') && !showForm && (
          <button type="button" className={btnPrimary} onClick={() => setShowForm(true)}>
            <PlusIcon className="h-4 w-4" />
            Nuevo proyecto
          </button>
        )}
      </div>

      {showForm && <NewProjectForm onCancel={() => setShowForm(false)} />}

      {can('projects.list_all') && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          Ver todos los proyectos del sistema
        </label>
      )}

      {projects.error && <Notice tone="error">{projects.error}</Notice>}
      {projects.loading && !projects.data && <LoadingBlock lines={2} label="Cargando proyectos…" />}
      {projects.data && projects.data.length === 0 && (
        <div role="status">
          <EmptyState
            icon={<FolderIcon />}
            title="Todavía no participas en ningún proyecto."
            text={
              <>
                Crea uno nuevo o acepta una invitación. Después configurarás la unidad de stake, tus
                casas y la banca inicial, y ya podrás registrar apuestas.
              </>
            }
            action={
              can('projects.create') &&
              !showForm && (
                <button type="button" className={btnPrimary} onClick={() => setShowForm(true)}>
                  Crear mi primer proyecto
                </button>
              )
            }
          />
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {projects.data?.map((project) => (
          <li
            key={project.id}
            className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm transition-colors hover:border-violet-300"
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/projects/${project.id}`}
                className="text-lg font-semibold text-slate-900 hover:text-violet-700 hover:underline"
              >
                {project.name}
              </Link>
              <ProjectStatusBadge status={project.status} />
            </div>
            {project.description && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{project.description}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {project.isOwner ? 'Eres el propietario' : `Propietario: ${project.ownerName}`}
              {project.myRole && ` · Tu rol: ${roleLabel(project.myRole)}`}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function NewProjectForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = createProjectSchema.safeParse({ name, description, timezone, dateFormat });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      const project = await projectsApi.create(parsed.data);
      void navigate(`/projects/${project.id}`);
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3 rounded-2xl border border-violet-200 bg-surface p-5 shadow-sm"
      aria-label="Nuevo proyecto"
      noValidate
    >
      <h2 className="text-lg font-semibold">Nuevo proyecto</h2>
      <p className="text-sm text-slate-600">
        Serás el propietario y Administrador del proyecto. La etapa, la unidad, la banca y las casas
        se configuran después.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nombre
        <input
          value={name}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Descripción (opcional)
        <textarea
          value={description}
          maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => setDescription(event.target.value)}
          className={inputClass}
          rows={3}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Zona horaria
          <input
            list="time-zones"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className={inputClass}
          />
          <datalist id="time-zones">
            {timeZones().map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
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
      <p className="text-xs text-slate-500">Moneda: PEN (soles). No se puede cambiar.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Creando…' : 'Crear proyecto'}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className={btn}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
