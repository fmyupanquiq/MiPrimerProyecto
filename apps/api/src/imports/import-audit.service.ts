import { IMPORT_AUDIT_ACTIONS, type ImportAuditAction } from '@letfer/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { DbExecutor } from '../database/database.types.js';
import type { ImportBatchRow } from '../database/schema/index.js';

/** Los campos del lote que la auditoría necesita (sin el archivo, que puede pesar 10 MB). */
export type ImportBatchAuditSubject = Pick<
  ImportBatchRow,
  | 'id'
  | 'projectId'
  | 'houseId'
  | 'status'
  | 'originalName'
  | 'sourceSha256'
  | 'sourceSizeBytes'
  | 'isRehearsal'
  | 'rowsTotal'
  | 'rowsValid'
  | 'rowsTemplate'
  | 'rowsEmpty'
  | 'rowsPartial'
  | 'rowsInvalid'
>;

/**
 * Auditoría de los lotes de importación (Fase 9.1.3, §113.9, ADR 0020): un evento por lote y paso
 * (`import.batch_uploaded`, `_validated`, `_imported` y `_annulled`), **nunca uno por fila**.
 *
 * Cada evento lleva el actor, el proyecto, el lote (`entityId` y `metadata.batchId`), la huella
 * completa del archivo (`metadata.sha256`: la clave no contiene `hash`, así que la redacción de
 * la auditoría no la oculta), la casa si ya se conoce y los contadores de filas. Se escribe con la
 * transacción de la operación auditada (§57): si la auditoría falla, la operación se revierte.
 *
 * Esta clase solo registra; quien sube, valida, importa o anula un lote es el servicio de
 * importación, que comprueba permisos antes de llegar aquí (una operación rechazada no audita).
 */
@Injectable()
export class ImportAuditService {
  constructor(private readonly audit: AuditService) {}

  uploaded(executor: DbExecutor, batch: ImportBatchAuditSubject, actorUserId: string) {
    return this.record(executor, IMPORT_AUDIT_ACTIONS.uploaded, batch, actorUserId, {
      newValues: { status: batch.status },
    });
  }

  validated(executor: DbExecutor, batch: ImportBatchAuditSubject, actorUserId: string) {
    return this.record(executor, IMPORT_AUDIT_ACTIONS.validated, batch, actorUserId, {
      oldValues: { status: 'UPLOADED' },
      newValues: { status: batch.status },
    });
  }

  imported(
    executor: DbExecutor,
    batch: ImportBatchAuditSubject,
    actorUserId: string,
    details: { reason: string },
  ) {
    return this.record(executor, IMPORT_AUDIT_ACTIONS.imported, batch, actorUserId, {
      oldValues: { status: 'VALIDATED' },
      newValues: { status: batch.status },
      extra: { reason: details.reason, rehearsal: batch.isRehearsal },
    });
  }

  annulled(
    executor: DbExecutor,
    batch: ImportBatchAuditSubject,
    actorUserId: string,
    details: { reason: string },
  ) {
    return this.record(executor, IMPORT_AUDIT_ACTIONS.annulled, batch, actorUserId, {
      oldValues: { status: 'IMPORTED' },
      newValues: { status: batch.status },
      extra: { reason: details.reason },
    });
  }

  private record(
    executor: DbExecutor,
    action: ImportAuditAction,
    batch: ImportBatchAuditSubject,
    actorUserId: string,
    values: {
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    return this.audit.record(executor, {
      action,
      entityType: 'import_batch',
      entityId: batch.id,
      actorUserId,
      projectId: batch.projectId,
      oldValues: values.oldValues ?? null,
      newValues: values.newValues ?? null,
      metadata: {
        batchId: batch.id,
        houseId: batch.houseId,
        originalName: batch.originalName,
        sha256: batch.sourceSha256,
        sizeBytes: batch.sourceSizeBytes,
        rows: {
          total: batch.rowsTotal,
          valid: batch.rowsValid,
          template: batch.rowsTemplate,
          empty: batch.rowsEmpty,
          partial: batch.rowsPartial,
          invalid: batch.rowsInvalid,
        },
        ...values.extra,
      },
    });
  }
}
