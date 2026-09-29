import { ErrorCode } from '@letfer/shared';
import { AppError } from '../../common/app-error.js';
import { BETSAFE_ADAPTER } from './betsafe-adapter.js';
import type { ImportOriginAdapter } from './import-normalization.js';

/**
 * Catálogo de orígenes soportados (Fase 9.3.8, §113.2): el único punto donde el texto que envía
 * el cliente (`"Betsafe"`) se traduce al `ImportOriginAdapter` real. Nada se persiste todavía en
 * `import_batches` sobre qué origen se usó al subir un archivo — quien llama a cualquier ruta que
 * necesite releer el archivo (vista previa, reconocimiento, confirmación) debe volver a indicar el
 * mismo origen. Con un único adaptador registrado hoy (Betsafe) esto no puede equivocarse; si en el
 * futuro se registra un segundo origen (Betano), conviene revisar si `import_batches` necesita
 * guardar el origen usado al subir, para no depender de que el cliente lo repita siempre bien.
 */
export const IMPORT_ORIGIN_ADAPTERS: Readonly<Record<string, ImportOriginAdapter>> = {
  Betsafe: BETSAFE_ADAPTER,
};

export function resolveImportOriginAdapter(origin: string): ImportOriginAdapter {
  const adapter = IMPORT_ORIGIN_ADAPTERS[origin];
  if (!adapter) {
    throw new AppError(
      400,
      ErrorCode.VALIDATION_FAILED,
      `Origen de importación desconocido: "${origin}".`,
    );
  }
  return adapter;
}
