import { ErrorCode } from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { importBatches } from '../database/schema/index.js';
import { ImportAcknowledgmentService } from './import-acknowledgment.service.js';
import { ImportBetResolutionService } from './import-bet-resolution.service.js';
import type { ImportBatchWriteInput, NormalizedInitialCapital } from './import-types.js';
import type { ImportOriginAdapter } from './parser/import-normalization.js';
import { runImportAnalysisPipeline } from './parser/import-preview-pipeline.js';

/**
 * Preparación de la Fase 9.3.7 (§113.6, §113.9, ADR 0020, docs/PLAN_FASE_9_3.md §3): ensambla el
 * `ImportBatchWriteInput` completo que espera `ImportWriterService.importBatch()`, combinando la
 * vista previa vigente (capital), la casa y el plan ya confirmados (9.3.4), las apuestas resueltas
 * (9.3.5) y la disposición a confirmar (9.3.6, D-X17b). Deja definida la integración futura con el
 * escritor sin ejecutarla: **no llama a `ImportWriterService`**, no hay endpoint todavía, y no
 * implementa el backup check definitivo (§113.9) ni la reautenticación (D6) — eso es del resto de
 * la 9.3.7, cuando se conecte a una ruta HTTP real.
 */

export interface ImportAssembleWriteInputInput {
  projectId: string;
  batchId: string;
  actorUserId: string;
  /** Motivo de la confirmación (§113.6); lo pedirá el endpoint futuro, aquí ya es obligatorio. */
  reason: string;
  isRehearsal?: boolean;
  adapter: ImportOriginAdapter;
  timeZone: string;
}

const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;

@Injectable()
export class ImportConfirmationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly betResolution: ImportBetResolutionService,
    private readonly acknowledgment: ImportAcknowledgmentService,
  ) {}

  /**
   * Solo **prepara** datos: devuelve el `ImportBatchWriteInput` que un paso futuro pasaría a
   * `ImportWriterService.importBatch()`, pero no lo invoca — nada se escribe, nada se importa. La
   * comprobación de disposición a confirmar (9.3.6) ocurre primero, antes de calcular nada que
   * pudiera terminar escribiéndose: un lote bloqueado o sin reconocer nunca llega a construir
   * `stages`/`bets`/`initialCapital`.
   */
  async assembleWriteInput(input: ImportAssembleWriteInputInput): Promise<ImportBatchWriteInput> {
    if (!input.reason?.trim()) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El motivo de la importación es obligatorio.',
      );
    }

    const [batch] = await this.db
      .select({ ...BATCH_COLUMNS, sourceFile: importBatches.sourceFile })
      .from(importBatches)
      .where(and(eq(importBatches.id, input.batchId), eq(importBatches.projectId, input.projectId)))
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    if (batch.status !== 'VALIDATED') {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'El lote debe estar validado, con su casa confirmada, para preparar la confirmación.',
      );
    }

    // D-X17b (9.3.6): un lote bloqueado o sin reconocer no llega a ensamblarse.
    const readiness = await this.acknowledgment.canConfirmImport({
      projectId: input.projectId,
      batchId: input.batchId,
      adapter: input.adapter,
      timeZone: input.timeZone,
    });
    if (readiness.blocked) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'Este lote tiene filas inválidas: no se puede confirmar.',
        { details: { issues: readiness.blockingReasons } },
      );
    }
    if (readiness.needsAcknowledgment && !readiness.acknowledged) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'Este lote necesita un reconocimiento explícito antes de confirmarse.',
        { details: { issues: readiness.acknowledgmentReasons } },
      );
    }

    // stageKey/stake de cada apuesta (9.3.5); nunca se calculan aquí, solo se combinan.
    const { stages, bets } = await this.betResolution.resolveBatch({
      projectId: input.projectId,
      batchId: input.batchId,
    });

    // Capital inicial declarado por el propio archivo (§113.3), vigente ahora mismo (no se
    // persiste, docs/PLAN_FASE_9_3.md §2): mismo criterio que `GET /preview`.
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
    const { capital } = analysis.preview;
    const initialCapital: NormalizedInitialCapital | null =
      capital.detected && capital.amount && stages[0]
        ? {
            amount: capital.amount,
            occurredAt: new Date(capital.occurredAt!),
            occurredAtKnown: capital.occurredAtKnown,
            stageKey: stages[0].key,
          }
        : null;

    return {
      projectId: input.projectId,
      batchId: input.batchId,
      actorUserId: input.actorUserId,
      reason: input.reason.trim(),
      isRehearsal: input.isRehearsal,
      stages,
      initialCapital,
      bets,
    };
  }
}
