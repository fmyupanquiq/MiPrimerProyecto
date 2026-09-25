import {
  addMoney,
  multiplyMoney,
  percentageOf,
  subtractMoney,
  ZERO_MONEY,
  type MoneyString,
} from '@letfer/shared';
import { eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { expect } from 'vitest';
import { bets, financialMovements, stages } from '../../src/database/schema/index.js';
import type { TestApp } from './create-app.js';

interface HouseBody {
  id: string;
  balance: string;
  committed: string;
  available: string;
}
interface StatusBody {
  retornosPorConfirmar: number;
  capitalActual: string;
  disponible: string;
  comprometido: string;
  porCasa: { houseId: string; balance: string; committed: string; available: string }[];
}
interface AnalysisBody {
  profitLoss: string;
  yield: string | null;
  roi: string | null;
  totalStaked: string;
  capitalInvested: string;
  deposits: string;
  withdrawals: string;
  extraordinary: string;
  unconfirmedReturns: { count: number; profitLoss: string };
}
interface PerformanceBody {
  points: { cumulativeProfitLoss: string }[];
}
interface CheckpointBody {
  status: string;
  difference: string;
}
interface IntegrityBody {
  status: string;
  findings: { check: string; affected: string[] }[];
}

/**
 * Criterio de aceptación de la Fase 8.5 (ADR 0019, §112.6, §112.7): después de cualquier secuencia de
 * liquidar, confirmar, corregir, reabrir, enviar a la papelera y restaurar, se cumple
 *
 *   saldo del ledger = saldo del dashboard = saldo conciliable
 *
 * y, además:
 *  - el saldo del ledger es exactamente lo que dicen las apuestas y los movimientos:
 *    ledger = capital inicial + depósitos − retiros + extraordinarios + ganancia/pérdida de las apuestas
 *    (las transferencias suman cero);
 *  - el monto apostado, la ganancia/pérdida, el Yield y el ROI del dashboard coinciden con lo que
 *    dicen los datos de cada apuesta (que el dashboard calcula desde el ledger);
 *  - la curva de rendimiento termina en esa misma ganancia/pérdida;
 *  - el aviso de retornos por confirmar coincide con las ganadas provisionales;
 *  - la verificación de integridad no encuentra nada.
 *
 * Fuentes independientes: las filas crudas del ledger, los datos de cada apuesta, el dashboard y
 * la conciliación. Si alguna operación las deja desalineadas, esto falla.
 */
export async function assertFinancialInvariant(
  ctx: TestApp,
  options: { projectId: string; cookie: string; reconcile?: boolean },
): Promise<{ ledgerTotal: MoneyString }> {
  const base = `/api/projects/${options.projectId}`;
  const get = <T>(path: string) =>
    request(ctx.server)
      .get(`${base}${path}`)
      .set('Cookie', options.cookie)
      .expect(200)
      .then((response) => response.body as T);

  // 1. Ledger: se suman las filas crudas, sin pasar por ninguna función de la aplicación.
  const rows = await ctx.t.db.select().from(financialMovements);
  const perHouse = new Map<string, MoneyString>();
  let initial: MoneyString = ZERO_MONEY;
  const bump = (houseId: string | null, delta: (current: MoneyString) => MoneyString) => {
    if (houseId) perHouse.set(houseId, delta(perHouse.get(houseId) ?? ZERO_MONEY));
  };
  for (const row of rows.filter((r) => r.projectId === options.projectId)) {
    if (row.type === 'INITIAL_CAPITAL') initial = addMoney(initial, row.amount);
    if (row.houseId) {
      bump(row.houseId, (current) =>
        row.direction === 'DEBIT'
          ? subtractMoney(current, row.amount)
          : addMoney(current, row.amount),
      );
    } else {
      bump(row.fromHouseId, (current) => subtractMoney(current, row.amount));
      bump(row.toHouseId, (current) => addMoney(current, row.amount));
    }
  }
  const ledgerTotal = addMoney(...perHouse.values());

  // 2. Dashboard y listado de casas (ambos reconstruyen el saldo desde el ledger).
  const status = await get<StatusBody>('/dashboard/status');
  const houses = await get<HouseBody[]>('/houses');
  expect(status.capitalActual, 'capital actual del dashboard').toBe(ledgerTotal);
  for (const house of houses) {
    expect(house.balance, `saldo de la casa ${house.id} en el listado`).toBe(
      perHouse.get(house.id) ?? ZERO_MONEY,
    );
  }
  for (const item of status.porCasa) {
    expect(item.balance, `saldo de la casa ${item.houseId} en el dashboard`).toBe(
      perHouse.get(item.houseId) ?? ZERO_MONEY,
    );
  }

  // 3. Las apuestas dicen lo mismo que el ledger. Ganancia y monto apostado, según los datos de cada
  //    apuesta liquidada y no eliminada (retorno efectivo − monto; −monto si se perdió).
  const betRows = await ctx.t.db
    .select({ bet: bets, unitStake: stages.unitStake })
    .from(bets)
    .innerJoin(stages, eq(stages.id, bets.stageId))
    .where(isNull(bets.deletedAt));
  let expectedProfit: MoneyString = ZERO_MONEY;
  let expectedStaked: MoneyString = ZERO_MONEY;
  let expectedUnconfirmed = 0;
  let expectedUnconfirmedProfit: MoneyString = ZERO_MONEY;
  for (const { bet, unitStake } of betRows) {
    if (bet.projectId !== options.projectId || bet.status === 'PENDING') continue;
    const amount = bet.officialAmount ?? multiplyMoney(unitStake, bet.stakeAmount);
    const realized = bet.officialRealizedReturn ?? bet.calculatedRealizedReturn;
    const profit =
      bet.status === 'LOST' || realized === null
        ? subtractMoney(ZERO_MONEY, amount)
        : subtractMoney(realized, amount);
    expectedProfit = addMoney(expectedProfit, profit);
    expectedStaked = addMoney(expectedStaked, amount);
    if (bet.status === 'WON' && bet.officialRealizedReturn === null) {
      expectedUnconfirmed += 1;
      expectedUnconfirmedProfit = addMoney(expectedUnconfirmedProfit, profit);
    }
  }
  const analysis = await get<AnalysisBody>('/dashboard/analysis');
  expect(analysis.profitLoss, 'ganancia/pérdida del dashboard (desde el ledger)').toBe(
    expectedProfit,
  );
  expect(analysis.totalStaked, 'monto apostado del dashboard (desde el ledger)').toBe(
    expectedStaked,
  );
  expect(analysis.yield, 'Yield').toBe(percentageOf(expectedProfit, expectedStaked));
  expect(analysis.roi, 'ROI').toBe(percentageOf(expectedProfit, analysis.capitalInvested));
  expect(analysis.unconfirmedReturns, 'aviso de retornos no confirmados').toEqual({
    count: expectedUnconfirmed,
    profitLoss: expectedUnconfirmedProfit,
  });
  expect(status.retornosPorConfirmar, 'retornos por confirmar en el estado').toBe(
    expectedUnconfirmed,
  );

  const fromBets = addMoney(
    initial,
    analysis.deposits,
    subtractMoney(ZERO_MONEY, analysis.withdrawals),
    analysis.extraordinary,
    expectedProfit,
  );
  expect(fromBets, 'capital según apuestas y movimientos').toBe(ledgerTotal);

  // 4. La curva de rendimiento termina en la misma ganancia/pérdida (reversiones incluidas).
  const performance = await get<PerformanceBody>('/dashboard/performance-chart');
  const lastPoint = performance.points.at(-1)?.cumulativeProfitLoss ?? ZERO_MONEY;
  expect(lastPoint, 'último punto de la curva de rendimiento').toBe(expectedProfit);

  // 5. Integridad automática: ningún hallazgo (solo lectura).
  const integrity = (
    await request(ctx.server)
      .post(`${base}/integrity-checks`)
      .set('Cookie', options.cookie)
      .send({})
      .expect(201)
  ).body as IntegrityBody;
  expect(integrity.findings, 'hallazgos de la verificación de integridad').toEqual([]);
  expect(integrity.status).toBe('OK');

  // 6. Saldo conciliable: declarar el disponible que muestra LetFer siempre coincide.
  if (options.reconcile) {
    for (const house of houses) {
      const checkpoint = (
        await request(ctx.server)
          .post(`${base}/houses/${house.id}/reconciliations`)
          .set('Cookie', options.cookie)
          .send({ officialAvailable: house.available })
          .expect(201)
      ).body as CheckpointBody;
      expect(checkpoint, `conciliación de la casa ${house.id}`).toMatchObject({
        status: 'MATCHED',
        difference: '0.00',
      });
    }
  }
  return { ledgerTotal };
}
