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
    case ErrorCode.FORBIDDEN:
      return 'No tienes permiso para realizar esta acción.';
    case ErrorCode.NOT_FOUND:
      return 'No se encontró lo que buscas, o no tienes acceso.';
    case ErrorCode.CONCURRENCY_CONFLICT:
      return 'Otra persona modificó esto mientras lo editabas. Recarga la página e inténtalo de nuevo.';
    case ErrorCode.EMAIL_IN_USE:
      return 'Ese correo ya tiene una cuenta. Inicia sesión para continuar.';
    case ErrorCode.REAUTH_REQUIRED:
      return 'Confirma tu contraseña para continuar.';
    // Estos mensajes de la API ya están redactados para la persona usuaria.
    case ErrorCode.INVALID_STATE:
    case ErrorCode.OWNER_PROTECTED:
      return error.message;
    default:
      return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
}
