import type { PermissionCode } from '@letfer/shared';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { projectsApi } from '../../api/projects.js';
import { useLoad } from '../../hooks/useLoad.js';
import { Notice, ProjectStatusBadge, btnPrimary } from '../../ui.js';
import type { ProjectContextValue } from './ProjectContext.js';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm ${
    isActive ? 'border-slate-900 font-medium' : 'border-transparent text-slate-600'
  }`;

/**
 * Diseño de un proyecto (§105.3): carga el proyecto con los permisos efectivos de la persona y
 * muestra su cabecera y navegación. Un proyecto ajeno o inexistente se ve igual: "no encontrado".
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const loaded = useLoad(`project:${projectId}`, () => projectsApi.get(projectId));

  if (loaded.loading && !loaded.data) return <p>Cargando proyecto…</p>;
  if (!loaded.data) {
    return (
      <>
        <Notice tone="error">
          {loaded.errorStatus === 404
            ? 'No se encontró el proyecto, o no tienes acceso a él.'
            : (loaded.error ?? 'No se pudo cargar el proyecto.')}
        </Notice>
        <p>
          <Link to="/" className="text-sm underline">
            ← Volver a mis proyectos
          </Link>
        </p>
      </>
    );
  }

  const project = loaded.data;
  const permissions = new Set<PermissionCode>(project.myPermissions);
  const context: ProjectContextValue = {
    project,
    setProject: loaded.setData,
    reload: loaded.reload,
    can: (permission) => permissions.has(permission),
  };

  return (
    <>
      <div>
        <Link to="/" className="text-sm text-slate-600 underline">
          ← Mis proyectos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
        </div>
        <p className="text-sm text-slate-500">
          Etapa: {project.activeStage ? project.activeStage.name : 'sin etapa activa'}
        </p>
      </div>

      {project.status === 'CLOSED' && (
        <Notice tone="info">
          Este proyecto está cerrado. Sus datos se conservan, pero no se pueden crear invitaciones
          hasta reabrirlo.
        </Notice>
      )}

      {!project.setupComplete && permissions.has('project.setup') && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Este proyecto todavía no tiene etapa, casas ni banca configuradas.
          </p>
          <Link to={`/projects/${project.id}/setup`} className={btnPrimary}>
            Completar configuración
          </Link>
        </div>
      )}

      <nav aria-label="Proyecto" className="flex flex-wrap gap-1 border-b border-slate-200">
        <NavLink to={`/projects/${project.id}`} end className={tabClass}>
          Resumen
        </NavLink>
        <NavLink to={`/projects/${project.id}/stages`} className={tabClass}>
          Etapas
        </NavLink>
        <NavLink to={`/projects/${project.id}/finance`} className={tabClass}>
          Casas y Finanzas
        </NavLink>
        <NavLink to={`/projects/${project.id}/members`} className={tabClass}>
          Miembros
        </NavLink>
        <NavLink to={`/projects/${project.id}/settings`} className={tabClass}>
          Configuración
        </NavLink>
      </nav>

      <Outlet context={context} />
    </>
  );
}
