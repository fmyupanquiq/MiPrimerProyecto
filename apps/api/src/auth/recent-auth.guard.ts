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

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_RECENT_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const { session } = requireAuthContext(context.switchToHttp().getRequest<Request>());
    const ageMs = this.clock.now().getTime() - session.reauthenticatedAt.getTime();
    if (ageMs > this.config.reauthWindowSeconds * 1000) {
      throw new AppError(
        403,
        ErrorCode.REAUTH_REQUIRED,
        'Confirma tu contraseña para continuar con esta acción.',
      );
    }
    return true;
  }
}
