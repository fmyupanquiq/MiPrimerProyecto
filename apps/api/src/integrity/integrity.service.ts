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
      ...(await this.checkBetLedgerNet(this.db, projectId)),
      ...(await this.checkReversalIntegrity(this.db, projectId)),
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

  /**
   * b) Liquidaciones y filas vigentes (D-B2, §112.7): con reversiones ya no basta contar filas
   * `BET_SETTLEMENT`; se cuentan las **vigentes** (las que ninguna reversión anuló). Una liquidada no
   * eliminada tiene exactamente una colocación vigente y una liquidación vigente solo si su retorno
   * efectivo es positivo y no es `LOST`; una pendiente o eliminada no tiene ninguna.
   */
  private async checkSettlementShape(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const result = await executor.execute<{ id: string }>(
      sql`WITH live AS (
            SELECT fm.id, fm.type, fm.operation_id FROM financial_movements fm
            WHERE fm.type IN ('BET_PLACEMENT', 'BET_SETTLEMENT')
              AND NOT EXISTS (SELECT 1 FROM financial_movements r WHERE r.reverses_movement_id = fm.id)
          )
          SELECT b.id FROM bets b
          LEFT JOIN live ON live.operation_id = b.id
          WHERE (${projectId ?? null}::uuid IS NULL OR b.project_id = ${projectId ?? null}::uuid)
          GROUP BY b.id
          HAVING (
                   (b.status = 'PENDING' OR b.deleted_at IS NOT NULL) AND COUNT(live.id) <> 0
                 )
              OR (
                   b.status <> 'PENDING' AND b.deleted_at IS NULL AND (
                     COUNT(live.id) FILTER (WHERE live.type = 'BET_PLACEMENT') <> 1
                     OR COUNT(live.id) FILTER (WHERE live.type = 'BET_SETTLEMENT') <> CASE
                          WHEN b.status = 'LOST' THEN 0
                          WHEN COALESCE(b.official_realized_return, b.calculated_realized_return, 0) > 0 THEN 1
                          ELSE 0
                        END
                   )
                 )`,
    );
    const affected = result.rows.map((r) => `bet:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'SETTLEMENT_SHAPE',
            message:
              'Una o más apuestas no tienen las filas vigentes del ledger que corresponden a su estado (D-B2, §112.7).',
            affected,
          },
        ]
      : [];
  }

  /**
   * b1/b2) El efecto neto de cada apuesta en el ledger (créditos − débitos de sus filas, con
   * reversiones) es exactamente su ganancia o pérdida derivada (§112.6): una liquidada no eliminada,
   * `retorno efectivo − monto` (`−monto` si es `LOST`); una pendiente o eliminada, cero. Es la misma
   * cifra que suma el dashboard, y este chequeo la contrasta con lo que dicen los datos de la apuesta.
   */
  private async checkBetLedgerNet(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const result = await executor.execute<{ id: string }>(
      sql`SELECT b.id FROM bets b
          JOIN stages s ON s.id = b.stage_id
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(CASE WHEN fm.direction = 'CREDIT' THEN fm.amount ELSE -fm.amount END), 0) AS net
            FROM financial_movements fm
            WHERE fm.operation_id = b.id AND fm.type IN ('BET_PLACEMENT', 'BET_SETTLEMENT', 'REVERSAL')
          ) ledger
          WHERE (${projectId ?? null}::uuid IS NULL OR b.project_id = ${projectId ?? null}::uuid)
            AND ledger.net <> CASE
                  WHEN b.status = 'PENDING' OR b.deleted_at IS NOT NULL THEN 0
                  WHEN b.status = 'LOST'
                    THEN -COALESCE(b.official_amount, ROUND(s.unit_stake * b.stake, 2))
                  ELSE COALESCE(b.official_realized_return, b.calculated_realized_return, 0)
                       - COALESCE(b.official_amount, ROUND(s.unit_stake * b.stake, 2))
                END`,
    );
    const affected = result.rows.map((r) => `bet:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'BET_LEDGER_NET',
            message:
              'El efecto neto de una o más apuestas en el ledger no coincide con su ganancia o pérdida (§112.6).',
            affected,
          },
        ]
      : [];
  }

  /**
   * b3/b4) Reversiones y correcciones (§112.1, §112.7): toda reversión de una operación de apuesta
   * lleva su corrección, y esa corrección pertenece a la misma apuesta. (Que una fila no se anule dos
   * veces y que la reversión coincida con la original lo garantizan la base de datos.)
   */
  private async checkReversalIntegrity(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const result = await executor.execute<{ id: string }>(
      sql`SELECT m.id FROM financial_movements m
          LEFT JOIN bet_corrections c ON c.id = m.correction_id
          WHERE m.type = 'REVERSAL'
            AND EXISTS (SELECT 1 FROM bets b WHERE b.id = m.operation_id)
            AND (m.correction_id IS NULL OR c.bet_id <> m.operation_id)
            AND (${projectId ?? null}::uuid IS NULL OR m.project_id = ${projectId ?? null}::uuid)`,
    );
    const affected = result.rows.map((r) => `movement:${r.id}`);
    return affected.length > 0
      ? [
          {
            check: 'REVERSAL_INTEGRITY',
            message:
              'Una o más reversiones no tienen la corrección de su apuesta que las originó (§112.1).',
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

  /**
   * e) Todo checkpoint que debería estar `INVALIDATED` (§109.1.3, §112.5) efectivamente lo está.
   *
   * Dos vías independientes de la aplicación:
   * - **Ledger**: una fila se escribió DESPUÉS de crearse el checkpoint y con fecha efectiva anterior a
   *   la del checkpoint (liquidaciones, reversiones y re-registros incluidos): el checkpoint vio otra
   *   historia. Es la vía general y no depende de ninguna columna de la apuesta.
   * - **Apuestas pendientes**: no dejan fila en el ledger (D-B7), así que su efecto sobre el
   *   comprometido se detecta con \`financial_fields_updated_at\` (M1 de la revisión de la Fase 5.5).
   *   Solo pendientes: en una liquidada o eliminada manda el ledger, y la fecha de un cambio posterior
   *   a la del checkpoint no debe invalidarlo (§112.5).
   */
  private async checkCheckpointInvalidation(
    executor: DbExecutor,
    projectId: string | undefined,
  ): Promise<IntegrityFinding[]> {
    const project = sql`(${projectId ?? null}::uuid IS NULL OR c.project_id = ${projectId ?? null}::uuid)`;
    const [viaLedger, viaPending] = await Promise.all([
      executor.execute<{ id: string }>(
        sql`SELECT DISTINCT c.id FROM reconciliation_checkpoints c
            JOIN financial_movements m
              ON (m.house_id = c.house_id OR m.from_house_id = c.house_id OR m.to_house_id = c.house_id)
             AND m.occurred_at < c.occurred_at
             AND m.created_at > c.created_at
            WHERE c.status = 'MATCHED' AND ${project}`,
      ),
      executor.execute<{ id: string }>(
        sql`SELECT DISTINCT c.id FROM reconciliation_checkpoints c
            JOIN bets b ON b.house_id = c.house_id AND b.placed_at <= c.occurred_at
            WHERE c.status = 'MATCHED' AND b.status = 'PENDING'
              AND b.financial_fields_updated_at > c.created_at AND ${project}`,
      ),
    ]);
    const affected = [...new Set([...viaLedger.rows, ...viaPending.rows].map((r) => r.id))].map(
      (id) => `checkpoint:${id}`,
    );
    return affected.length > 0
      ? [
          {
            check: 'CHECKPOINT_INVALIDATION',
            message:
              'Uno o más checkpoints siguen MATCHED pese a un cambio posterior en su historia (§74).',
            affected,
          },
        ]
      : [];
  }
}
