import {
  ErrorCode,
  type BatchFinancialSemaphore,
  type ImportBatchSummaryRow,
  type ImportConfirmationReadiness,
} from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { importBatches } from '../database/schema/index.js';
import { findDuplicatesAgainstHistory } from './import-duplicate-history.js';
import { runImportAnalysisPipeline } from './parser/import-preview-pipeline.js';
import { resolveImportOriginAdapter } from './parser/import-origin-registry.js';

/**
 * Reconocimientos de D-X17b (Fase 9.3.6, §113.6, §113.7, ADR 0020): centraliza si un lote puede
 * confirmarse y guarda el reconocimiento explícito cuando hace falta. No crea ningún evento de
 * auditoría nuevo (quién y cuándo ya quedan en `acknowledged_by`/`acknowledged_at`, las mismas
 * columnas que audita la lectura de este servicio); no modifica `import_rows`; no altera nada de
 * lo que devuelve el parser, solo lo lee para conocer el semáforo financiero vigente.
 */

export interface ImportAcknowledgeInput {
  projectId: string;
  batchId: string;
  actorUserId: string;
  reason: string;
}

export interface ImportCanConfirmInput {
  projectId: string;
  batchId: string;
  timeZone: string;
}

const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;

const invalidState = (message: string): AppError =>
  new AppError(409, ErrorCode.INVALID_STATE, message);

@Injectable()
export class ImportAcknowledgmentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Guarda el reconocimiento (motivo, quién y cuándo). Permitido en `UPLOADED` o `VALIDATED`
   * (mismo criterio que el plan de etapas y la casa, migración 0038); `IMPORTED`/`ANNULLED` lo
   * rechazan: en ese punto el reconocimiento del lote ya es inmutable.
   */
  async acknowledge(input: ImportAcknowledgeInput): Promise<ImportBatchSummaryRow> {
    if (!input.reason?.trim()) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El motivo del reconocimiento es obligatorio.',
      );
    }
    return this.db.transaction(async (tx) => {
      const [batch] = await tx
        .select(BATCH_COLUMNS)
        .from(importBatches)
        .where(
          and(eq(importBatches.id, input.batchId), eq(importBatches.projectId, input.projectId)),
        )
        .for('update')
        .limit(1);
      if (!batch)
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
      if (batch.status === 'IMPORTED' || batch.status === 'ANNULLED') {
        throw invalidState('Este lote ya no admite reconocimientos.');
      }

      const [updated] = await tx
        .update(importBatches)
        .set({
          acknowledgedAt: this.clock.now(),
          acknowledgedBy: input.actorUserId,
          acknowledgmentReason: input.reason.trim(),
          version: nextVersion(importBatches.version),
        })
        .where(eq(importBatches.id, batch.id))
        .returning(BATCH_COLUMNS);
      return updated!;
    });
  }

  /**
   * Si el lote puede confirmarse ahora mismo: recalcula el semáforo financiero y los duplicados
   * por contenido (D-X10) contra el archivo original (§113.7, no se persiste — mismo criterio que
   * `GET /preview`, docs/PLAN_FASE_9_3.md §2) y lo combina con los contadores de fila ya guardados
   * (D-X17b) y el reconocimiento. El origen (Fase 9.3.9) se lee del propio lote, nunca del
   * cliente.
   */
  async canConfirmImport(input: ImportCanConfirmInput): Promise<ImportConfirmationReadiness> {
    const [batch] = await this.db
      .select({ ...BATCH_COLUMNS, sourceFile: importBatches.sourceFile })
      .from(importBatches)
      .where(and(eq(importBatches.id, input.batchId), eq(importBatches.projectId, input.projectId)))
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');

    const blockingReasons: string[] = [];
    if (batch.rowsInvalid > 0) {
      blockingReasons.push(
        `${batch.rowsInvalid} fila(s) inválida(s): columnas obligatorias ausentes, resultado ` +
          'desconocido, monto o cuota no válidos, o fecha inválida (§113.6).',
      );
    }

    const acknowledgmentReasons: string[] = [];
    if (batch.rowsPartial > 0) {
      acknowledgmentReasons.push(
        `${batch.rowsPartial} fila(s) parcial(es) requieren revisión (D-X21b).`,
      );
    }

    const adapter = resolveImportOriginAdapter(batch.origin);
    const analysis = await runImportAnalysisPipeline({
      file: batch.sourceFile,
      adapter,
      fileMeta: {
        originalName: batch.originalName,
        sizeBytes: batch.sourceSizeBytes,
        sha256: batch.sourceSha256,
      },
      timeZone: input.timeZone,
    });
    const financialSemaphore: BatchFinancialSemaphore =
      analysis.preview.financialContrast.semaphore;
    if (financialSemaphore === 'RED') {
      acknowledgmentReasons.push(
        'El contraste financiero contra el archivo de origen está en rojo (§113.7).',
      );
    }

    // D-X10: duplicados por contenido, dentro del archivo y contra el histórico ya importado de
    // la casa (si ya está confirmada). Nunca bloquea; exige el mismo reconocimiento que lo demás.
    const withinFileDuplicates = analysis.preview.duplicates.withinFile.length;
    if (withinFileDuplicates > 0) {
      acknowledgmentReasons.push(
        `${withinFileDuplicates} grupo(s) de filas con la misma fecha, monto, cuota y ` +
          'descripción dentro del propio archivo (D-X10).',
      );
    }
    if (batch.houseId !== null) {
      const againstHistory = await findDuplicatesAgainstHistory(this.db, {
        projectId: input.projectId,
        houseId: batch.houseId,
        timeZone: input.timeZone,
        candidates: analysis.normalization.bets,
      });
      if (againstHistory.length > 0) {
        acknowledgmentReasons.push(
          `${againstHistory.length} fila(s) coinciden en fecha, monto, cuota y descripción con ` +
            'apuestas ya importadas de esta casa (D-X10).',
        );
      }
    }

    const blocked = blockingReasons.length > 0;
    const needsAcknowledgment = acknowledgmentReasons.length > 0;
    const acknowledged = batch.acknowledgedAt !== null;

    return {
      blocked,
      blockingReasons,
      needsAcknowledgment,
      acknowledgmentReasons,
      acknowledged,
      financialSemaphore,
      canConfirm: !blocked && (!needsAcknowledgment || acknowledged),
    };
  }
}
