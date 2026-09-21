import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ErrorCode, type PermissionCode } from '@letfer/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import type { ProjectAccess } from './authorization.service.js';

export const GLOBAL_PERMISSION_KEY = 'letfer:global-permission';
export const PROJECT_ROUTE_KEY = 'letfer:project-route';

/** Exige un permiso GLOBAL (p. ej. `projects.create`) del rol global del usuario. */
export const RequireGlobalPermission = (permission: PermissionCode) =>
  SetMetadata(GLOBAL_PERMISSION_KEY, permission);

export interface ProjectRouteMetadata {
  permission: PermissionCode;
  allowTrashed: boolean;
}

/**
 * Marca una ruta con `:projectId` que exige un permiso dentro del proyecto. Quien no tiene acceso
 * al proyecto recibe 404 (como si no existiera) y quien lo tiene pero le falta el permiso, 403.
 * Por defecto un proyecto en papelera responde 404; `allowTrashed` lo admite (solo a quienes pueden
 * restaurarlo).
 */
export const ProjectRoute = (
  permission: PermissionCode,
  options: { allowTrashed?: boolean } = {},
) =>
  SetMetadata(PROJECT_ROUTE_KEY, {
    permission,
    allowTrashed: options.allowTrashed ?? false,
  } satisfies ProjectRouteMetadata);

const accesses = new WeakMap<Request, ProjectAccess>();

export function setProjectAccess(request: Request, access: ProjectAccess): void {
  accesses.set(request, access);
}

/** Acceso al proyecto resuelto por `ProjectAccessGuard` para la petición en curso. */
export const CurrentProject = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const access = accesses.get(context.switchToHttp().getRequest<Request>());
  if (!access) {
    // Un desarrollador olvidó @ProjectRoute(): fallar cerrado.
    throw new AppError(404, ErrorCode.NOT_FOUND, 'Proyecto no encontrado.');
  }
  return access;
});
