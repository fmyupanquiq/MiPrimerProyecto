import { ErrorCode, type ImportBatchSummaryRow } from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { houses, importBatches } from '../database/schema/index.js';
import { ImportAuditService } from './import-audit.service.js';
import { validateImportStagePlan } from './import-stage-plan-validation.js';
import type { ImportStagePlan } from './import-types.js';

/**
 * Resolución humana de casa y plan de etapas (Fase 9.3.4, §113.2, §113.3, docs/PLAN_FASE_9_3.md
 * §3–§5, D-X7, D-X8). Aísla las dos decisiones que solo una persona puede tomar antes de importar,
 * sin todavía resolver nada de lo que depende de ellas: no crea etapas reales, no calcula
 * `stageKey` ni `stake` (eso es de la 9.3.5), no guarda ningún reconocimiento (9.3.6), no confirma
 * la importación ni llama a `ImportWriterService` (9.3.7), y no toca el ledger. Tampoco modifica
 * nunca las filas de staging (`import_rows`): son la fotografía inmutable del análisis (9.3.3).
 *
 * Ambas operaciones son transaccionales y bloquean el lote (`FOR UPDATE`, mismo patrón que
 * `ImportWriterService`) para serializarse frente a cualquier otra operación sobre el mismo lote.
 */

export interface ImportConfirmHouseInput {
  projectId: string;
  batchId: string;
  actorUserId: string;
  houseId: string;
}

export interface ImportSaveStagePlanInput {
  projectId: string;
  batchId: string;
  actorUserId: string;
  plan: ImportStagePlan;
}

const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;
type BatchRow = Omit<typeof importBatches.$inferSelect, 'sourceFile'>;

const invalidState = (message: string): AppError =>
  new AppError(409, ErrorCode.INVALID_STATE, message);

@Injectable()
export class ImportResolutionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: ImportAuditService,
  ) {}

  /**
   * Confirma o corrige la casa del lote (D-X8, docs/PLAN_FASE_9_3.md §5): `UPLOADED → VALIDATED`
   * la primera vez; mientras el lote sigue `VALIDATED`, puede repetirse para corregir una casa mal
   * elegida sin cambiar el estado. `IMPORTED` y `ANNULLED` la rechazan (la base de datos también lo
   * impide, `import_batches_guard`, migración 0033): en ese punto la casa ya es inmutable.
   */
  async confirmHouse(input: ImportConfirmHouseInput): Promise<ImportBatchSummaryRow> {
    return this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, input.projectId, input.batchId);
      if (batch.status === 'IMPORTED' || batch.status === 'ANNULLED') {
        throw invalidState('Este lote ya no admite confirmar ni corregir su casa.');
      }
      await this.assertHouseInProject(tx, input.projectId, input.houseId);

      const previousStatus = batch.status;
      const firstConfirmation = batch.status === 'UPLOADED';
      const now = this.clock.now();
      const [updated] = await tx
        .update(importBatches)
        .set({
          houseId: input.houseId,
          ...(firstConfirmation
            ? { status: 'VALIDATED' as const, validatedAt: now, validatedBy: input.actorUserId }
            : {}),
          version: nextVersion(importBatches.version),
        })
        .where(eq(importBatches.id, batch.id))
        .returning(BATCH_COLUMNS);
      await this.audit.validated(tx, updated!, input.actorUserId, { previousStatus });
      return updated!;
    });
  }

  /**
   * Guarda o revisa el plan de etapas propuesto (D-X7, docs/PLAN_FASE_9_3.md §5): todavía ninguna
   * etapa real, ningún `stageKey` ni `stake` (9.3.5). Se puede guardar mientras el lote está
   * `UPLOADED` o `VALIDATED` (igual que ya permiten los reconocimientos de D-X17b, migración 0038):
   * no depende de que la casa ya esté confirmada. Un plan estructuralmente inválido se rechaza sin
   * tocar el lote.
   */
  async saveStagePlan(input: ImportSaveStagePlanInput): Promise<ImportBatchSummaryRow> {
    const issues = validateImportStagePlan(input.plan);
    if (issues.length > 0) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El plan de etapas contiene datos no válidos.',
        { details: { issues } },
      );
    }
    return this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, input.projectId, input.batchId);
      if (batch.status === 'IMPORTED' || batch.status === 'ANNULLED') {
        throw invalidState('Este lote ya no admite cambiar su plan de etapas.');
      }
      const [updated] = await tx
        .update(importBatches)
        .set({
          stagePlan: serializeStagePlan(input.plan),
          version: nextVersion(importBatches.version),
        })
        .where(eq(importBatches.id, batch.id))
        .returning(BATCH_COLUMNS);
      return updated!;
    });
  }

  private async lockBatch(tx: DbExecutor, projectId: string, batchId: string): Promise<BatchRow> {
    const [batch] = await tx
      .select(BATCH_COLUMNS)
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.projectId, projectId)))
      .for('update')
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    return batch;
  }

  /** La casa existe en este proyecto (§113.2: "se asocia a una casa existente del proyecto"). */
  private async assertHouseInProject(
    tx: DbExecutor,
    projectId: string,
    houseId: string,
  ): Promise<void> {
    const [house] = await tx
      .select({ id: houses.id })
      .from(houses)
      .where(and(eq(houses.id, houseId), eq(houses.projectId, projectId)))
      .limit(1);
    if (!house) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'La casa no existe en este proyecto.');
    }
  }
}

/** Fechas a ISO 8601 para guardar el plan en `import_batches.stage_plan` (`jsonb`). */
function serializeStagePlan(plan: ImportStagePlan): Record<string, unknown> {
  return {
    stages: plan.stages.map((stage) => ({
      key: stage.key,
      name: stage.name,
      unitStake: stage.unitStake,
      startsAt: stage.startsAt ? stage.startsAt.toISOString() : null,
      status: stage.status,
      firstRow: stage.firstRow,
      lastRow: stage.lastRow,
    })),
  };
}
