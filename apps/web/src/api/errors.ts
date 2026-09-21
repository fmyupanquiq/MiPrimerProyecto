import { ErrorCode } from '@letfer/shared';
import { ApiError } from './client.js';

/** Mensaje para el usuario según el código de error de la API (sin revelar detalles internos). */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
  }
  switch (error.code) {
    case ErrorCode.INVALID_CREDENTIALS:
      return 'Correo o contraseña incorrectos.';
    case ErrorCode.ACCOUNT_LOCKED: {
      const seconds = error.body.retryAfterSeconds ?? 0;
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return `Demasiados intentos fallidos. Inténtalo de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
    }
    case ErrorCode.RATE_LIMITED:
      return 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
    case ErrorCode.INVALID_TOKEN:
      return 'El enlace no es válido o ha caducado. Solicita uno nuevo.';
    case ErrorCode.VALIDATION_FAILED:
      return 'Revisa los datos ingresados.';
    default:
      return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
}
