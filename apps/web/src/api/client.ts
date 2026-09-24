import { ErrorCode, type ApiErrorBody } from '@letfer/shared';

/** Error devuelto por la API con su forma uniforme (`code` estable). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }

  get code(): ApiErrorBody['code'] {
    return this.body.code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).code === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}

/**
 * Llama a la API (`/api`, mismo origen: en desarrollo el proxy de Vite). La sesión viaja en
 * una cookie HttpOnly que el navegador envía solo; el código de la web nunca ve el token.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      isApiErrorBody(payload)
        ? payload
        : {
            statusCode: response.status,
            code: ErrorCode.INTERNAL_ERROR,
            message: 'La respuesta del servidor no es válida.',
          },
    );
  }
  return payload as T;
}

/**
 * Sube un archivo (`multipart/form-data`, §28): nunca se fija `Content-Type` a mano, el
 * navegador añade el límite (`boundary`) correcto al construirlo desde `FormData`.
 */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      isApiErrorBody(payload)
        ? payload
        : {
            statusCode: response.status,
            code: ErrorCode.INTERNAL_ERROR,
            message: 'La respuesta del servidor no es válida.',
          },
    );
  }
  return payload as T;
}

/** URL del archivo de un ticket (§42): siempre autenticada, nunca pública ni permanente. */
export function ticketFileUrl(projectId: string, ticketId: string): string {
  return `/api/projects/${projectId}/tickets/${ticketId}/file`;
}
