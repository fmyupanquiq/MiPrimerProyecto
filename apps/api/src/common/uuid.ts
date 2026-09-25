import { ErrorCode } from '@letfer/shared';
import { AppError } from './app-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identificador mal formado responde igual que un recurso inexistente (sin filtrar información). */
export function uuidOrNotFound(value: string, message: string): string {
  if (!UUID.test(value)) throw new AppError(404, ErrorCode.NOT_FOUND, message);
  return value;
}
