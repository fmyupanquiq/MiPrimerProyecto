import { ErrorCode } from '@letfer/shared';
import { AppError } from '../common/app-error.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';

/**
 * Las operaciones financieras (configurar, crear etapas/casas, registrar movimientos y
 * retiros) exigen un proyecto `ACTIVE`: un proyecto cerrado admite consulta y el retiro final
 * de cierre (§85), que la Fase 4 implementará; por ahora, mientras no haya liquidación de
 * apuestas, se mantiene fuera para no crear una vía de cambio de banca sin ese contexto.
 */
export function assertProjectActive(access: ProjectAccess): void {
  if (access.project.status !== 'ACTIVE') {
    throw new AppError(
      409,
      ErrorCode.INVALID_STATE,
      'Esta acción solo está disponible en un proyecto activo.',
    );
  }
}

/** Además de activo, exige que ya se haya completado la configuración inicial (D1). */
export function assertFinanceReady(access: ProjectAccess): void {
  assertProjectActive(access);
  if (access.project.setupCompletedAt === null) {
    throw new AppError(
      409,
      ErrorCode.INVALID_STATE,
      'Completa primero la configuración inicial del proyecto.',
    );
  }
}

export const financeNotFound = (message: string): AppError =>
  new AppError(404, ErrorCode.NOT_FOUND, message);

export const financeConflict = (message: string): AppError =>
  new AppError(409, ErrorCode.INVALID_STATE, message);

export const insufficientBalance = (): AppError =>
  new AppError(
    409,
    ErrorCode.INVALID_STATE,
    'El saldo disponible de la casa no alcanza para esta operación.',
  );
