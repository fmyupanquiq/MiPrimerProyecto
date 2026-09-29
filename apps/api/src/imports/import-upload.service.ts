import { ErrorCode, IMPORT_MAX_FILE_BYTES } from '@letfer/shared';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { importBatches, importRows, type NewImportRow } from '../database/schema/index.js';
import { ImportAuditService } from './import-audit.service.js';
import type { ImportBatchSummaryRow, ImportRowNormalizedBet } from './import-types.js';
import type { ImportOriginAdapter } from './parser/import-normalization.js';
import type { ImportPreview } from './parser/import-preview.js';
import {
  runImportAnalysisPipeline,
  type ImportPipelineAnalysis,
} from './parser/import-preview-pipeline.js';
import { cellValueToJson, type RawRow } from './parser/sheet-model.js';

/**
 * Servicio de subida y persistencia de staging (Fase 9.3.3, §113, ADR 0020, docs/PLAN_FASE_9_3.md
 * §3). Convierte un archivo subido en un lote `UPLOADED` con su análisis ya guardado fila por fila
 * en `import_rows`, sin resolver todavía nada que solo una persona pueda resolver: ni casa
 * (`house_id` queda `NULL`, D-X8), ni plan de etapas, ni `stageKey`/`stake` (D-X7, D-X19), ni
 * reconocimientos (D-X17b). No llama a `ImportWriterService`: no escribe nada en el ledger.
 *
 * El análisis (`runImportAnalysisPipeline`, 9.3.2) se ejecuta **antes** de abrir cualquier
 * transacción: un archivo inválido (que no es un `.xlsx`, o al que le falta la hoja que su origen
 * espera) nunca debe dejar un lote a medias, porque un lote nunca se borra (D-X10). Solo si el
 * análisis termina sin lanzar nada se crea el lote y se persiste su staging, juntos, en una sola
 * transacción.
 *
 * El staging (`import_rows`) es una fotografía inmutable de ese análisis (docs/PLAN_FASE_9_3.md
 * §2): `raw_values` son los valores exactos de la fila (D-X12); `normalized` es la apuesta
 * preliminar completa (D-X7: sin `stageKey` ni `stake` todavía) junto con la comparación de tipo
 * (D-X24), solo en una fila `VALID`; `traffic_light` es el semáforo financiero **por apuesta**
 * (§113.7) de esa fila, `NULL` si la fila no es válida o el origen no tiene `financialContrast`
 * configurado.
 */

export interface ImportUploadInput {
  projectId: string;
  actorUserId: string;
  /** Nombre del archivo tal como lo subió la persona; de él sale la casa candidata (D-X8). */
  originalName: string;
  file: Buffer;
  /** Qué formato de origen es este archivo (hoy solo `BETSAFE_ADAPTER`); lo decide quien llama. */
  adapter: ImportOriginAdapter;
  timeZone: string;
}

export interface ImportUploadResult {
  batch: ImportBatchSummaryRow;
  preview: ImportPreview;
}

