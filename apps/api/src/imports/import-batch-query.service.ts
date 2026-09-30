import { ErrorCode, type ImportBatchSummaryRow, type ImportPreview } from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { importBatches } from '../database/schema/index.js';
import { findDuplicatesAgainstHistory } from './import-duplicate-history.js';
import { runImportAnalysisPipeline } from './parser/import-preview-pipeline.js';
import { resolveImportOriginAdapter } from './parser/import-origin-registry.js';

/**
 * Lecturas del lote (Fase 9.3.8, §113): listar, consultar el detalle, recalcular la vista previa
 * (nunca persiste nada, docs/PLAN_FASE_9_3.md §2) y servir el archivo original conservado
 * (§113.9). Ninguna de estas operaciones escribe: son la contraparte de solo lectura de los
 * servicios que sí modifican el lote (9.3.3 a 9.3.7).
 */

const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;

@Injectable()
export class ImportBatchQueryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(projectId: string): Promise<ImportBatchSummaryRow[]> {
    return this.db
      .select(BATCH_COLUMNS)
      .from(importBatches)
      .where(eq(importBatches.projectId, projectId))
      .orderBy(desc(importBatches.createdAt));
  }

  async get(projectId: string, batchId: string): Promise<ImportBatchSummaryRow> {
    const [batch] = await this.db
      .select(BATCH_COLUMNS)
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.projectId, projectId)))
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    return batch;
  }

  /**
   * Recalcula la vista previa completa desde el archivo conservado; nunca persiste nada. El
   * origen (Fase 9.3.9) se lee del propio lote, nunca del cliente: así `preview` siempre usa
   * exactamente el mismo adaptador con el que se subió, sin depender de que quien llama lo repita
   * bien en cada petición.
   */
  async preview(projectId: string, batchId: string, timeZone: string): Promise<ImportPreview> {
    const batch = await this.loadWithFile(projectId, batchId);
    const adapter = resolveImportOriginAdapter(batch.origin);
    const analysis = await runImportAnalysisPipeline({
      file: batch.sourceFile,
      adapter,
      fileMeta: {
        originalName: batch.originalName,
        sizeBytes: batch.sourceSizeBytes,
        sha256: batch.sourceSha256,
      },
      timeZone,
    });

    // D-X10: contra el histórico solo se puede comparar con la casa ya confirmada (9.3.4); sin
    // ella, `withinFile` (ya calculado, puro) es toda la señal de duplicados que hay todavía.
    if (batch.houseId === null) return analysis.preview;
    const againstHistory = await findDuplicatesAgainstHistory(this.db, {
      projectId,
      houseId: batch.houseId,
      timeZone,
      candidates: analysis.normalization.bets,
    });
    return { ...analysis.preview, duplicates: { ...analysis.preview.duplicates, againstHistory } };
  }

  async getFile(
    projectId: string,
    batchId: string,
  ): Promise<{ buffer: Buffer; originalName: string }> {
    const batch = await this.loadWithFile(projectId, batchId);
    return { buffer: batch.sourceFile, originalName: batch.originalName };
  }

  private async loadWithFile(projectId: string, batchId: string) {
    const [batch] = await this.db
      .select({ ...BATCH_COLUMNS, sourceFile: importBatches.sourceFile })
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.projectId, projectId)))
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    return batch;
  }
}
