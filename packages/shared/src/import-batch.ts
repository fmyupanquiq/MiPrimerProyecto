/**
 * Lotes de importación del historial (Fase 9, §113, ADR 0020). Un lote corresponde a un archivo de
 * origen de una casa; sus filas de staging no tocan el ledger hasta confirmarlo.
 */

/** Estados de un lote (§113.2). Un lote anulado conserva su archivo, su informe y sus filas. */
export const IMPORT_BATCH_STATUSES = ['UPLOADED', 'VALIDATED', 'IMPORTED', 'ANNULLED'] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/** Clasificación de cada fila del archivo (§113.6, D-X21, D-X21b). */
export const IMPORT_ROW_STATUSES = ['VALID', 'TEMPLATE', 'EMPTY', 'PARTIAL', 'INVALID'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/** Semáforo de la diferencia entre el archivo y LetFer (§113.7, D-X17). */
export const IMPORT_TRAFFIC_LIGHTS = ['GREEN', 'YELLOW', 'RED'] as const;
export type ImportTrafficLight = (typeof IMPORT_TRAFFIC_LIGHTS)[number];

/** Tamaño máximo del archivo original (§113.9): un archivo mayor se rechaza antes del staging. */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Acciones de auditoría de un lote (§113.9): una por lote y paso, nunca una por fila. El detalle por
 * fila vive en `import_rows`. La huella del archivo se registra con la clave `sha256`, no `hash`:
 * la redacción de la auditoría oculta cualquier clave que contenga `hash`.
 */
export const IMPORT_AUDIT_ACTIONS = {
  uploaded: 'import.batch_uploaded',
  validated: 'import.batch_validated',
  imported: 'import.batch_imported',
  annulled: 'import.batch_annulled',
} as const;
export type ImportAuditAction = (typeof IMPORT_AUDIT_ACTIONS)[keyof typeof IMPORT_AUDIT_ACTIONS];
