import type { PermissionCode } from '@letfer/shared';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../../auth/AuthContext.js';

/** Con cualquiera de estos permisos globales se muestra la sección "Administración" (§111). */
export const ADMIN_SECTION_PERMISSIONS: readonly PermissionCode[] = [
  'system.integrity.run',
  'system.backups.view',
  'system.backups.create',
  'system.maintenance.run',
  'system.audit.view',
  'system.users.view',
  'system.account_deletions.decide',
  'projects.list_all',
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm ${
    isActive ? 'border-slate-900 font-medium' : 'border-transparent text-slate-600'
  }`;

/**
 * Marco de la administración de la instancia (§111): una pestaña por herramienta, visible solo
 * con su permiso global. La API valida cada permiso; esto solo evita mostrar enlaces inútiles.
 */
export function AdminLayout() {
  const { can } = useAuth();
  return (
    <>
      <h1 className="text-2xl font-semibold">Administración</h1>
      <nav aria-label="Administración" className="flex flex-wrap gap-1 border-b border-slate-200">
        <NavLink to="/admin" end className={tabClass}>
          Sistema
        </NavLink>
        {can('system.users.view') && (
          <NavLink to="/admin/users" className={tabClass}>
            Usuarios
          </NavLink>
        )}
        {can('system.account_deletions.decide') && (
          <NavLink to="/admin/deletions" className={tabClass}>
            Eliminación de cuentas
          </NavLink>
        )}
        {can('projects.list_all') && (
          <NavLink to="/admin/projects" className={tabClass}>
            Proyectos
          </NavLink>
        )}
        {can('system.audit.view') && (
          <NavLink to="/admin/audit" className={tabClass}>
            Auditoría
          </NavLink>
        )}
      </nav>
      <Outlet />
    </>
  );
}
