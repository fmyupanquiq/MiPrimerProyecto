import { ErrorCode, type ValidationIssue } from '@letfer/shared';
import { ApiError } from './client.js';

/** Mensaje genérico de validación de la API: no aporta nada a la persona, se sustituye. */
const GENERIC_VALIDATION = 'Los datos enviados no son válidos.';

/** Nombre legible de los campos que más se validan (para "Revisa: Cuota — …"). */
const FIELD_LABELS: Record<string, string> = {
  stake: 'Stake',
  visibleTotalOdds: 'Cuota',
  visibleOdds: 'Cuota',
  houseId: 'Casa',
  stageId: 'Etapa',
  amount: 'Monto',
  officialAmount: 'Monto oficial',
  officialPotentialReturn: 'Retorno potencial',
  officialRealizedReturn: 'Retorno oficial',
  placedAt: 'Fecha de colocación',
  settledAt: 'Fecha de liquidación',
  unitStake: 'Unidad de stake',
  reason: 'Motivo',
  email: 'Correo',
  name: 'Nombre',
};

function issueText(issue: ValidationIssue): string {
  const field = issue.path.split('.').find((part) => part in FIELD_LABELS);
  return field ? `${FIELD_LABELS[field]}: ${issue.message}` : issue.message;
}

function validationIssues(error: ApiError): ValidationIssue[] {
  const details = error.body.details;
  if (!Array.isArray(details)) return [];
  return details.filter(
    (item): item is ValidationIssue =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ValidationIssue).message === 'string' &&
      typeof (item as ValidationIssue).path === 'string',
  );
}

/**
 * Mensaje para el usuario según el código de error de la API (sin revelar detalles internos).
 * Los mensajes de la API están redactados para la persona usuaria (`AppError`: "mensaje seguro
 * para el cliente"): cuando explican el motivo, se muestran en lugar de uno genérico.
 */
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
    case ErrorCode.VALIDATION_FAILED: {
      const issues = validationIssues(error);
      if (issues.length > 0) {
        return `Revisa los datos ingresados. ${issues.slice(0, 3).map(issueText).join(' · ')}`;
      }
      const message = error.message.trim();
      return message !== '' && message !== GENERIC_VALIDATION
        ? `Revisa los datos ingresados. ${message}`
        : 'Revisa los datos ingresados.';
    }
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
    case ErrorCode.UNAUTHENTICATED:
      return 'Tu sesión terminó. Vuelve a iniciar sesión para continuar.';
    case ErrorCode.PAYLOAD_TOO_LARGE:
      return 'El archivo o los datos enviados son demasiado grandes.';
    case ErrorCode.SERVICE_UNAVAILABLE:
      return 'El servidor no está disponible en este momento. Inténtalo de nuevo en unos minutos.';
    // Estos mensajes de la API ya están redactados para la persona usuaria y explican el motivo
    // (p. ej. "El saldo disponible de la casa no alcanza para esta apuesta.").
    case ErrorCode.INVALID_STATE:
    case ErrorCode.CONFLICT:
    case ErrorCode.CORRECTION_CONFLICT:
    case ErrorCode.OWNER_PROTECTED:
    case ErrorCode.LAST_GLOBAL_ADMIN:
    case ErrorCode.OWNS_PROJECTS:
      return error.message;
    default:
      return 'Ocurrió un error inesperado en el servidor. Inténtalo de nuevo; si continúa, avisa al administrador.';
  }
}
