import { Inject, Injectable } from '@nestjs/common';
import {
  compareMoney,
  type CreateDepositInput,
  type CreateExtraordinaryMovementInput,
  type CreateTransferInput,
  type MovementSummary,
} from '@letfer/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { Clock } from '../common/clock.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  financialMovements,
  houses,
  stages,
  users,
  type FinancialMovementRow,
  type HouseRow,
  type UserRow,
} from '../database/schema/index.js';
import { fullName } from '../projects/project-mappers.js';
import { computeHouseBalances } from './balances.js';
import {
  assertFinanceReady,
  financeConflict,
  financeNotFound,
  insufficientBalance,
} from './finance-errors.js';

function toSummary(
  movement: FinancialMovementRow,
  houseNames: Map<string, string>,
  creatorName: string,
): MovementSummary {
  return {
    id: movement.id,
    operationId: movement.operationId,
    projectId: movement.projectId,
    stageId: movement.stageId,
    type: movement.type,
    direction: movement.direction,
    houseId: movement.houseId,
    houseName: movement.houseId ? (houseNames.get(movement.houseId) ?? null) : null,
    fromHouseId: movement.fromHouseId,
    fromHouseName: movement.fromHouseId ? (houseNames.get(movement.fromHouseId) ?? null) : null,
    toHouseId: movement.toHouseId,
    toHouseName: movement.toHouseId ? (houseNames.get(movement.toHouseId) ?? null) : null,
    amount: movement.amount,
    reason: movement.reason,
    occurredAt: movement.occurredAt.toISOString(),
    createdAt: movement.createdAt.toISOString(),
    createdBy: { id: movement.createdBy, name: creatorName },
  };
}

/**
 * Movimientos financieros (§16, §72): depósitos, transferencias internas y extraordinarios.
 * Ledger unificado, inmutable tras confirmarse (D2); los retiros se gestionan aparte
 * (`WithdrawalsService`, D5), porque tienen un ciclo de aprobación previo.
 */
