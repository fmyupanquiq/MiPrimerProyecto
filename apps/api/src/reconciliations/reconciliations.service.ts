import { Inject, Injectable } from '@nestjs/common';
import {
  isZeroMoney,
  subtractMoney,
  type ConfirmReconciliationInput,
  type ReconciliationCheckpointSummary,
  type ReconciliationHouseStatus,
  type ReconciliationReview,
  type ReconciliationReviewBet,
  type ReconciliationReviewMovement,
  type ReconciliationStatus,
} from '@letfer/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { BetsService } from '../bets/bets.service.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  houses,
  reconciliationCheckpoints,
  users,
  type HouseRow,
  type ReconciliationCheckpointRow,
  type UserRow,
} from '../database/schema/index.js';
import { financeConflict, financeNotFound } from '../finance/finance-errors.js';
import { computeHouseBalance } from '../finance/balances.js';
import { MovementsService } from '../finance/movements.service.js';
import { fullName } from '../projects/project-mappers.js';

interface Context {
  houseName: string;
  performedByName: string;
}

/**
 * Conciliación (§32, §80, §109.1). Un checkpoint es un registro histórico de comparación (D-C1):
 * nunca modifica saldos, nunca crea movimientos, nunca corrige datos automáticamente. Un solo
 * paso (D-C2): declarar el saldo oficial ya compara y registra.
 */
