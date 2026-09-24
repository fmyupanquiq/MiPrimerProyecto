import { ErrorCode } from '@letfer/shared';
import { AppError } from '../common/app-error.js';

export const betNotFound = (): AppError =>
  new AppError(404, ErrorCode.NOT_FOUND, 'Apuesta no encontrada.');

export const betConflict = (message: string): AppError =>
  new AppError(409, ErrorCode.INVALID_STATE, message);

export const betForbidden = (message: string): AppError =>
  new AppError(403, ErrorCode.FORBIDDEN, message);

export const betInsufficientBalance = (): AppError =>
  new AppError(
    409,
    ErrorCode.INVALID_STATE,
    'El saldo disponible de la casa no alcanza para esta apuesta.',
  );

export const invalidBetStructure = (message: string): AppError =>
  new AppError(400, ErrorCode.VALIDATION_FAILED, message);

/** Vincular un `ticketId` inexistente, de otro proyecto, o ya vinculado a otra apuesta (§110.3). */
export const ticketNotFound = (): AppError =>
  new AppError(404, ErrorCode.NOT_FOUND, 'Ticket no encontrado.');
