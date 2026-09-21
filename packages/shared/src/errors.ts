/** Códigos de error estables de la API; el cliente decide su comportamiento por el código. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  FORBIDDEN: 'FORBIDDEN',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
  INVALID_TOKEN: 'INVALID_TOKEN',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Detalle de un campo inválido en un error de validación. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Forma uniforme de todo error devuelto por la API. */
export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  /** Segundos hasta poder reintentar (bloqueos y límites de tasa). */
  retryAfterSeconds?: number;
}
