import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type PermissionCode } from '@letfer/shared';
import type { Request } from 'express';
import { requireAuthContext } from '../auth/auth-context.js';
import { AppError } from '../common/app-error.js';
import { AuthorizationService } from './authorization.service.js';
import {
  GLOBAL_PERMISSION_KEY,
  PROJECT_ROUTE_KEY,
  setProjectAccess,
  type ProjectRouteMetadata,
} from './decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const forbidden = () =>
  new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
const projectNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Proyecto no encontrado.');

/** Valida `@RequireGlobalPermission(...)`: permisos del rol global del usuario (§39). */
@Injectable()
export class GlobalPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode | undefined>(
      GLOBAL_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const auth = requireAuthContext(context.switchToHttp().getRequest<Request>());
    if (!auth.globalPermissions.has(required)) throw forbidden();
    return true;
  }
}

/**
 * Valida `@ProjectRoute(...)`: resuelve el acceso al proyecto de `:projectId` y comprueba el
 * permiso. Un proyecto inexistente, ajeno o en papelera responde siempre lo mismo (404), para no
 * revelar su existencia (§105.3).
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const route = this.reflector.getAllAndOverride<ProjectRouteMetadata | undefined>(
      PROJECT_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!route) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const auth = requireAuthContext(request);
    const projectId = request.params['projectId'];
    if (typeof projectId !== 'string' || !UUID.test(projectId)) throw projectNotFound();

    const access = await this.authorization.projectAccess(auth.user, projectId, {
      allowTrashed: route.allowTrashed,
    });
    if (!access) throw projectNotFound();
    if (!access.permissions.has(route.permission)) throw forbidden();

    setProjectAccess(request, access);
    return true;
  }
}