@Injectable()
export class ReconciliationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly bets: BetsService,
    private readonly movements: MovementsService,
  ) {}

  async list(access: ProjectAccess, houseId: string): Promise<ReconciliationCheckpointSummary[]> {
    const house = await this.houseOf(this.db, access.project.id, houseId);
    const rows = await this.db
      .select()
      .from(reconciliationCheckpoints)
      .where(
        and(
          eq(reconciliationCheckpoints.projectId, access.project.id),
          eq(reconciliationCheckpoints.houseId, houseId),
        ),
      )
      .orderBy(
        desc(reconciliationCheckpoints.occurredAt),
        desc(reconciliationCheckpoints.createdAt),
      );
    return this.summariesOf(this.db, rows, house.name);
  }

  /** "Requiere nueva conciliación" (§74, §109.1.3): se deriva en vivo, nunca se guarda. */
  async status(access: ProjectAccess, houseId: string): Promise<ReconciliationHouseStatus> {
    const house = await this.houseOf(this.db, access.project.id, houseId);
    const lastMatched = await this.lastMatchedCheckpoint(this.db, access.project.id, houseId);
    return {
      houseId,
      requiresReconciliation: lastMatched === undefined,
      lastMatchedCheckpoint: lastMatched
        ? this.toSummary(lastMatched, {
            houseName: house.name,
            performedByName: await this.userName(this.db, lastMatched.performedBy),
          })
        : null,
    };
  }

  /**
   * Compara el saldo declarado contra el disponible de LetFer y registra el checkpoint, coincida
   * o no (D-C1). Nunca toca el ledger ni los saldos: es una comparación, no un ajuste.
   */
  async confirm(
    access: ProjectAccess,
    actor: UserRow,
    houseId: string,
    input: ConfirmReconciliationInput,
  ): Promise<ReconciliationCheckpointSummary> {
    // A diferencia del resto de finanzas, conciliar no exige el proyecto ACTIVE: el §85 permite
    // "conciliación final" con el proyecto CLOSED. Solo exige que la configuración inicial ya
    // esté completa (sin ella no hay ledger que comparar).
    if (access.project.setupCompletedAt === null) {
      throw financeConflict('Completa primero la configuración inicial del proyecto.');
    }
    const created = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const house = await this.houseOf(tx, access.project.id, houseId);
      const balance = await computeHouseBalance(tx, access.project.id, houseId);
      const now = this.clock.now();
      const difference = subtractMoney(input.officialAvailable, balance.available);
      const status: ReconciliationStatus = isZeroMoney(difference) ? 'MATCHED' : 'DISCREPANCY';

      const [row] = await tx
        .insert(reconciliationCheckpoints)
        .values({
          projectId: access.project.id,
          houseId: house.id,
          occurredAt: now,
          letferAvailable: balance.available,
          officialAvailable: input.officialAvailable,
          committed: balance.committed,
          difference,
          status,
          performedBy: actor.id,
          note: input.note ?? null,
        })
        .returning();

      await this.audit.record(tx, {
        action: 'reconciliation.confirmed',
        entityType: 'reconciliation_checkpoint',
        entityId: row!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: {
          houseId: house.id,
          letferAvailable: balance.available,
          officialAvailable: input.officialAvailable,
          difference,
          status,
        },
      });
      return { row: row!, houseName: house.name };
    });
    return this.toSummary(created.row, {
      houseName: created.houseName,
      performedByName: fullName(actor),
    });
  }

  /** "Revisar desde última conciliación" (§32.2): solo lectura, no altera nada. */
  async review(access: ProjectAccess, houseId: string): Promise<ReconciliationReview> {
    await this.houseOf(this.db, access.project.id, houseId);
    const lastMatched = await this.lastMatchedCheckpoint(this.db, access.project.id, houseId);
    const since = lastMatched?.occurredAt ?? null;

    const allBets = await this.bets.list(access, { houseId });
    const bets: ReconciliationReviewBet[] = allBets
      .filter((bet) => {
        if (!since) return true;
        if (new Date(bet.placedAt).getTime() > since.getTime()) return true;
        return bet.settledAt !== null && new Date(bet.settledAt).getTime() > since.getTime();
      })
      .map((bet) => ({
        id: bet.id,
        betType: bet.betType,
        status: bet.status,
        placedAt: bet.placedAt,
        settledAt: bet.settledAt,
        effectiveAmount: bet.effectiveAmount,
        profitLoss: bet.profitLoss,
      }));

    const allMovements = await this.movements.list(access);
    const movements: ReconciliationReviewMovement[] = allMovements
      .filter((movement) => {
        const touchesHouse =
          movement.houseId === houseId ||
          movement.fromHouseId === houseId ||
          movement.toHouseId === houseId;
        if (!touchesHouse) return false;
        return !since || new Date(movement.occurredAt).getTime() > since.getTime();
      })
      .map((movement) => ({
        id: movement.id,
        type: movement.type,
        direction: movement.direction,
        amount: movement.amount,
        occurredAt: movement.occurredAt,
      }));

    return { since: since ? since.toISOString() : null, bets, movements };
  }

  // --- Helpers privados --------------------------------------------------------------------

  private async houseOf(
    executor: DbExecutor,
    projectId: string,
    houseId: string,
  ): Promise<HouseRow> {
    const [house] = await executor.select().from(houses).where(eq(houses.id, houseId)).limit(1);
    if (!house || house.projectId !== projectId) throw financeNotFound('Casa no encontrada.');
    return house;
  }

  private async lastMatchedCheckpoint(
    executor: DbExecutor,
    projectId: string,
    houseId: string,
  ): Promise<ReconciliationCheckpointRow | undefined> {
    const [row] = await executor
      .select()
      .from(reconciliationCheckpoints)
      .where(
        and(
          eq(reconciliationCheckpoints.projectId, projectId),
          eq(reconciliationCheckpoints.houseId, houseId),
          eq(reconciliationCheckpoints.status, 'MATCHED'),
        ),
      )
      .orderBy(desc(reconciliationCheckpoints.occurredAt))
      .limit(1);
    return row;
  }

  private async userName(executor: DbExecutor, userId: string): Promise<string> {
    const [user] = await executor
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ? fullName(user) : '';
  }

  private toSummary(
    row: ReconciliationCheckpointRow,
    ctx: Context,
  ): ReconciliationCheckpointSummary {
    return {
      id: row.id,
      projectId: row.projectId,
      houseId: row.houseId,
      houseName: ctx.houseName,
      occurredAt: row.occurredAt.toISOString(),
      letferAvailable: row.letferAvailable,
      officialAvailable: row.officialAvailable,
      committed: row.committed,
      difference: row.difference,
      status: row.status,
      performedBy: { id: row.performedBy, name: ctx.performedByName },
      note: row.note,
      invalidatedAt: row.invalidatedAt ? row.invalidatedAt.toISOString() : null,
      invalidatedReason: row.invalidatedReason,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async summariesOf(
    executor: DbExecutor,
    rows: ReconciliationCheckpointRow[],
    houseName: string,
  ): Promise<ReconciliationCheckpointSummary[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((r) => r.performedBy))];
    const userRows = await executor
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, userIds));
    const nameById = new Map(userRows.map((u) => [u.id, fullName(u)]));
    return rows.map((row) =>
      this.toSummary(row, {
        houseName,
        performedByName: nameById.get(row.performedBy) ?? '',
      }),
    );
  }
}
