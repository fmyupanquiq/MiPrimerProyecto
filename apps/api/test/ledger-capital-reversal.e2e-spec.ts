import type { BetDetail } from '@letfer/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  financialMovements,
  type FinancialMovementRow,
  type NewFinancialMovement,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

interface AnalysisBody {
  profitLoss: string;
  totalStaked: string;
  roi: string | null;
  capitalInvested: string;
  deposits: string;
  withdrawals: string;
  extraordinary: string;
}
interface StatusBody {
  capitalActual: string;
}
interface PerformanceBody {
  points: { cumulativeProfitLoss: string }[];
}
interface IntegrityBody {
  status: string;
  findings: unknown[];
}

const REASON = 'Reversión de prueba';

/**
 * Fase 9.1.1 (ADR 0020, §113.8, C1): el capital invertido del dashboard y la invariante financiera
 * cuentan solo las filas VIGENTES del ledger. Un capital inicial, depósito, retiro o extraordinario
 * anulado por una `REVERSAL` deja de contar, y esa reversión no altera nada de las apuestas.
 * No hay endpoint que revierta estos movimientos todavía (lo hará la anulación de un lote), así que
 * las reversiones se insertan directamente, con el mismo esquema y disparador que exige la base.
 */
describe('reversión de movimientos que no son de apuesta (e2e, PostgreSQL real, §113.8)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let cookie: string;
  let projectId: string;
  let houseId: string;
  let stageId: string;
  let deposit: FinancialMovementRow;
  let withdrawal: FinancialMovementRow;
  let extraordinary: FinancialMovementRow;
  let initial: FinancialMovementRow;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const get = <T>(path: string) =>
    request(ctx.server)
      .get(api(path))
      .set('Cookie', cookie)
      .expect(200)
      .then((response) => response.body as T);
  const analysis = (query = '') => get<AnalysisBody>(`/dashboard/analysis${query}`);
  const invariant = () => assertFinancialInvariant(ctx, { projectId, cookie });

  async function insertMovement(
    overrides: Partial<NewFinancialMovement>,
  ): Promise<FinancialMovementRow> {
    const [row] = await ctx.t.db
      .insert(financialMovements)
      .values({
        projectId,
        stageId,
        houseId,
        type: 'DEPOSIT',
        direction: 'CREDIT',
        amount: '100.00',
        occurredAt: new Date('2026-06-01T10:00:00.000Z'),
        createdBy: owner.id,
        ...overrides,
      })
      .returning();
    return row!;
  }

  /** Reversión válida de `original`: dirección opuesta, mismo monto, casa, etapa y fecha efectiva. */
  const reverse = (original: FinancialMovementRow) =>
    insertMovement({
      type: 'REVERSAL',
      direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      amount: original.amount,
      houseId: original.houseId,
      stageId: original.stageId,
      operationId: original.operationId,
      occurredAt: original.occurredAt,
      reversesMovementId: original.id,
      reason: REASON,
    });

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Grupo' })).project.id;
    cookie = sessionCookie(await login(ctx.server, owner.email).expect(200))!;
    await request(ctx.server)
      .post(api('/setup'))
      .set('Cookie', cookie)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = (await get<{ id: string }[]>('/houses'))[0]!.id;
    stageId = (await get<{ id: string }[]>('/stages'))[0]!.id;
    initial = (
      await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.type, 'INITIAL_CAPITAL'))
    )[0]!;
    deposit = await insertMovement({ type: 'DEPOSIT', direction: 'CREDIT', amount: '100.00' });
    withdrawal = await insertMovement({
      type: 'WITHDRAWAL',
      direction: 'DEBIT',
      amount: '40.00',
      reason: 'Retiro de prueba',
    });
    extraordinary = await insertMovement({
      type: 'EXTRAORDINARY',
      direction: 'CREDIT',
      amount: '30.00',
      reason: 'Bono de prueba',
    });
  });

  it('antes de revertir nada, el ledger, el dashboard y la invariante coinciden', async () => {
    const before = await analysis();
    expect(before).toMatchObject({
      capitalInvested: '560.00', // 500 + 100 − 40
      deposits: '100.00',
      withdrawals: '40.00',
      extraordinary: '30.00',
    });
    const { ledgerTotal } = await invariant();
    expect(ledgerTotal).toBe('590.00'); // 560 + 30
  });

  const cases = [
    {
      name: 'INITIAL_CAPITAL',
      target: () => initial,
      expected: {
        capitalInvested: '60.00',
        deposits: '100.00',
        withdrawals: '40.00',
        extraordinary: '30.00',
      },
      ledger: '90.00',
    },
    {
      name: 'DEPOSIT',
      target: () => deposit,
      expected: {
        capitalInvested: '460.00',
        deposits: '0.00',
        withdrawals: '40.00',
        extraordinary: '30.00',
      },
      ledger: '490.00',
    },
    {
      name: 'WITHDRAWAL',
      target: () => withdrawal,
      expected: {
        capitalInvested: '600.00',
        deposits: '100.00',
        withdrawals: '0.00',
        extraordinary: '30.00',
      },
      ledger: '630.00',
    },
    {
      name: 'EXTRAORDINARY',
      target: () => extraordinary,
      expected: {
        capitalInvested: '560.00',
        deposits: '100.00',
        withdrawals: '40.00',
        extraordinary: '0.00',
      },
      ledger: '560.00',
    },
  ];

  it.each(cases)(
    'un $name revertido deja de contar en el capital y la invariante sigue cumpliéndose',
    async ({ target, expected, ledger }) => {
      await reverse(target());

      const after = await analysis();
      expect(after).toMatchObject(expected);
      const status = await get<StatusBody>('/dashboard/status');
      expect(status.capitalActual).toBe(ledger);
      const { ledgerTotal } = await invariant();
      expect(ledgerTotal).toBe(ledger);

      // Sin falsos positivos de integridad: la reversión de un movimiento no es de una apuesta.
      const integrity = (
        await request(ctx.server)
          .post(api('/integrity-checks'))
          .set('Cookie', cookie)
          .send({})
          .expect(201)
      ).body as IntegrityBody;
      expect(integrity).toMatchObject({ status: 'OK', findings: [] });
    },
  );

  it('revertir varios movimientos a la vez sigue cumpliendo la invariante', async () => {
    await reverse(deposit);
    await reverse(withdrawal);
    await reverse(extraordinary);
    const after = await analysis();
    expect(after).toMatchObject({
      capitalInvested: '500.00',
      deposits: '0.00',
      withdrawals: '0.00',
      extraordinary: '0.00',
    });
    expect((await invariant()).ledgerTotal).toBe('500.00');
  });

  it('el filtro de fechas usa la fecha efectiva de la fila anulada', async () => {
    await reverse(deposit);
    const range = '?from=2026-06-01T00:00:00.000Z&to=2026-06-02T00:00:00.000Z';
    const filtered = await analysis(range);
    expect(filtered).toMatchObject({ deposits: '0.00', withdrawals: '40.00' });
  });

  it('una reversión de capital no altera el cálculo de las apuestas', async () => {
    const created = (
      await request(ctx.server)
        .post(api('/bets'))
        .set('Cookie', cookie)
        .send({
          houseId,
          stake: '2.00',
          visibleTotalOdds: '1.95',
          placedAt: '2026-06-01T13:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Real Madrid vs. Barcelona',
              selection: 'Real Madrid gana',
              visibleOdds: '1.95',
            },
          ],
        })
        .expect(201)
    ).body as BetDetail;
    await request(ctx.server)
      .post(api(`/bets/${created.id}/settle`))
      .set('Cookie', cookie)
      .send({ status: 'WON', settledAt: '2026-06-01T14:00:00.000Z', version: created.version })
      .expect(200);

    const before = await analysis();
    const curveBefore = await get<PerformanceBody>('/dashboard/performance-chart');
    expect(before).toMatchObject({ profitLoss: '19.00', totalStaked: '20.00' });
    await invariant();

    await reverse(deposit);
    const after = await analysis();
    const curveAfter = await get<PerformanceBody>('/dashboard/performance-chart');
    expect(after.profitLoss).toBe(before.profitLoss);
    expect(after.totalStaked).toBe(before.totalStaked);
    expect(curveAfter).toEqual(curveBefore);
    // Solo cambia el capital invertido y, con él, el ROI.
    expect(after.capitalInvested).toBe('460.00');
    expect(after.roi).not.toBe(before.roi);
    await invariant();
  });
});