@Injectable()
export class MovementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(access: ProjectAccess): Promise<MovementSummary[]> {
    const rows = await this.db
      .select({
        movement: financialMovements,
        creatorFirst: users.firstName,
        creatorLast: users.lastName,
      })
      .from(financialMovements)
      .innerJoin(users, eq(users.id, financialMovements.createdBy))
      .where(eq(financialMovements.projectId, access.project.id))
      .orderBy(desc(financialMovements.occurredAt), desc(financialMovements.id));
    const houseNames = await this.houseNames(access.project.id);
    return rows.map((row) =>
      toSummary(
        row.movement,
        houseNames,
        fullName({ firstName: row.creatorFirst, lastName: row.creatorLast }),
      ),
    );
  }

  /** Depósito (§16.1): dinero externo que entra al proyecto. */
  async deposit(
    access: ProjectAccess,
    actor: UserRow,
    input: CreateDepositInput,
  ): Promise<MovementSummary> {
    assertFinanceReady(access);
    const movement = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      await this.assertActiveHouse(tx, access.project.id, input.houseId);
      const stageId = await this.currentStageId(tx, access.project.id);
      const [created] = await tx
        .insert(financialMovements)
        .values({
          projectId: access.project.id,
          stageId,
          type: 'DEPOSIT',
          direction: 'CREDIT',
          houseId: input.houseId,
          amount: input.amount,
          reason: input.reason ?? null,
          occurredAt: this.clock.now(),
          createdBy: actor.id,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'movement.deposit_created',
        entityType: 'financial_movement',
        entityId: created!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: { houseId: input.houseId, amount: input.amount, reason: input.reason ?? null },
      });
      return created!;
    });
    return this.summaryOf(movement, actor);
  }

  /** Transferencia interna (§16.3): atómica, no altera el capital total. */
  async transfer(
    access: ProjectAccess,
    actor: UserRow,
    input: CreateTransferInput,
  ): Promise<MovementSummary> {
    assertFinanceReady(access);
    const movement = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      await this.assertActiveHouse(tx, access.project.id, input.fromHouseId);
      await this.assertActiveHouse(tx, access.project.id, input.toHouseId);

      const balances = await computeHouseBalances(tx, access.project.id);
      const available = balances.get(input.fromHouseId)?.available ?? '0.00';
      if (compareMoney(available, input.amount) < 0) throw insufficientBalance();

      const stageId = await this.currentStageId(tx, access.project.id);
      const [created] = await tx
        .insert(financialMovements)
        .values({
          projectId: access.project.id,
          stageId,
          type: 'TRANSFER',
          direction: null,
          houseId: null,
          fromHouseId: input.fromHouseId,
          toHouseId: input.toHouseId,
          amount: input.amount,
          reason: input.reason ?? null,
          occurredAt: this.clock.now(),
          createdBy: actor.id,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'movement.transfer_created',
        entityType: 'financial_movement',
        entityId: created!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: {
          fromHouseId: input.fromHouseId,
          toHouseId: input.toHouseId,
          amount: input.amount,
          reason: input.reason ?? null,
        },
      });
      return created!;
    });
    return this.summaryOf(movement, actor);
  }

  /** Movimiento extraordinario real (§16.4): nunca un "ajuste" genérico; motivo obligatorio. */
  async extraordinary(
    access: ProjectAccess,
    actor: UserRow,
    input: CreateExtraordinaryMovementInput,
  ): Promise<MovementSummary> {
    assertFinanceReady(access);
    const movement = await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      await this.assertActiveHouse(tx, access.project.id, input.houseId);

      if (input.direction === 'DEBIT') {
        const balances = await computeHouseBalances(tx, access.project.id);
        const available = balances.get(input.houseId)?.available ?? '0.00';
        if (compareMoney(available, input.amount) < 0) throw insufficientBalance();
      }

      const stageId = await this.currentStageId(tx, access.project.id);
      const [created] = await tx
        .insert(financialMovements)
        .values({
          projectId: access.project.id,
          stageId,
          type: 'EXTRAORDINARY',
          direction: input.direction,
          houseId: input.houseId,
          amount: input.amount,
          reason: input.reason,
          occurredAt: this.clock.now(),
          createdBy: actor.id,
        })
        .returning();
      await this.audit.record(tx, {
        action: 'movement.extraordinary_created',
        entityType: 'financial_movement',
        entityId: created!.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        newValues: {
          houseId: input.houseId,
          direction: input.direction,
          amount: input.amount,
          reason: input.reason,
        },
      });
      return created!;
    });
    return this.summaryOf(movement, actor);
  }

  /** La casa debe existir en este proyecto y estar activa (una desactivada no admite movimientos). */
  private async assertActiveHouse(
    executor: DbExecutor,
    projectId: string,
    houseId: string,
  ): Promise<HouseRow> {
    const [house] = await executor.select().from(houses).where(eq(houses.id, houseId)).limit(1);
    if (!house || house.projectId !== projectId) throw financeNotFound('Casa no encontrada.');
    if (house.status !== 'ACTIVE') {
      throw financeConflict('La casa está desactivada: reactívala antes de registrar movimientos.');
    }
    return house;
  }

  private async currentStageId(executor: DbExecutor, projectId: string): Promise<string> {
    const [stage] = await executor
      .select({ id: stages.id })
      .from(stages)
      .where(and(eq(stages.projectId, projectId), eq(stages.status, 'ACTIVE')))
      .limit(1);
    // assertFinanceReady ya garantiza que el setup se completó (siempre hay una etapa activa).
    if (!stage) throw financeConflict('El proyecto todavía no tiene una etapa activa.');
    return stage.id;
  }

  private async houseNames(projectId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: houses.id, name: houses.name })
      .from(houses)
      .where(eq(houses.projectId, projectId));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async summaryOf(
    movement: FinancialMovementRow,
    actor: UserRow,
  ): Promise<MovementSummary> {
    const houseNames = await this.houseNames(movement.projectId);
    return toSummary(movement, houseNames, fullName(actor));
  }
}
