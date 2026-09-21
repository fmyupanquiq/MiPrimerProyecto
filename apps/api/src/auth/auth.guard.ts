import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@letfer/shared';
import type { Request } from 'express';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { RequestContext } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { SessionService } from '../sessions/session.service.js';
import { IS_PUBLIC_KEY, setAuthContext } from './auth-context.js';
import { extractSessionToken } from './session-cookie.js';

const unauthenticated = () =>
  new AppError(401, ErrorCode.UNAUTHENTICATED, 'Se requiere iniciar sesión.');

/**
 * Guard global de autenticación (§39): toda ruta exige una sesión válida salvo las marcadas con
 * `@Public()`. Valida el token, renueva la inactividad y deja usuario y sesión disponibles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly authorization: AuthorizationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const extracted = extractSessionToken(request, this.config.cookieSecure);
    if (!extracted) throw unauthenticated();

    const valid = await this.sessions.validate(extracted.token);
    if (!valid) throw unauthenticated();

    const session = await this.sessions.touch(valid.session);
    const { roleKey, permissions } = await this.authorization.globalAccess(valid.user);
    setAuthContext(request, {
      user: valid.user,
      session,
      via: extracted.via,
      globalRoleKey: roleKey,
      globalPermissions: permissions,
    });
    RequestContext.set({ userId: valid.user.id, sessionId: session.id });
    return true;
  }
}
