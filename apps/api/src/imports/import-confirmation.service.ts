import { ErrorCode } from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { BackupsService } from '../backups/backups.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { importBatches } from '../database/schema/index.js';
import { ImportAcknowledgmentService } from './import-acknowledgment.service.js';
import { ImportBetResolutionService } from './import-bet-resolution.service.js';
import { ImportWriterService } from './import-writer.service.js';
import type {
  ImportBatchAnnulInput,
  ImportBatchAnnulResult,
  ImportBatchWriteInput,
  ImportBatchWriteResult,
  NormalizedInitialCapital,
} from './import-types.js';
import { runImportAnalysisPipeline } from './parser/import-preview-pipeline.js';
import { resolveImportOriginAdapter } from './parser/import-origin-registry.js';

/**
 * Cierre de la Fase 9.3.7 (§113.6, §113.8, §113.9, ADR 0020, docs/PLAN_FASE_9_3.md §3): conecta
 * la preparación (ensamblar `ImportBatchWriteInput`) con la ejecución real, reutilizando
 * `ImportWriterService` sin duplicar ninguna de sus comprobaciones (validación de la línea de
 * tiempo, disponible, invariante financiera, guardas de lote anulado — todas siguen viviendo
 * solo en el escritor, 9.1.5). Este servicio nunca escribe `bets`, `financial_movements` ni
 * `stages` directamente: el único punto de escritura sigue siendo `ImportWriterService`.
 *
 * **Reautenticación (D6):** deliberadamente **no** se comprueba aquí — el patrón ya establecido
 * en el resto de la aplicación (p. ej. `WithdrawalsController.approve`, §79) es que una exigencia
 * de reauth *incondicional* para una ruta vive en el controlador (`@RequireRecentAuth()`), no en
 * el servicio de negocio; `confirmBatch`/`annulBatch` asumen que quien los llama (la 9.3.8) ya lo
 * garantizó, igual que `ImportWriterService` ya documenta para sus propios métodos.
 */

export interface ImportAssembleWriteInputInput {
  projectId: string;
  batchId: string;
  actorUserId: string;
  /** Motivo de la confirmación (§113.6); lo pedirá el endpoint futuro, aquí ya es obligatorio. */
  reason: string;
  isRehearsal?: boolean;
  timeZone: string;
}

/** Horas dentro de las que un backup `COMPLETED` cuenta como "reciente" (D-X26, §113.9). */
const BACKUP_FRESHNESS_HOURS = 24;

const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;

@Injectable()
export class ImportConfirmationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly betResolution: ImportBetResolutionService,
    private readonly acknowledgment: ImportAcknowledgmentService,
    private readonly writer: ImportWriterService,
    private readonly backups: BackupsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Solo **prepara** datos: devuelve el `ImportBatchWriteInput` que `confirmBatch` (abajo) pasaría
   * a `ImportWriterService.importBatch()`, sin invocarlo — nada se escribe, nada se importa. La
   * comprobación de disposición a confirmar (9.3.6) ocurre primero, antes de calcular nada que
   * pudiera terminar escribiéndose: un lote bloqueado o sin reconocer nunca llega a construir
   * `stages`/`bets`/`initialCapital`. Sigue siendo útil por separado (p. ej. para mostrar una
   * vista previa de lo que se importaría, sin confirmar todavía).
   */
  async assembleWriteInput(input: ImportAssembleWriteInputInput): Promise<ImportBatchWriteInput> {
    if (!input.reason?.trim()) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El motivo de la importación es obligatorio.',
      );
    }

    const batch = await this.loadBatchWithFile(input.projectId, input.batchId);
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
    // persiste, docs/PLAN_FASE_9_3.md §2): mismo criterio que `GET /preview`. El origen (Fase
    // 9.3.9) se lee del propio lote, nunca del cliente.
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

  /**
   * Confirma de verdad: comprueba el backup reciente (D-X26, salvo ensayo declarado), ensambla el
   * `ImportBatchWriteInput` (con todas sus propias comprobaciones) y se lo pasa a
   * `ImportWriterService.importBatch()`, que ya corre en su propia transacción (§113.6: "una sola
   * transacción bajo el bloqueo financiero del proyecto") — este método no abre ninguna otra
   * transacción alrededor: envolver la del escritor en una segunda no añadía nada, solo anidaría
   * sin necesidad. La auditoría del evento `import.batch_imported` ya la registra el escritor
   * dentro de esa misma transacción (9.1.3): no se duplica aquí.
   */
  async confirmBatch(input: ImportAssembleWriteInputInput): Promise<ImportBatchWriteResult> {
    await this.assertRecentBackup(input.isRehearsal ?? false);
    const writeInput = await this.assembleWriteInput(input);
    return this.writer.importBatch(writeInput);
  }

  /**
   * Anula un lote ya importado: pasa directamente a `ImportWriterService.annulBatch()`, que ya
   * valida el estado (`IMPORTED`, D-X25), exige el motivo, revierte el ledger con reversiones
   * (histórico conservado, nunca se borra nada), respeta las guardas de lote anulado
   * (`import-batch-guards.ts`) y registra `import.batch_annulled` en su propia transacción. Esta
   * capa no repite ninguna de esas comprobaciones (no duplicar lógica del escritor): solo existe
   * para que la 9.3.8 tenga, junto a `confirmBatch`, una única puerta de entrada al dominio de
   * importación sin conocer `ImportWriterService` directamente.
   */
  async annulBatch(input: ImportBatchAnnulInput): Promise<ImportBatchAnnulResult> {
    return this.writer.annulBatch(input);
  }

  /**
   * D-X26 (§113.9): confirmar una importación real exige un backup `COMPLETED` de las últimas 24
   * horas; un ensayo declarado como tal (con su motivo, ya exigido por `assembleWriteInput`) queda
   * exento — la excepción es **únicamente** para un lote marcado como ensayo, nunca automática.
   * La decisión queda registrada: `isRehearsal` se guarda en el lote y se audita al confirmar
   * (`ImportAuditService.imported`, ya existente, sin cambios).
   */
  private async assertRecentBackup(isRehearsal: boolean): Promise<void> {
    if (isRehearsal) return;
    const recent = await this.backups.hasRecentCompletedBackup(
      this.clock.now(),
      BACKUP_FRESHNESS_HOURS,
    );
    if (!recent) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        `Confirmar una importación real exige un backup completado en las últimas ` +
          `${BACKUP_FRESHNESS_HOURS} horas (D-X26). Declara esta importación como ensayo, con ` +
          'su motivo, si no corresponde a datos reales.',
      );
    }
  }

  private async loadBatchWithFile(projectId: string, batchId: string) {
    const [batch] = await this.db
      .select({ ...BATCH_COLUMNS, sourceFile: importBatches.sourceFile })
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.projectId, projectId)))
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    return batch;
  }
}
