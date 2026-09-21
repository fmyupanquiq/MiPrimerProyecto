import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@letfer/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Protección CSRF para las peticiones que modifican datos y viajan con cookie (§39, §41).
 * La cookie es `SameSite=Lax`; además se exige que el `Origin` sea el de la web configurada
 * o, si el navegador no lo envía, que `Sec-Fetch-Site` indique el mismo origen. Las peticiones
 * con `Authorization: Bearer` no usan cookies, por lo que no son vulnerables y se omiten.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!STATE_CHANGING_METHODS.has(request.method)) return true;
    if (request.headers.authorization) return true;

    const origin = request.headers.origin;
    const allowed =
      origin !== undefined
        ? origin === this.config.appOrigin
        : this.isSameSiteFetch(request.headers['sec-fetch-site']);
    if (!allowed) {
      throw new AppError(403, ErrorCode.ORIGIN_NOT_ALLOWED, 'Origen de la solicitud no permitido.');
    }
    return true;
  }

  /** Sin cabecera `Sec-Fetch-Site` (cliente que no es un navegador) se permite. */
  private isSameSiteFetch(header: string | string[] | undefined): boolean {
    if (header === undefined) return true;
    return header === 'same-origin' || header === 'none';
  }
}
