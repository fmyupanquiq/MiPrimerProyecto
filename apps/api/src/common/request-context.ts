import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Datos de la petición en curso que la auditoría y la seguridad necesitan (§35). */
export interface RequestContextStore {
  requestId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

const MAX_USER_AGENT_LENGTH = 512;

export const RequestContext = {
  /** Ejecuta `fn` con un contexto propio; se propaga a través de `await`. */
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** Contexto de la petición actual, o `undefined` fuera de una petición (p. ej. un comando). */
  current(): RequestContextStore | undefined {
    return storage.getStore();
  },

  /** Completa el contexto actual (p. ej. el usuario autenticado). No hace nada sin contexto. */
  set(patch: Partial<RequestContextStore>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, patch);
  },
};

/**
 * Abre el contexto de cada petición. Se registra como middleware del módulo (no con
 * `app.use`) para ejecutarse DESPUÉS del analizador del cuerpo: si se abriera antes, el
 * contexto se perdería al continuar desde el evento `end` del flujo de la petición.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const userAgent = req.get('user-agent');
    const store: RequestContextStore = {
      requestId,
      ip: req.ip,
      userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : undefined,
    };
    res.setHeader('X-Request-Id', requestId);
    RequestContext.run(store, () => next());
  }
}
