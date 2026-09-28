import { ErrorCode } from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { importBatches } from '../database/schema/index.js';
import type { ImportBatchSummaryRow } from './import-types.js';
import type { BatchFinancialSemaphore } from './parser/excel-financial-contrast.js';
import type { ImportOriginAdapter } from './parser/import-normalization.js';
import { runImportAnalysisPipeline } from './parser/import-preview-pipeline.js';

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
  /** Con qué origen leer el archivo para recalcular el semáforo financiero (§113.7). */
  adapter: ImportOriginAdapter;
  timeZone: string;
}

export interface ImportConfirmationReadiness {
  /** D-X17b: filas `INVALID`. Bloquea sin excepción — ningún reconocimiento lo levanta (§113.6). */
  blocked: boolean;
  blockingReasons: string[];
  /**
   * Exige un reconocimiento explícito antes de confirmar (§113.7): filas `PARTIAL` (D-X17b) o
   * semáforo financiero `RED`. El amarillo **no** lo exige — "amarillo solo informa" (§113.7); se
   * expone igualmente en `financialSemaphore` para que quien confirme lo vea, pero no bloquea.
   */
  needsAcknowledgment: boolean;
  acknowledgmentReasons: string[];
  /** El lote ya tiene un reconocimiento guardado (`acknowledged_at` no nulo). */
  acknowledged: boolean;
  financialSemaphore: BatchFinancialSemaphore;
  /** `true` solo si no está bloqueado y, si hacía falta reconocimiento, ya se dio. */
  canConfirm: boolean;
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
   * Si el lote puede confirmarse ahora mismo: recalcula el semáforo financiero contra el archivo
   * original (§113.7, no se persiste — mismo criterio que `GET /preview`, docs/PLAN_FASE_9_3.md
   * §2) y lo combina con los contadores de fila ya guardados (D-X17b) y el reconocimiento.
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

    let financialSemaphore: BatchFinancialSemaphore = 'GREEN';
    if (input.adapter.financialContrast) {
      const analysis = await runImportAnalysisPipeline({
        file: batch.sourceFile,
        adapter: input.adapter,
        fileMeta: {
          originalName: batch.originalName,
          sizeBytes: batch.sourceSizeBytes,
          sha256: batch.sourceSha256,
        },
        timeZone: input.timeZone,
      });
      financialSemaphore = analysis.preview.financialContrast.semaphore;
    }
    if (financialSemaphore === 'RED') {
      acknowledgmentReasons.push(
        'El contraste financiero contra el archivo de origen está en rojo (§113.7).',
      );
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
