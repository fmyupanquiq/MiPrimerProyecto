import { Inject, Injectable } from '@nestjs/common';
import {
  compareMoney,
  ZERO_MONEY,
  type IntegrityCheckRunSummary,
  type IntegrityCheckStatus,
  type IntegrityFinding,
} from '@letfer/shared';
import { desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { houses, integrityCheckRuns, projects, users } from '../database/schema/index.js';
import { computeHouseBalances } from '../finance/balances.js';
import { fullName } from '../projects/project-mappers.js';

/**
 * Verificación de integridad del ledger (§38, §109.2, D-I1). Herramienta de solo lectura: nunca
 * corrige datos, nunca crea movimientos, nunca inventa dinero. `projectId` acota el chequeo a un
 * proyecto (Administrador de Proyecto); `undefined` lo corre sobre todos (Administrador Global,
 * D-I3), en cuyo caso cada `affected` incluye el proyecto para poder ubicarlo.
 */
@Injectable()
export class IntegrityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async run(
    actor: { id: string; firstName: string; lastName: string },
    projectId?: string,
  ): Promise<IntegrityCheckRunSummary> {
    const startedAt = this.clock.now();
    const projectIds = projectId
      ? [projectId]
      : (
          await this.db.select({ id: projects.id }).from(projects).where(isNull(projects.deletedAt))
        ).map((p) => p.id);

    const findings: IntegrityFinding[] = [
      ...(await this.checkNegativeAvailable(this.db, projectIds)),
      ...(await this.checkSettlementShape(this.db, projectId)),
      ...(await this.checkPendingBetReferences(this.db, projectId)),
      ...(await this.checkLedgerShape(this.db, projectId)),
      ...(await this.checkCheckpointInvalidation(this.db, projectId)),
    ];

    const finishedAt = this.clock.now();
    const status: IntegrityCheckStatus = findings.length > 0 ? 'ISSUES_FOUND' : 'OK';
    const [row] = await this.db
      .insert(integrityCheckRuns)
      .values({
        projectId: projectId ?? null,
        runBy: actor.id,
        startedAt,
        finishedAt,
        status,
        findings,
      })
      .returning();

    return {
      id: row!.id,
      projectId: row!.projectId,
      runBy: { id: actor.id, name: fullName(actor) },
      startedAt: row!.startedAt.toISOString(),
      finishedAt: row!.finishedAt.toISOString(),
      status: row!.status,
      findings: row!.findings,
    };
  }

  async list(projectId?: string): Promise<IntegrityCheckRunSummary[]> {
    const rows = await this.db
      .select()
      .from(integrityCheckRuns)
      .where(
        projectId
          ? eq(integrityCheckRuns.projectId, projectId)
          : isNull(integrityCheckRuns.projectId),
      )
      .orderBy(desc(integrityCheckRuns.startedAt));
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((r) => r.runBy))];
    const userRows = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, userIds));
    const nameById = new Map(userRows.map((u) => [u.id, fullName(u)]));
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      runBy: { id: row.runBy, name: nameById.get(row.runBy) ?? '' },
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt.toISOString(),
      status: row.status,
      findings: row.findings,
    }));
  }

  // --- Comprobaciones (D-I1) ----------------------------------------------------------------

  /** a) Cada casa, recalculada desde cero, no tiene disponible negativo. */
  private async checkNegativeAvailable(
    executor: DbExecutor,
    projectIds: string[],
  ): Promise<IntegrityFinding[]> {
    const affected: string[] = [];
    for (const projectId of projectIds) {
      const balances = await computeHouseBalances(executor, projectId);
      const houseRows = await executor
        .select({ id: houses.id, name: houses.name })
        .from(houses)
        .where(eq(houses.projectId, projectId));
      for (const house of houseRows) {
        const available = balances.get(house.id)?.available ?? ZERO_MONEY;
        if (compareMoney(available, ZERO_MONEY) < 0) {
          affected.push(`house:${house.id}(${house.name})`);
        }
      }
    }
    return affected.length > 0
      ? [
          {
            check: 'NEGATIVE_AVAILABLE',
            message: 'Una o más casas tienen disponible negativo al recalcularse desde el ledger.',
            affected,
          },
        ]
      : [];
  }

  /** b) `LOST` sin `BET_SETTLEMENT`; `WON`/`VOID`/`CASHOUT` con exactamente una (D-B2). */
  private async checkSettlementShape(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const result = await executor.execute<{ id: string }>(
      sql`SELECT b.id FROM bets b
          LEFT JOIN financial_movements fm
            ON fm.operation_id = b.id AND fm.type = 'BET_SETTLEMENT'
          WHERE b.status <> 'PENDING'
            AND (${projectId ?? null}::uuid IS NULL OR b.project_id = ${projectId ?? null}::uuid)
          GROUP BY b.id, b.status
          HAVING (b.status = 'LOST' AND COUNT(fm.id) <> 0)
              OR (b.status IN ('WON', 'VOID', 'CASHOUT') AND COUNT(fm.id) <> 1)`,
    );
    const affected = result.rows.map((r) => `bet:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'SETTLEMENT_SHAPE',
            message:
              'Una o más apuestas liquidadas no tienen la fila BET_SETTLEMENT esperada para su estado (D-B2).',
            affected,
          },
        ]
      : [];
  }

  /** c) Ninguna apuesta `PENDING` referencia una etapa en papelera. */
  private async checkPendingBetReferences(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const result = await executor.execute<{ id: string }>(
      sql`SELECT b.id FROM bets b
          JOIN stages s ON s.id = b.stage_id
          WHERE b.status = 'PENDING' AND b.deleted_at IS NULL AND s.status = 'TRASHED'
            AND (${projectId ?? null}::uuid IS NULL OR b.project_id = ${projectId ?? null}::uuid)`,
    );
    const affected = result.rows.map((r) => `bet:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'PENDING_BET_REFERENCES',
            message: 'Una o más apuestas pendientes referencian una etapa en papelera.',
            affected,
          },
        ]
      : [];
  }

  /** d) Defensa en profundidad de la forma del ledger (lo que los `CHECK` ya deberían garantizar). */
  private async checkLedgerShape(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const result = await executor.execute<{ id: string }>(
      sql`SELECT id FROM financial_movements
          WHERE ((type = 'TRANSFER' AND (house_id IS NOT NULL OR from_house_id IS NULL OR to_house_id IS NULL))
             OR (type <> 'TRANSFER' AND house_id IS NULL)
             OR amount <= 0)
            AND (${projectId ?? null}::uuid IS NULL OR project_id = ${projectId ?? null}::uuid)`,
    );
    const affected = result.rows.map((r) => `movement:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'LEDGER_SHAPE',
            message: 'Uno o más movimientos del ledger no cumplen la forma esperada por tipo.',
            affected,
          },
        ]
      : [];
  }

  /** e) Todo checkpoint que debería estar `INVALIDATED` (§109.1.3) efectivamente lo está. */
  private async checkCheckpointInvalidation(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    // M1 (revisión de arquitectura previa a integrar la Fase 5.5): compara contra
    // `financial_fields_updated_at`, no contra `updated_at` — esa columna solo se mueve ante un
    // cambio con efecto financiero real (disparador `bump_bet_financial_timestamp`), nunca ante
    // una simple corrección de motivo (§107.9) o un traslado de etapa sin efecto en el
    // comprometido, que antes se reportaban como falsos hallazgos.
    const result = await executor.execute<{ id: string }>(
      sql`SELECT DISTINCT c.id FROM reconciliation_checkpoints c
          JOIN bets b ON b.house_id = c.house_id AND b.placed_at <= c.occurred_at
          WHERE c.status = 'MATCHED' AND b.financial_fields_updated_at > c.created_at
            AND (${projectId ?? null}::uuid IS NULL OR c.project_id = ${projectId ?? null}::uuid)`,
    );
    const affected = result.rows.map((r) => `checkpoint:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'CHECKPOINT_INVALIDATION',
            message:
              'Uno o más checkpoints siguen MATCHED pese a una apuesta afectada modificada después (§74).',
            affected,
          },
        ]
      : [];
  }
}