@Injectable()
export class ImportUploadService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: ImportAuditService,
  ) {}

  async upload(input: ImportUploadInput): Promise<ImportUploadResult> {
    if (input.file.length === 0 || input.file.length > IMPORT_MAX_FILE_BYTES) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        `El archivo debe pesar entre 1 byte y ${IMPORT_MAX_FILE_BYTES} bytes.`,
      );
    }
    const sha256 = createHash('sha256').update(input.file).digest('hex');

    // Puro, sin base de datos (9.3.2): si el archivo no es un .xlsx válido o le falta la hoja que
    // el origen espera, falla aquí, antes de tocar PostgreSQL.
    const analysis = await runImportAnalysisPipeline({
      file: input.file,
      adapter: input.adapter,
      fileMeta: { originalName: input.originalName, sizeBytes: input.file.length, sha256 },
      timeZone: input.timeZone,
    });

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(importBatches)
        .values({
          projectId: input.projectId,
          status: 'UPLOADED',
          // Fijado una sola vez (Fase 9.3.9): preview/acknowledge/confirm lo vuelven a leer de
          // aquí, nunca del cliente, para no depender de que repita el mismo origen siempre bien.
          origin: input.adapter.name,
          originalName: input.originalName,
          sourceSha256: sha256,
          sourceSizeBytes: input.file.length,
          sourceFile: input.file,
          createdBy: input.actorUserId,
          rowsTotal: analysis.preview.summary.totalRows,
          rowsValid: analysis.preview.summary.valid,
          rowsTemplate: analysis.preview.summary.template,
          rowsEmpty: analysis.preview.summary.empty,
          rowsPartial: analysis.preview.summary.partial,
          rowsInvalid: analysis.preview.summary.invalid,
        })
        .returning();
      const batch = created!;

      await this.persistStagingRows(tx, batch.id, analysis);
      await this.audit.uploaded(tx, batch, input.actorUserId);

      const { sourceFile: omittedSourceFile, ...batchWithoutFile } = batch;
      void omittedSourceFile;
      return { batch: batchWithoutFile, preview: analysis.preview };
    });
  }

  /** Una fila de `import_rows` por cada fila de la tabla del archivo, sin perder ninguna (D-X21). */
  private async persistStagingRows(
    tx: DbExecutor,
    batchId: string,
    analysis: ImportPipelineAnalysis,
  ): Promise<void> {
    const sheetRowByNumber = new Map(analysis.sheet.rows.map((row) => [row.rowNumber, row]));
    const betByRowNumber = new Map(
      analysis.normalization.bets.flatMap((bet) =>
        bet.rowNumber !== undefined ? [[bet.rowNumber, bet] as const] : [],
      ),
    );
    // Semáforo financiero por apuesta (§113.7); vacío si el origen no configuró `financialContrast`
    // (D-X17b es un semáforo distinto, ya reflejado en `status`/`findings`).
    const trafficLightByRowNumber = new Map(
      analysis.preview.financialContrast.bets.map((bet) => [bet.rowNumber, bet.semaphore]),
    );

    const values: NewImportRow[] = analysis.normalization.rows.map((row) => {
      const sheetRow = sheetRowByNumber.get(row.rowNumber);
      const bet = row.status === 'VALID' ? betByRowNumber.get(row.rowNumber) : undefined;
      const normalized: ImportRowNormalizedBet | null = bet
        ? {
            declaredType: row.declaredType,
            derivedType: row.derivedType,
            typeMismatch: row.typeMismatch,
            amount: bet.amount,
            visibleTotalOdds: bet.visibleTotalOdds,
            status: bet.status,
            placedAt: bet.placedAt.toISOString(),
            placedTimeKnown: bet.placedTimeKnown,
            settledAt: bet.settledAt ? bet.settledAt.toISOString() : null,
            settledTimeKnown: bet.settledTimeKnown,
            selections: bet.selections,
          }
        : null;
      return {
        importBatchId: batchId,
        rowNumber: row.rowNumber,
        rawValues: sheetRow ? rawValuesOf(sheetRow) : {},
        // `ImportRowNormalizedBet` es una interfaz cerrada; la columna es JSON genérico (§9.3.5 la
        // vuelve a tipar al leerla, con la misma forma exacta que se escribe aquí).
        normalized: normalized as unknown as Record<string, unknown> | null,
        status: row.status,
        trafficLight:
          row.status === 'VALID' ? (trafficLightByRowNumber.get(row.rowNumber) ?? null) : null,
        // `RowClassificationFinding` es una interfaz cerrada (sin índice); la columna es JSON genérico.
        findings: row.findings as unknown as Record<string, unknown>[],
      };
    });

    if (values.length > 0) await tx.insert(importRows).values(values);
  }
}

/** Los valores exactos de una fila, tal como el archivo los tiene (D-X12), listos para `jsonb`. */
function rawValuesOf(row: RawRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row.cells).map(([column, value]) => [column, cellValueToJson(value)]),
  );
}
