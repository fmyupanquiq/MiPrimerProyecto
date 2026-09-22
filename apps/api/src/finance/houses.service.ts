import { Inject, Injectable } from '@nestjs/common';
import { isZeroMoney, type CreateHouseInput, type HouseSummary } from '@letfer/shared';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { houses, type HouseRow, type UserRow } from '../database/schema/index.js';
import { computeHouseBalances, type HouseBalance } from './balances.js';
import { assertFinanceReady, financeConflict, financeNotFound } from './finance-errors.js';

const ZERO_BALANCE: HouseBalance = { balance: '0.00', committed: '0.00', available: '0.00' };

function toSummary(house: HouseRow, balance: HouseBalance): HouseSummary {
  return {
    id: house.id,
    projectId: house.projectId,
    name: house.name,
    status: house.status,
    balance: balance.balance,
    committed: balance.committed,
    available: balance.available,
    createdAt: house.createdAt.toISOString(),
  };
}

/**
 * Casas de apuestas (§13, §15). Catálogo libre por proyecto (D7); nunca se eliminan
 * físicamente, solo se activan o desactivan. El saldo se reconstruye desde el ledger en cada
 * consulta (D3).
 */
@Injectable()
export class HousesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(access: ProjectAccess): Promise<HouseSummary[]> {
    const rows = await this.db
      .select()
      .from(houses)
      .where(eq(houses.projectId, access.project.id))
      .orderBy(asc(houses.name));
    const balances = await computeHouseBalances(this.db, access.project.id);
    return rows.map((house) => toSummary(house, balances.get(house.id) ?? ZERO_BALANCE));
  }

  /**
   * Añade una casa (§13). Empieza sin saldo: el dinero solo llega después por un depósito o
   * una transferencia (§15), nunca asignado directamente.
   */
  async create(
    access: ProjectAccess,
    actor: UserRow,
    input: CreateHouseInput,
  ): Promise<HouseSummary> {
    assertFinanceReady(access);
    const [house] = await this.db
      .insert(houses)
      .values({ projectId: access.project.id, name: input.name })
      .returning();
    await this.audit.record(this.db, {
      action: 'house.created',
      entityType: 'house',
      entityId: house!.id,
      projectId: access.project.id,
      actorUserId: actor.id,
      newValues: { name: house!.name },
    });
    return toSummary(house!, ZERO_BALANCE);
  }

  /** Desactiva una casa; exige saldo cero (§13). */
  async deactivate(access: ProjectAccess, actor: UserRow, houseId: string): Promise<void> {
    await this.setStatus(access, actor, houseId, 'INACTIVE', 'house.deactivated');
  }

  /** Reactiva una casa desactivada. */
  async activate(access: ProjectAccess, actor: UserRow, houseId: string): Promise<void> {
    await this.setStatus(access, actor, houseId, 'ACTIVE', 'house.activated');
  }

  private async setStatus(
    access: ProjectAccess,
    actor: UserRow,
    houseId: string,
    status: 'ACTIVE' | 'INACTIVE',
    action: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockByKey(tx, `finance:${access.project.id}`);
      const [house] = await tx
        .select()
        .from(houses)
        .where(eq(houses.id, houseId))
        .for('update')
        .limit(1);
      if (!house || house.projectId !== access.project.id) {
        throw financeNotFound('Casa no encontrada.');
      }
      if (house.status === status) return; // idempotente: ya está en ese estado.

      if (status === 'INACTIVE') {
        const balances = await computeHouseBalances(tx, access.project.id);
        const balance = balances.get(houseId) ?? ZERO_BALANCE;
        if (!isZeroMoney(balance.balance)) {
          throw financeConflict('Solo se puede desactivar una casa con saldo cero.');
        }
      }

      await tx.update(houses).set({ status }).where(eq(houses.id, house.id));
      await this.audit.record(tx, {
        action,
        entityType: 'house',
        entityId: house.id,
        projectId: access.project.id,
        actorUserId: actor.id,
        oldValues: { status: house.status },
        newValues: { status },
      });
    });
  }
}
