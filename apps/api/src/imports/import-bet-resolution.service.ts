import { ErrorCode } from '@letfer/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { importBatches, importRows } from '../database/schema/index.js';
import { resolveImportBets, type ImportStagingRow } from './import-bet-resolution.js';
import { validateImportStagePlan } from './import-stage-plan-validation.js';
import type {
  ImportRowNormalizedBet,
  ImportStagePlan,
  NormalizedImportBet,
  NormalizedImportStage,
} from './import-types.js';

/**
 * Envoltorio de base de datos del resolutor puro (Fase 9.3.5, §113.3, D-X7, D-X19, ADR 0020): lee
 * el plan de etapas confirmado (9.3.4) y las filas de staging ya persistidas (9.3.3) de un lote
 * `VALIDATED`, y devuelve exactamente la forma que necesita `ImportWriterService.importBatch()`
 * (`stages`/`bets` de `ImportBatchWriteInput`). Nunca escribe nada: no toca el ledger, no crea
 * etapas reales, no llama a `ImportWriterService`. Solo lectura.
 */

export interface ImportResolveBetsInput {
  projectId: string;
  batchId: string;
}

export interface ImportResolvedBets {
  stages: NormalizedImportStage[];
  bets: NormalizedImportBet[];
  /** D-X19: avisa, nunca bloquea — filas cuyo monto no es múltiplo exacto de la unidad de su etapa. */
  inexactStakeRows: number[];
}

const { sourceFile: omittedSourceFile, ...BATCH_COLUMNS } = getTableColumns(importBatches);
void omittedSourceFile;

const invalidState = (message: string): AppError =>
  new AppError(409, ErrorCode.INVALID_STATE, message);

@Injectable()
export class ImportBetResolutionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async resolveBatch(input: ImportResolveBetsInput): Promise<ImportResolvedBets> {
    const [batch] = await this.db
      .select(BATCH_COLUMNS)
      .from(importBatches)
      .where(and(eq(importBatches.id, input.batchId), eq(importBatches.projectId, input.projectId)))
      .limit(1);
    if (!batch) throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
    // Resolver antes de VALIDATED no tiene sentido (sin casa confirmada); IMPORTED/ANNULLED ya
    // tienen sus apuestas escritas o revertidas, nunca se vuelven a resolver desde aquí.
    if (batch.status !== 'VALIDATED') {
      throw invalidState(
        'Este lote debe estar validado, con su casa confirmada, para resolver sus apuestas.',
      );
    }
    if (!batch.stagePlan) throw invalidState('El lote no tiene un plan de etapas guardado.');

    const plan = parseStagePlan(batch.stagePlan);
    const planIssues = validateImportStagePlan(plan);
    if (planIssues.length > 0) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El plan de etapas guardado ya no es válido: rangos de filas inconsistentes.',
        { details: { issues: planIssues } },
      );
    }

    const rows = await this.db
      .select({
        rowNumber: importRows.rowNumber,
        status: importRows.status,
        normalized: importRows.normalized,
      })
      .from(importRows)
      .where(eq(importRows.importBatchId, batch.id));

    const validRowCount = rows.filter((row) => row.status === 'VALID').length;
    const stagingRows: ImportStagingRow[] = rows
      .filter((row) => row.normalized !== null)
      .map((row) => ({
        rowNumber: row.rowNumber,
        bet: row.normalized as unknown as ImportRowNormalizedBet,
      }));

    const result = resolveImportBets(stagingRows, plan);
    if (result.unresolvedRows.length > 0) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'Hay filas válidas que ninguna etapa del plan cubre.',
        {
          details: {
            issues: result.unresolvedRows.map(
              (rowNumber) => `La fila ${rowNumber} no cae en el rango de ninguna etapa del plan.`,
            ),
          },
        },
      );
    }
    // Defensivo (D-X21): toda fila VALID debe terminar con una apuesta resuelta, ni una de más ni
    // una de menos. Si esto llegara a fallar, es un error de datos, no algo que la persona corrija.
    if (result.bets.length !== validRowCount) {
      throw new Error(
        `Resolución incompleta del lote ${batch.id}: ${result.bets.length} apuestas resueltas de ${validRowCount} filas válidas.`,
      );
    }

    // Orden cronológico (por inicio de rango): el capital histórico (9.3.7) usa la primera etapa.
    const sortedStages = [...plan.stages].sort((a, b) => a.firstRow - b.firstRow);
    return {
      stages: sortedStages.map((stage) => ({
        key: stage.key,
        name: stage.name,
        unitStake: stage.unitStake,
        startsAt: stage.startsAt,
        status: stage.status,
      })),
      bets: result.bets,
      inexactStakeRows: result.inexactStakeRows,
    };
  }
}

/** `import_batches.stage_plan` tal como lo guardó `saveStagePlan` (9.3.4), con las fechas ya parseadas. */
function parseStagePlan(raw: Record<string, unknown>): ImportStagePlan {
  const data = raw as unknown as {
    stages: { startsAt: string | null; [key: string]: unknown }[];
  };
  return {
    stages: data.stages.map((stage) => ({
      ...stage,
      startsAt: stage.startsAt ? new Date(stage.startsAt) : null,
    })) as ImportStagePlan['stages'],
  };
}
