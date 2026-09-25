import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@letfer/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { requireAuthContext } from './auth-context.js';

export const REQUIRE_RECENT_AUTH_KEY = 'letfer:require-recent-auth';

/**
 * Exige que la contraseña se haya confirmado hace poco (§39, §104.5: 5 minutos) para ejecutar
 * el endpoint. Si no, responde `REAUTH_REQUIRED` y el cliente pide la contraseña con
 * `POST /auth/reauth`. Las Fases 3 y 8 lo aplican a retiros, restauraciones y otras acciones
 * sensibles.
 */
export const RequireRecentAuth = () => SetMetadata(REQUIRE_RECENT_AUTH_KEY, true);

export const REQUIRE_RECENT_AUTH_WHEN_KEY = 'letfer:require-recent-auth-when';

/** Decide, a partir del cuerpo crudo de la petición, si esta llamada exige reautenticación. */
export type RecentAuthPredicate = (body: unknown) => boolean;

/**
 * Como `RequireRecentAuth`, pero solo cuando el cuerpo lo pide (p. ej. confirmar un retorno que
 * difiere del calculado, D-A12). El predicado solo puede **endurecer** la exigencia: se evalúa sobre
 * el cuerpo sin validar y un valor malformado que no cumpla el predicado igualmente falla después
 * en la validación del esquema, así que no abre ninguna vía para saltarse la reautenticación.
 */
export const RequireRecentAuthWhen = (predicate: RecentAuthPredicate) =>
  SetMetadata(REQUIRE_RECENT_AUTH_WHEN_KEY, predicate);

/**
 * Exige que la sesión haya confirmado la contraseña dentro de la ventana (§39, §104.5). Lo usan el
 * guard (rutas siempre sensibles) y los servicios cuya exigencia depende del estado del recurso,
 * p. ej. eliminar una apuesta liquidada (D-A11).
 */
export function assertRecentAuth(
  session: { reauthenticatedAt: Date },
  now: Date,
  windowSeconds: number,
): void {
  if (now.getTime() - session.reauthenticatedAt.getTime() > windowSeconds * 1000) {
    throw new AppError(
      403,
      ErrorCode.REAUTH_REQUIRED,
      'Confirma tu contraseña para continuar con esta acción.',
    );
  }
}

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<Request>();
    const always = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_RECENT_AUTH_KEY,
      targets,
    );
    const predicate = this.reflector.getAllAndOverride<RecentAuthPredicate | undefined>(
      REQUIRE_RECENT_AUTH_WHEN_KEY,
      targets,
    );
    if (!always && !(predicate && predicate((request.body as unknown) ?? null))) return true;

    const { session } = requireAuthContext(request);
    assertRecentAuth(session, this.clock.now(), this.config.reauthWindowSeconds);
    return true;
  }
}
