import { HttpException } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@letfer/shared';

interface AppErrorExtra {
  details?: unknown;
  retryAfterSeconds?: number;
}

/** Error de negocio o de protocolo con código estable y mensaje seguro para el cliente. */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    extra: AppErrorExtra = {},
  ) {
    const body: ApiErrorBody = { statusCode: status, code, message, ...extra };
    super(body, status);
  }
}
