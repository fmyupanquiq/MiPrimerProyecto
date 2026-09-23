import {
  addMoney,
  multiplyMoney,
  subtractMoney,
  ZERO_MONEY,
  type MoneyString,
} from '@letfer/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../database/database.types.js';
import { bets, financialMovements, stages, withdrawalRequests } from '../database/schema/index.js';

export interface HouseBalance {
  /** Reconstruido desde el ledger (D3): nunca es una segunda fuente de verdad (§72). */
  balance: MoneyString;
  /** Reservado por retiros y apuestas pendientes (§17, §92, §107.3). */
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

  const pendingWithdrawals = await executor
    .select({ houseId: withdrawalRequests.houseId, amount: withdrawalRequests.amount })
    .from(withdrawalRequests)
    .where(
      and(eq(withdrawalRequests.projectId, projectId), eq(withdrawalRequests.status, 'PENDING')),
    );
  const committed = new Map<string, MoneyString>();
  for (const request of pendingWithdrawals) {
    committed.set(
      request.houseId,
      addMoney(committed.get(request.houseId) ?? ZERO_MONEY, request.amount),
    );
  }

  // Apuestas pendientes (§17, §92, §107.3): su monto se refleja en vivo, sin fila del ledger
  // todavía (D-B7); oficial si existe, si no `stake × unidad` de su etapa (§76).
  const pendingBets = await executor
    .select({
      houseId: bets.houseId,
      officialAmount: bets.officialAmount,
      stake: bets.stakeAmount,
      unitStake: stages.unitStake,
    })
    .from(bets)
    .innerJoin(stages, eq(stages.id, bets.stageId))
    .where(and(eq(bets.projectId, projectId), eq(bets.status, 'PENDING'), isNull(bets.deletedAt)));
  for (const bet of pendingBets) {
    const effectiveAmount = bet.officialAmount ?? multiplyMoney(bet.unitStake, bet.stake);
    committed.set(bet.houseId, addMoney(committed.get(bet.houseId) ?? ZERO_MONEY, effectiveAmount));
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
