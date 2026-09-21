import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ErrorCode, type ApiErrorBody } from '@letfer/shared';
import type { Response } from 'express';
import { ConcurrencyConflictError } from '../database/concurrency.js';
import { AppError } from './app-error.js';
import { RequestContext } from './request-context.js';

const STATUS_TO_CODE: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: ErrorCode.VALIDATION_FAILED, message: 'La solicitud no es válida.' },
  401: { code: ErrorCode.UNAUTHENTICATED, message: 'Se requiere iniciar sesión.' },
  403: { code: ErrorCode.FORBIDDEN, message: 'No tienes permiso para esta acción.' },
  404: { code: ErrorCode.NOT_FOUND, message: 'Recurso no encontrado.' },
  409: {
    code: ErrorCode.CONFLICT,
    message: 'La operación entra en conflicto con el estado actual.',
  },
  413: { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'La solicitud es demasiado grande.' },
  429: { code: ErrorCode.RATE_LIMITED, message: 'Demasiadas solicitudes; inténtalo más tarde.' },
  503: { code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Servicio no disponible.' },
};

const INTERNAL: ApiErrorBody = {
  statusCode: 500,
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Error interno del servidor.',
};

/** Errores de `body-parser` (Express): llevan `status` y `type`, pero no son HttpException. */
function fromBodyParserError(exception: unknown): ApiErrorBody | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const { type, status } = exception as { type?: unknown; status?: unknown };
  if (type === 'entity.too.large') return { ...STATUS_TO_CODE[413]!, statusCode: 413 };
  if (type === 'entity.parse.failed') {
    return { statusCode: 400, code: ErrorCode.VALIDATION_FAILED, message: 'Cuerpo JSON inválido.' };
  }
  return typeof status === 'number' && status >= 400 && status < 500 && STATUS_TO_CODE[status]
    ? { ...STATUS_TO_CODE[status], statusCode: status }
    : undefined;
}

/**
 * Convierte cualquier excepción en la forma uniforme `ApiErrorBody`. Nunca expone trazas ni
 * detalles internos: los errores inesperados devuelven un mensaje genérico y se registran
 * en el servidor con el identificador de la petición.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      const requestId = RequestContext.current()?.requestId;
      this.logger.error(
        `[${requestId ?? '-'}] ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      );
    }
    if (body.retryAfterSeconds !== undefined && !response.getHeader('Retry-After')) {
      response.setHeader('Retry-After', String(body.retryAfterSeconds));
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof AppError) {
      return exception.getResponse() as ApiErrorBody;
    }
    if (exception instanceof ConcurrencyConflictError) {
      return {
        statusCode: 409,
        code: ErrorCode.CONCURRENCY_CONFLICT,
        message: exception.message,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const known = STATUS_TO_CODE[status];
      if (known) return { statusCode: status, ...known };
      return status >= 500 ? INTERNAL : { statusCode: status, ...STATUS_TO_CODE[400]! };
    }
    return fromBodyParserError(exception) ?? INTERNAL;
  }
}
