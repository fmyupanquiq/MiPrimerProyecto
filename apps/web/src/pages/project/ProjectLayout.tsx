import type { PermissionCode } from '@letfer/shared';
import { createPortal } from 'react-dom';
import { Link, Outlet, useParams } from 'react-router';
import { projectsApi } from '../../api/projects.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  BankIcon,
  ChartIcon,
  HomeIcon,
  LayersIcon,
  ReturnIcon,
  SettingsIcon,
  ShieldIcon,
  TicketIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from '../../icons.js';
import { roleLabel } from '../../labels.js';
import { Notice, ProjectStatusBadge, btnPrimary } from '../../ui.js';
import { SidebarLink } from '../AppShell.js';
import { useShellSlots } from '../shell-slots.js';
import type { ProjectContextValue } from './ProjectContext.js';
import { setDisplayTimeZone } from '../../time-zone.js';

/**
 * Diseño de un proyecto (§105.3): carga el proyecto con los permisos efectivos de la persona y
 * pinta su navegación en la barra lateral y su cabecera en la superior (Fase 10.3). Un proyecto
 * ajeno o inexistente se ve igual: "no encontrado".
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const slots = useShellSlots();
  const loaded = useLoad(`project:${projectId}`, () => projectsApi.get(projectId));

  if (loaded.loading && !loaded.data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p className="sr-only">Cargando proyecto…</p>
        <div className="h-24 animate-pulse rounded-xl bg-slate-200/70" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-200/70" />
      </div>
    );
  }
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
  // Fechas y horas de todo el proyecto en su zona horaria (§93, H-20). Se fija antes de pintar los
  // hijos; es idempotente, así que repetirlo en cada render no cambia nada.
  setDisplayTimeZone(project.timezone);
  const permissions = new Set<PermissionCode>(project.myPermissions);
  const can = (permission: PermissionCode) => permissions.has(permission);
  const context: ProjectContextValue = {
    project,
    setProject: loaded.setData,
    reload: loaded.reload,
    can,
  };
  const base = `/projects/${project.id}`;
  const role = project.isOwner
    ? `Propietario · ${roleLabel(project.myRole ?? '')}`
    : project.myRole
      ? roleLabel(project.myRole)
      : 'Administrador global';

  const sidebar = (
    <>
      <nav
        aria-label="Proyecto"
        className="flex flex-col gap-4 border-t border-sidebar-border px-3 pt-4"
      >
        <div className="flex flex-col gap-1">
          <SidebarLink to={base} end icon={<HomeIcon />}>
            Dashboard
          </SidebarLink>
        </div>

        {/* Agrupación lógica (Fase 11, §5): la actividad del día a día con las apuestas. */}
        <div className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-medium tracking-wide text-sidebar-muted uppercase">
            Apuestas
          </p>
          <SidebarLink to={`${base}/bets`} icon={<TicketIcon />}>
            Apuestas
          </SidebarLink>
          {can('bets.view') && (
            <SidebarLink to={`${base}/returns`} icon={<ReturnIcon />}>
              Retornos
            </SidebarLink>
          )}
          {can('bets.view') && (
            <SidebarLink to={`${base}/reports`} icon={<ChartIcon />}>
              Reportes
            </SidebarLink>
          )}
        </div>

        {/* El dinero del proyecto: casas, unidad de stake por etapa e historial importado. */}
        <div className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-medium tracking-wide text-sidebar-muted uppercase">
            Dinero
          </p>
          <SidebarLink to={`${base}/finance`} icon={<BankIcon />}>
            Casas y Finanzas
          </SidebarLink>
          <SidebarLink to={`${base}/stages`} icon={<LayersIcon />}>
            Etapas
          </SidebarLink>
          {can('imports.view') && (
            <SidebarLink to={`${base}/imports`} icon={<UploadIcon />}>
              Importaciones
            </SidebarLink>
          )}
        </div>

        {/* Administración del proyecto en sí: quién participa y su historial. */}
        <div className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-medium tracking-wide text-sidebar-muted uppercase">
            Proyecto
          </p>
          <SidebarLink to={`${base}/members`} icon={<UsersIcon />}>
            Miembros
          </SidebarLink>
          {(can('bets.restore') || can('stages.restore')) && (
            <SidebarLink to={`${base}/trash`} icon={<TrashIcon />}>
              Eliminados
            </SidebarLink>
          )}
          {can('audit.view') && (
            <SidebarLink to={`${base}/audit`} icon={<ShieldIcon />}>
              Auditoría
            </SidebarLink>
          )}
          <SidebarLink to={`${base}/settings`} icon={<SettingsIcon />}>
            Configuración
          </SidebarLink>
        </div>
      </nav>
      <div className="mt-auto border-t border-sidebar-border p-4">
        <p className="text-xs font-medium tracking-wide text-sidebar-muted uppercase">
          Proyecto actual
        </p>
        <Link
          to={base}
          className="mt-1 flex items-center gap-2 rounded-lg text-sm font-medium text-white hover:text-violet-200"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              project.status === 'ACTIVE' ? 'bg-green-400' : 'bg-amber-400'
            }`}
            aria-hidden="true"
          />
          <span className="truncate">{project.name}</span>
        </Link>
        <Link to="/" className="mt-2 block text-xs text-sidebar-muted hover:text-white">
          Cambiar de proyecto
        </Link>
      </div>
    </>
  );

  const topbar = (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="truncate text-lg font-semibold sm:text-xl">{project.name}</h1>
        <ProjectStatusBadge status={project.status} />
      </div>
      <p className="truncate text-xs text-slate-500">
        <span>Etapa: {project.activeStage ? project.activeStage.name : 'sin etapa activa'}</span>
        <span aria-hidden="true"> · </span>
        <span>Tu rol: {role}</span>
      </p>
    </div>
  );

  return (
    <>
      {slots.sidebar && createPortal(sidebar, slots.sidebar)}
      {slots.topbar && createPortal(topbar, slots.topbar)}

      {project.status === 'CLOSED' && (
        <Notice tone="info">
          Este proyecto está cerrado. Sus datos se conservan, pero no se pueden crear invitaciones
          hasta reabrirlo.
        </Notice>
      )}

      {!project.setupComplete && permissions.has('project.setup') && (
        <Notice
          tone="warning"
          action={
            <Link to={`${base}/setup`} className={btnPrimary}>
              Completar configuración
            </Link>
          }
        >
          Este proyecto todavía no tiene etapa, casas ni banca configuradas.
        </Notice>
      )}

      <Outlet context={context} />
    </>
  );
}
