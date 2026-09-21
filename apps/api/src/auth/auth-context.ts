import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ErrorCode } from '@letfer/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import type { SessionRow, UserRow } from '../database/schema/index.js';

export const IS_PUBLIC_KEY = 'letfer:public';

/**
 * Marca un endpoint como público. Toda la API exige sesión por defecto (denegar por defecto,
 * §39): solo lo que lleva este decorador se puede llamar sin iniciar sesión.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Usuario y sesión autenticados de la petición en curso. */
export interface AuthContext {
  user: UserRow;
  session: SessionRow;
  /** Cómo llegó el token: cookie (web) o cabecera `Authorization: Bearer` (app móvil futura). */
  via: 'cookie' | 'bearer';
}

const contexts = new WeakMap<Request, AuthContext>();

export function setAuthContext(request: Request, context: AuthContext): void {
  contexts.set(request, context);
}

export function requireAuthContext(request: Request): AuthContext {
  const context = contexts.get(request);
  if (!context) {
    throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Se requiere iniciar sesión.');
  }
  return context;
}

/** Inyecta el contexto de autenticación completo (usuario y sesión). */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  requireAuthContext(context.switchToHttp().getRequest<Request>()),
);
