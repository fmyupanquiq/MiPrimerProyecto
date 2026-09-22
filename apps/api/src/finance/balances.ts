import { addMoney, subtractMoney, ZERO_MONEY, type MoneyString } from '@letfer/shared';
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../database/database.types.js';
import { financialMovements, withdrawalRequests } from '../database/schema/index.js';

export interface HouseBalance {
  /** Reconstruido desde el ledger (D3): nunca es una segunda fuente de verdad (§72). */
  balance: MoneyString;
  /** Reservado por retiros pendientes (§17, §92; los de apuestas llegan en la Fase 4). */
  committed: MoneyString;
  /** `balance - committed`; nunca negativo en la práctica (§17). */
  available: MoneyString;
}

const ZERO_BALANCE: HouseBalance = {
  balance: ZERO_MONEY,
  committed: ZERO_MONEY,
  available: ZERO_MONEY,
};

/**
 * Saldo de cada casa del proyecto, reconstruido sumando el ledger y restando los retiros
 * pendientes. Sin caché (D3): se recalcula en cada consulta, priorizando la integridad sobre
 * el rendimiento a esta escala.
 */
export async function computeHouseBalances(
  executor: DbExecutor,
  projectId: string,
): Promise<Map<string, HouseBalance>> {
  const movements = await executor
    .select({
      houseId: financialMovements.houseId,
      fromHouseId: financialMovements.fromHouseId,
      toHouseId: financialMovements.toHouseId,
      direction: financialMovements.direction,
      amount: financialMovements.amount,
    })
    .from(financialMovements)
    .where(eq(financialMovements.projectId, projectId));

  const balances = new Map<string, MoneyString>();
  const bump = (houseId: string | null, apply: (current: MoneyString) => MoneyString): void => {
    if (!houseId) return;
    balances.set(houseId, apply(balances.get(houseId) ?? ZERO_MONEY));
  };
  for (const movement of movements) {
    if (movement.houseId) {
      // Movimiento de una sola casa: CREDIT suma, DEBIT resta.
      bump(movement.houseId, (current) =>
        movement.direction === 'DEBIT'
          ? subtractMoney(current, movement.amount)
          : addMoney(current, movement.amount),
      );
    } else {
      // Transferencia: se debita el origen y se acredita el destino a la vez (D4).
      bump(movement.fromHouseId, (current) => subtractMoney(current, movement.amount));
      bump(movement.toHouseId, (current) => addMoney(current, movement.amount));
    }
  }

  const pending = await executor
    .select({ houseId: withdrawalRequests.houseId, amount: withdrawalRequests.amount })
    .from(withdrawalRequests)
    .where(
      and(eq(withdrawalRequests.projectId, projectId), eq(withdrawalRequests.status, 'PENDING')),
    );
  const committed = new Map<string, MoneyString>();
  for (const request of pending) {
    committed.set(
      request.houseId,
      addMoney(committed.get(request.houseId) ?? ZERO_MONEY, request.amount),
    );
  }

  const houseIds = new Set([...balances.keys(), ...committed.keys()]);
  const result = new Map<string, HouseBalance>();
  for (const houseId of houseIds) {
    const balance = balances.get(houseId) ?? ZERO_MONEY;
    const houseCommitted = committed.get(houseId) ?? ZERO_MONEY;
    result.set(houseId, {
      balance,
      committed: houseCommitted,
      available: subtractMoney(balance, houseCommitted),
    });
  }
  return result;
}

/** Saldo de una única casa; una casa sin movimientos ni reservas está en cero. */
export async function computeHouseBalance(
  executor: DbExecutor,
  projectId: string,
  houseId: string,
): Promise<HouseBalance> {
  const balances = await computeHouseBalances(executor, projectId);
  return balances.get(houseId) ?? ZERO_BALANCE;
}
