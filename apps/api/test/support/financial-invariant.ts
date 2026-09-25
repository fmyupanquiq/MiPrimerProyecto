import { addMoney, subtractMoney, ZERO_MONEY, type MoneyString } from '@letfer/shared';
import request from 'supertest';
import { expect } from 'vitest';
import { financialMovements } from '../../src/database/schema/index.js';
import type { TestApp } from './create-app.js';

interface HouseBody {
  id: string;
  balance: string;
  committed: string;
  available: string;
}
interface StatusBody {
  capitalActual: string;
  disponible: string;
  comprometido: string;
  porCasa: { houseId: string; balance: string; committed: string; available: string }[];
}
interface AnalysisBody {
  profitLoss: string;
  deposits: string;
  withdrawals: string;
  extraordinary: string;
}
interface CheckpointBody {
  status: string;
  difference: string;
}

/**
 * Criterio de aceptación de la Fase 8.5 (ADR 0019, §112.6): después de cualquier secuencia de
 * liquidar, confirmar, corregir, reabrir, enviar a la papelera y restaurar, se cumple
 *
 *   saldo del ledger = saldo del dashboard = saldo conciliable
 *
 * y, además, el saldo del ledger es exactamente lo que dicen las apuestas y los movimientos:
 *
 *   ledger = capital inicial + depósitos − retiros + extraordinarios + ganancia/pérdida de las apuestas
 *
 * (las transferencias suman cero). Tres fuentes independientes: las filas crudas del ledger, el
 * dashboard (que calcula el P/L desde `bets`) y la conciliación. Si alguna corrección deja el
 * ledger y las apuestas desalineadas, esto falla.
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

  // 3. Las apuestas dicen lo mismo que el ledger: capital + movimientos + P/L de las apuestas.
  const analysis = await get<AnalysisBody>('/dashboard/analysis');
  const fromBets = addMoney(
    initial,
    analysis.deposits,
    subtractMoney(ZERO_MONEY, analysis.withdrawals),
    analysis.extraordinary,
    analysis.profitLoss,
  );
  expect(fromBets, 'capital según apuestas y movimientos').toBe(ledgerTotal);

  // 4. Saldo conciliable: declarar el disponible que muestra LetFer siempre coincide.
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
