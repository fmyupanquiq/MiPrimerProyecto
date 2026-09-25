import {
  addMoney,
  subtractMoney,
  ZERO_MONEY,
  type BetDetail,
  type BetLedgerHistory,
  type CorrectionPreview,
  type MoneyString,
} from '@letfer/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  betCorrections,
  bets,
  financialMovements,
  reconciliationCheckpoints,
  type UserRow,
} from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

type Actor = 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
  balance: string;
  committed: string;
  available: string;
}

const selection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};

const PLACED = '2026-06-01T13:00:00.000Z';
const SETTLED = '2026-06-01T14:00:00.000Z';
const REASON = 'Corrección de prueba';

/**
 * Fase 8.5.3 (§112.3, §112.4, §112.5, D-A4, D-A7, D-A10, D-A11): corregir, reabrir, eliminar y
 * restaurar apuestas liquidadas, con PostgreSQL real. Cada escenario cierra con el criterio de
 * aceptación: saldo del ledger = saldo del dashboard = saldo conciliable.
 */
describe('correcciones de apuestas liquidadas (e2e, PostgreSQL real, §112.3)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  let stageId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = ((await get('owner', '/houses').expect(200)).body as HouseBody[])[0]!.id;
    stageId = ((await get('owner', '/stages').expect(200)).body as { id: string }[])[0]!.id;
  });

  // --- Ayudas -----------------------------------------------------------------------------------

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const get = (actor: Actor, path: string) =>
    request(ctx.server).get(api(path)).set('Cookie', cookies[actor]);
  const post = (actor: Actor, path: string, body: object = {}) =>
    request(ctx.server).post(api(path)).set('Cookie', cookies[actor]).send(body);
  const reauth = (actor: Actor) =>
    request(ctx.server)
      .post('/api/auth/reauth')
      .set('Cookie', cookies[actor])
      .send({ password: TEST_PASSWORD })
      .expect(200);
  const expireReauth = () => ctx.clock.advanceSeconds(6 * 60);
  const relogin = async (actor: Actor) => {
    cookies[actor] = sessionCookie(await login(ctx.server, people[actor].email).expect(200))!;
  };
  const invariant = (options: { reconcile?: boolean } = {}) =>
    assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner, ...options });

  const newBet = async (overrides: Record<string, unknown> = {}) =>
    (
      await post('collab', '/bets', {
        houseId,
        stake: '2.00', // × unidad 10.00 = S/ 20.00
        visibleTotalOdds: '1.95', // retorno calculado S/ 39.00
        placedAt: PLACED,
        selections: [selection],
        ...overrides,
      }).expect(201)
    ).body as BetDetail;
  const detail = async (betId: string) =>
    (await get('owner', `/bets/${betId}`).expect(200)).body as BetDetail;
  /** Ganada de S/ 20.00 con retorno oficial (por defecto 39.00), colocada 13:00 y liquidada 14:00. */
  async function settledWin(
    official: string | null = '39.00',
    overrides: Record<string, unknown> = {},
  ): Promise<BetDetail> {
    const bet = await newBet(overrides);
    return (
      await post('admin', `/bets/${bet.id}/settle`, {
        status: 'WON',
        ...(official ? { officialRealizedReturn: official } : {}),
        settledAt: SETTLED,
        version: bet.version,
      }).expect(200)
    ).body as BetDetail;
  }
  const correct = (actor: Actor, bet: BetDetail, body: object, reason: string | null = REASON) =>
    post(actor, `/bets/${bet.id}/correct-settlement`, {
      version: bet.version,
      ...(reason === null ? {} : { reason }),
      ...body,
    });
  const preview = (actor: Actor, bet: BetDetail, body: object) =>
    post(actor, `/bets/${bet.id}/correct-settlement/preview`, {
      version: bet.version,
      reason: REASON,
      ...body,
    });
  const reopen = (actor: Actor, bet: BetDetail, body: object = {}) =>
    post(actor, `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON, ...body });
  const trash = (actor: Actor, bet: BetDetail, body: object = {}) =>
    post(actor, `/bets/${bet.id}/trash`, body);
  const restore = (actor: Actor, bet: BetDetail, body: object = {}) =>
    post(actor, `/bets/${bet.id}/restore`, body);
  const rowsOf = (betId: string) =>
    ctx.t.db.select().from(financialMovements).where(eq(financialMovements.operationId, betId));
  const allRows = () => ctx.t.db.select().from(financialMovements);
  const balances = async () =>
    ((await get('owner', '/houses').expect(200)).body as HouseBody[]).find(
      (house) => house.id === houseId,
    )!;
  const houseBalance = async () => (await balances()).balance;
  /** Efecto neto de la apuesta en el ledger (crédito − débito, con reversiones incluidas). */
  async function netEffect(betId: string): Promise<MoneyString> {
    return (await rowsOf(betId)).reduce<MoneyString>(
      (sum, row) =>
        row.direction === 'CREDIT' ? addMoney(sum, row.amount) : subtractMoney(sum, row.amount),
      ZERO_MONEY,
    );
  }
  /** Una liquidada en el dashboard tiene por efecto su ganancia; pendiente o eliminada, cero. */
  async function expectNetMatchesProfit(betId: string): Promise<void> {
    const row = (await ctx.t.db.select().from(bets).where(eq(bets.id, betId)))[0]!;
    const net = await netEffect(betId);
    if (row.status === 'PENDING' || row.deletedAt) {
      expect(net, `efecto neto de ${betId} (pendiente o eliminada)`).toBe('0.00');
    } else {
      expect(net, `efecto neto de ${betId}`).toBe((await detail(betId)).profitLoss);
    }
  }
  async function dbMovement(
    type: 'WITHDRAWAL' | 'DEPOSIT',
    amount: string,
    occurredAt: string,
  ): Promise<void> {
    await ctx.t.db.insert(financialMovements).values({
      projectId,
      stageId,
      type,
      direction: type === 'DEPOSIT' ? 'CREDIT' : 'DEBIT',
      houseId,
      amount,
      ...(type === 'WITHDRAWAL' ? { reason: 'Retiro de prueba' } : {}),
      occurredAt: new Date(occurredAt),
      createdBy: people.owner.id,
    });
  }
  async function checkpointAt(clockIso: string, officialAvailable: string) {
    ctx.clock.set(clockIso);
    // Un salto largo de reloj caduca las sesiones temporales (1 h de inactividad).
    await relogin('admin');
    await relogin('owner');
    return (
      await post('admin', `/houses/${houseId}/reconciliations`, { officialAvailable }).expect(201)
    ).body as { id: string; status: string };
  }
  const checkpointStatuses = async () =>
    (await ctx.t.db.select().from(reconciliationCheckpoints)).map((row) => row.status);

  // --- Permisos y reautenticación ----------------------------------------------------------------

  describe('permisos y reautenticación (D-A8, D-A11)', () => {
    it('solo el Administrador de Proyecto corrige, reabre y previsualiza; el Colaborador no, ni en su propia apuesta', async () => {
      const bet = await settledWin();
      for (const actor of ['collab', 'reader'] as const) {
        expect((await correct(actor, bet, { officialRealizedReturn: '40.00' })).status).toBe(403);
        expect((await preview(actor, bet, { officialRealizedReturn: '40.00' })).status).toBe(403);
        expect((await reopen(actor, bet)).status).toBe(403);
        expect((await get(actor, `/bets/${bet.id}/ledger`)).status).toBe(200); // ver es de todos
      }
      expect((await correct('stranger', bet, { officialRealizedReturn: '40.00' })).status).toBe(
        404,
      );
      expect((await detail(bet.id)).officialRealizedReturn).toBe('39.00');

      await correct('admin', bet, { officialRealizedReturn: '40.00' }).expect(200);
      const next = await detail(bet.id);
      await correct('owner', next, { officialRealizedReturn: '41.00' }).expect(200);
    });

    it('corregir y reabrir exigen reautenticación reciente; la vista previa no', async () => {
      const bet = await settledWin();
      expireReauth();
      for (const attempt of [
        await correct('admin', bet, { officialRealizedReturn: '40.00' }),
        await reopen('admin', bet),
      ]) {
        expect(attempt.status).toBe(403);
        expect(bodyOf(attempt).code).toBe('REAUTH_REQUIRED');
      }
      await preview('admin', bet, { officialRealizedReturn: '40.00' }).expect(200);
      expect((await detail(bet.id)).status).toBe('WON');
      await reauth('admin');
      await correct('admin', bet, { officialRealizedReturn: '40.00' }).expect(200);
    });

    it('un identificador mal formado responde 404', async () => {
      await post('admin', '/bets/no-es-un-uuid/correct-settlement', {
        version: 1,
        reason: REASON,
        status: 'LOST',
      }).expect(404);
      await post('admin', '/bets/no-es-un-uuid/reopen', { version: 1, reason: REASON }).expect(404);
    });
  });

  // --- Corregir la liquidación -------------------------------------------------------------------

  describe('corregir la liquidación (§112.3)', () => {
    it('corregir el retorno revierte la liquidación y registra la nueva, con corrección y auditoría', async () => {
      const bet = await settledWin();
      const corrected = (
        await correct('admin', bet, { officialRealizedReturn: '45.00' }).expect(200)
      ).body as BetDetail;
      expect(corrected).toMatchObject({
        status: 'WON',
        officialRealizedReturn: '45.00',
        returnSource: 'OFFICIAL',
        profitLoss: '25.00',
      });

      const rows = await rowsOf(bet.id);
      const reversal = rows.find((row) => row.type === 'REVERSAL')!;
      expect(reversal).toMatchObject({ direction: 'DEBIT', amount: '39.00', reason: REASON });
      expect(reversal.occurredAt.toISOString()).toBe(SETTLED); // D-A2
      expect(await houseBalance()).toBe('525.00'); // 500 − 20 + 45
      await expectNetMatchesProfit(bet.id);

      const [correction] = await ctx.t.db.select().from(betCorrections);
      expect(correction).toMatchObject({
        kind: 'SETTLEMENT_CORRECTION',
        betId: bet.id,
        reason: REASON,
        createdBy: people.admin.id,
        before: { officialRealizedReturn: '39.00' },
        after: { officialRealizedReturn: '45.00' },
      });
      expect(reversal.correctionId).toBe(correction!.id);
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.settlement_corrected'));
      expect(log).toMatchObject({
        entityId: bet.id,
        projectId,
        actorUserId: people.admin.id,
        oldValues: { officialRealizedReturn: '39.00' },
        newValues: { officialRealizedReturn: '45.00' },
        metadata: { correctionId: correction!.id, reason: REASON, ledgerChanged: true },
      });
      await invariant({ reconcile: true });
    });

    it('valida el cuerpo: motivo obligatorio, al menos un cambio, sin retorno en una perdida, cash out con retorno', async () => {
      const bet = await settledWin();
      expect((await correct('admin', bet, { status: 'LOST' }, null)).status).toBe(400);
      expect((await correct('admin', bet, { status: 'LOST' }, '   ')).status).toBe(400);
      expect((await correct('admin', bet, {})).status).toBe(400); // sin ningún cambio
      expect(
        (await correct('admin', bet, { status: 'LOST', officialRealizedReturn: '5.00' })).status,
      ).toBe(400);
      expect((await correct('admin', bet, { status: 'CASHOUT' })).status).toBe(400);
      expect((await correct('admin', bet, { officialAmount: '0.00' })).status).toBe(400);
      expect((await detail(bet.id)).status).toBe('WON');
    });

    it('rechaza una corrección que no cambia nada, una versión antigua y una apuesta pendiente', async () => {
      const bet = await settledWin();
      const same = await correct('admin', bet, { officialRealizedReturn: '39.00' });
      expect(same.status).toBe(409);
      expect(bodyOf(same).message).toContain('no cambia nada');
      expect(
        (
          await post('admin', `/bets/${bet.id}/correct-settlement`, {
            version: bet.version + 4,
            reason: REASON,
            status: 'LOST',
          })
        ).status,
      ).toBe(409);
      const pending = await newBet();
      expect((await correct('admin', pending, { status: 'LOST' })).status).toBe(409);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(0);
    });

    it('recorre todos los estados: el efecto neto de la apuesta siempre es su ganancia', async () => {
      let bet = await settledWin();
      const step = async (body: object, expected: { balance: string; profit: string | null }) => {
        bet = (await correct('admin', bet, body).expect(200)).body as BetDetail;
        expect(await houseBalance()).toBe(expected.balance);
        expect(bet.profitLoss).toBe(expected.profit);
        await expectNetMatchesProfit(bet.id);
        await invariant();
      };
      await expectNetMatchesProfit(bet.id);
      await step({ status: 'LOST' }, { balance: '480.00', profit: '-20.00' });
      expect(bet).toMatchObject({ officialRealizedReturn: null, returnSource: null });
      await step({ status: 'WON' }, { balance: '519.00', profit: '19.00' }); // retorno calculado
      expect(bet).toMatchObject({ officialRealizedReturn: null, returnSource: 'CALCULATED' });
      await step({ status: 'VOID' }, { balance: '500.00', profit: '0.00' }); // retorno = monto
      expect(bet).toMatchObject({ officialRealizedReturn: '20.00', returnSource: 'OFFICIAL' });
      await step(
        { status: 'CASHOUT', officialRealizedReturn: '12.50' },
        { balance: '492.50', profit: '-7.50' },
      );
      await step(
        { status: 'WON', officialRealizedReturn: '41.00' },
        { balance: '521.00', profit: '21.00' },
      );
      expect(bet.calculatedRealizedReturn).toBe('39.00'); // se conserva para comparar
      await invariant({ reconcile: true });
    });

    it('corregir el monto oficial recalcula el retorno calculado y lo marca confirmado', async () => {
      const bet = await settledWin();
      const corrected = (await correct('admin', bet, { officialAmount: '25.00' }).expect(200))
        .body as BetDetail;
      expect(corrected).toMatchObject({
        officialAmount: '25.00',
        amountSource: 'CONFIRMED',
        calculatedRealizedReturn: '48.75', // 25.00 × 1.95
        officialRealizedReturn: '39.00', // el oficial es la autoridad: no se toca
        profitLoss: '14.00',
      });
      expect(await houseBalance()).toBe('514.00'); // 500 − 25 + 39
      await expectNetMatchesProfit(bet.id);

      const voided = await settledWin(null, { placedAt: '2026-06-01T13:10:00.000Z' });
      const asVoid = (await correct('admin', voided, { status: 'VOID' }).expect(200))
        .body as BetDetail;
      const withAmount = (await correct('admin', asVoid, { officialAmount: '30.00' }).expect(200))
        .body as BetDetail;
      expect(withAmount).toMatchObject({ officialRealizedReturn: '30.00', profitLoss: '0.00' });
      await expectNetMatchesProfit(voided.id);
      await invariant({ reconcile: true });
    });

    it('corregir las fechas mueve las filas correspondientes del ledger (F2)', async () => {
      const bet = await settledWin();
      await correct('admin', bet, { placedAt: '2026-06-01T12:30:00.000Z' }).expect(200);
      let live = (await get('owner', `/bets/${bet.id}/ledger`).expect(200))
        .body as BetLedgerHistory;
      const livePlacement = live.movements.find((m) => m.live && m.type === 'BET_PLACEMENT')!;
      expect(livePlacement.occurredAt).toBe('2026-06-01T12:30:00.000Z');
      expect((await detail(bet.id)).placedAt).toBe('2026-06-01T12:30:00.000Z');

      const next = await detail(bet.id);
      await correct('admin', next, { settledAt: '2026-06-01T15:00:00.000Z' }).expect(200);
      live = (await get('owner', `/bets/${bet.id}/ledger`).expect(200)).body as BetLedgerHistory;
      expect(live.movements.find((m) => m.live && m.type === 'BET_SETTLEMENT')!.occurredAt).toBe(
        '2026-06-01T15:00:00.000Z',
      );
      await expectNetMatchesProfit(bet.id);
      await invariant({ reconcile: true });
    });

    it('un cambio sin efecto en el ledger (solo una marca) queda como corrección auditada sin filas nuevas', async () => {
      const bet = await settledWin();
      const before = (await allRows()).length;
      await correct('admin', bet, { placedTimeKnown: false }).expect(200);
      expect(await allRows()).toHaveLength(before);
      const [correction] = await ctx.t.db.select().from(betCorrections);
      expect(correction).toMatchObject({ kind: 'SETTLEMENT_CORRECTION' });
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.settlement_corrected'));
      expect(log!.metadata).toMatchObject({ ledgerChanged: false });
    });

    it('la fecha de colocación no puede ser posterior a la de liquidación, en ningún camino (D-A10)', async () => {
      const bet = await settledWin();
      const late = await correct('admin', bet, { placedAt: '2026-06-01T15:00:00.000Z' });
      expect(late.status).toBe(400);
      expect(bodyOf(late).message).toContain('colocación');
      expect((await correct('admin', bet, { settledAt: '2026-06-01T12:59:00.000Z' })).status).toBe(
        400,
      );

      // Editar directamente una liquidada ya no cambia su fecha de colocación: mueve el ledger.
      const edited = await request(ctx.server)
        .patch(api(`/bets/${bet.id}`))
        .set('Cookie', cookies.admin)
        .send({ placedAt: '2026-06-05T10:00:00.000Z', version: bet.version });
      expect(edited.status).toBe(409);
      expect((await detail(bet.id)).placedAt).toBe(PLACED);

      // Liquidar antes de colocar tampoco.
      const pending = await newBet({ placedAt: '2026-06-01T13:30:00.000Z' });
      const early = await post('admin', `/bets/${pending.id}/settle`, {
        status: 'LOST',
        settledAt: '2026-06-01T13:00:00.000Z',
        version: pending.version,
      });
      expect(early.status).toBe(400);
      // Editar la fecha de una pendiente sí se permite.
      await request(ctx.server)
        .patch(api(`/bets/${pending.id}`))
        .set('Cookie', cookies.admin)
        .send({ placedAt: '2026-06-01T13:45:00.000Z', version: pending.version })
        .expect(200);
    });
  });

  // --- Vista previa ------------------------------------------------------------------------------

  describe('vista previa (§112.3)', () => {
    it('describe lo que se aplicaría y no escribe nada', async () => {
      const bet = await settledWin();
      const rowsBefore = await allRows();
      const previewed = (
        await preview('admin', bet, { officialRealizedReturn: '45.00' }).expect(200)
      ).body as CorrectionPreview;

      expect(previewed).toMatchObject({
        kind: 'SETTLEMENT_CORRECTION',
        valid: true,
        ledgerChanged: true,
        conflicts: [],
        availabilityProblems: [],
        profitLossBefore: '19.00',
        profitLossAfter: '25.00',
      });
      expect(previewed.reversals).toEqual([
        {
          type: 'REVERSAL',
          direction: 'DEBIT',
          houseId,
          houseName: 'Betano',
          amount: '39.00',
          occurredAt: SETTLED,
          reverses: 'BET_SETTLEMENT',
        },
      ]);
      expect(previewed.inserts).toEqual([
        {
          type: 'BET_SETTLEMENT',
          direction: 'CREDIT',
          houseId,
          houseName: 'Betano',
          amount: '45.00',
          occurredAt: SETTLED,
        },
      ]);
      expect(previewed.balances).toEqual([
        {
          houseId,
          houseName: 'Betano',
          balanceBefore: '519.00',
          balanceAfter: '525.00',
          availableBefore: '519.00',
          availableAfter: '525.00',
        },
      ]);

      // Nada cambió: ni filas, ni la apuesta, ni correcciones, ni auditoría.
      expect(await allRows()).toHaveLength(rowsBefore.length);
      expect((await detail(bet.id)).version).toBe(bet.version);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(0);
      expect(
        await ctx.t.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'bet.settlement_corrected')),
      ).toHaveLength(0);

      // Y lo aplicado coincide con lo previsto.
      await correct('admin', bet, { officialRealizedReturn: '45.00' }).expect(200);
      expect(await houseBalance()).toBe(previewed.balances[0]!.balanceAfter);
      expect((await detail(bet.id)).profitLoss).toBe(previewed.profitLossAfter);
    });

    it('una corrección imposible se previsualiza como no válida (200) y al aplicarla se rechaza (409)', async () => {
      const bet = await settledWin();
      await dbMovement('WITHDRAWAL', '519.00', '2026-06-01T16:00:00.000Z'); // solo cabe con el retorno
      const previewed = (await preview('admin', bet, { status: 'LOST' }).expect(200))
        .body as CorrectionPreview;
      expect(previewed.valid).toBe(false);
      expect(previewed.conflicts).toHaveLength(1);
      expect(previewed.conflicts[0]).toMatchObject({
        houseId,
        houseName: 'Betano',
        occurredAt: '2026-06-01T16:00:00.000Z',
        balance: '-39.00',
      });
      const response = await correct('admin', bet, { status: 'LOST' });
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('CORRECTION_CONFLICT');
    });

    it('lista los checkpoints que se invalidarían y solo los afectados', async () => {
      const bet = await settledWin();
      const early = await checkpointAt('2026-06-01T12:30:00.000Z', '519.00'); // antes de las filas
      const late = await checkpointAt('2026-06-01T15:00:00.000Z', '519.00'); // después
      const previewed = (
        await preview('admin', bet, { officialRealizedReturn: '45.00' }).expect(200)
      ).body as CorrectionPreview;
      expect(previewed.checkpointsToInvalidate.map((c) => c.id)).toEqual([late.id]);
      expect(await checkpointStatuses()).toEqual(['MATCHED', 'MATCHED']);

      await correct('admin', bet, { officialRealizedReturn: '45.00' }).expect(200);
      const statuses = await ctx.t.db.select().from(reconciliationCheckpoints);
      expect(statuses.find((c) => c.id === early.id)!.status).toBe('MATCHED');
      expect(statuses.find((c) => c.id === late.id)).toMatchObject({ status: 'INVALIDATED' });
      expect(statuses.find((c) => c.id === late.id)!.invalidatedReason).toContain(
        'SETTLEMENT_CORRECTION',
      );
    });
  });

  // --- Conflictos históricos y comprometido histórico --------------------------------------------

  describe('validación histórica y comprometido histórico (§74, D-A5)', () => {
    it('rechaza una corrección que dejaría el historial en negativo y no cambia nada', async () => {
      const bet = await settledWin();
      await dbMovement('WITHDRAWAL', '519.00', '2026-06-01T16:00:00.000Z');
      const rowsBefore = await allRows();
      const response = await correct('admin', bet, { status: 'LOST' });
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('CORRECTION_CONFLICT');
      expect(await allRows()).toHaveLength(rowsBefore.length);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(0);
      expect((await detail(bet.id)).version).toBe(bet.version);
    });

    it('reabrir no libera retroactivamente el dinero que la apuesta ya tenía comprometido', async () => {
      // Apuesta de S/ 60 ganada con retorno de S/ 60; un retiro de todo el saldo entre la liquidación
      // y un depósito posterior. Con la apuesta pendiente (comprometida desde su colocación) ese retiro
      // habría sido imposible, aunque hoy el disponible alcance: solo la línea de tiempo lo detecta.
      const bet = await settledWin('60.00', { stake: '6.00' });
      await dbMovement('WITHDRAWAL', '500.00', '2026-06-01T15:00:00.000Z');
      await dbMovement('DEPOSIT', '500.00', '2026-06-01T16:00:00.000Z');
      expect((await balances()).available).toBe('500.00');

      const response = await reopen('admin', bet);
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('CORRECTION_CONFLICT');
      const details = bodyOf(response).details as unknown as {
        conflicts: { occurredAt: string; balance: string; pendingIds: string[] }[];
      };
      expect(details.conflicts[0]).toMatchObject({
        occurredAt: '2026-06-01T15:00:00.000Z',
        balance: '-60.00',
        pendingIds: [bet.id],
      });
      expect((await detail(bet.id)).status).toBe('WON');
    });

    it('las demás apuestas pendientes también pesan en el historial: no se reabre sobre su reserva', async () => {
      // Con otra apuesta pendiente de S/ 460 (placedAt 13:30) y un retiro de S/ 40 a las 15:00, el
      // saldo histórico es justo; reabrir la ganada de S/ 20 (colocada 13:00) lo dejaría en negativo.
      const bet = await settledWin('20.00', { stake: '2.00' });
      await newBet({ stake: '46.00', placedAt: '2026-06-01T13:30:00.000Z' }); // 460.00 pendientes
      await dbMovement('WITHDRAWAL', '30.00', '2026-06-01T15:00:00.000Z');
      const response = await reopen('admin', bet);
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('CORRECTION_CONFLICT');
      const details = bodyOf(response).details as unknown as {
        conflicts: { pendingIds: string[] }[];
      };
      expect(details.conflicts[0]!.pendingIds).toContain(bet.id);
      expect(details.conflicts[0]!.pendingIds).toHaveLength(2);
    });
  });

  // --- Reabrir -----------------------------------------------------------------------------------

  describe('reabrir una liquidada (D-A4)', () => {
    it('vuelve a PENDING, revierte todo su efecto y conserva los valores históricos', async () => {
      const bet = await settledWin('38.50'); // calculado 39.00, oficial 38.50
      expect(bet).toMatchObject({
        calculatedRealizedReturn: '39.00',
        officialRealizedReturn: '38.50',
      });
      const reopened = (await reopen('admin', bet).expect(200)).body as BetDetail;

      expect(reopened).toMatchObject({
        status: 'PENDING',
        settledAt: null,
        officialRealizedReturn: null,
        calculatedRealizedReturn: null,
        returnSource: null,
        profitLoss: null,
      });
      expect(await balances()).toMatchObject({
        balance: '500.00',
        committed: '20.00',
        available: '480.00',
      });
      expect(await netEffect(bet.id)).toBe('0.00');

      // Los valores anteriores no se pierden: quedan en la corrección y en la auditoría.
      const [correction] = await ctx.t.db.select().from(betCorrections);
      expect(correction).toMatchObject({
        kind: 'REOPEN',
        reason: REASON,
        before: {
          status: 'WON',
          officialRealizedReturn: '38.50',
          calculatedRealizedReturn: '39.00',
          settledAt: SETTLED,
        },
        after: { status: 'PENDING', officialRealizedReturn: null, calculatedRealizedReturn: null },
      });
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.reopened'));
      expect(log).toMatchObject({
        oldValues: { officialRealizedReturn: '38.50', calculatedRealizedReturn: '39.00' },
        newValues: { status: 'PENDING' },
      });

      // El historial financiero completo sigue ahí: filas originales, reversiones y la corrección.
      const history = (await get('reader', `/bets/${bet.id}/ledger`).expect(200))
        .body as BetLedgerHistory;
      expect(history.movements.map((m) => [m.type, m.live])).toEqual([
        ['BET_PLACEMENT', false],
        ['REVERSAL', false],
        ['BET_SETTLEMENT', false],
        ['REVERSAL', false],
      ]);
      expect(history.corrections).toHaveLength(1);
      expect(history.corrections[0]).toMatchObject({ kind: 'REOPEN', reason: REASON });
      await invariant({ reconcile: true });
    });

    it('la nueva liquidación genera valores nuevos sin borrar los anteriores', async () => {
      const bet = await settledWin('38.50');
      const reopened = (await reopen('admin', bet).expect(200)).body as BetDetail;
      const again = (
        await post('admin', `/bets/${bet.id}/settle`, {
          status: 'WON',
          settledAt: '2026-06-01T17:00:00.000Z',
          version: reopened.version,
        }).expect(200)
      ).body as BetDetail;
      expect(again).toMatchObject({
        status: 'WON',
        officialRealizedReturn: null,
        calculatedRealizedReturn: '39.00',
        returnSource: 'CALCULATED',
      });
      const rows = await rowsOf(bet.id);
      expect(rows).toHaveLength(6); // 2 originales + 2 reversiones + 2 nuevas: nada se borró
      const history = (await get('owner', `/bets/${bet.id}/ledger`).expect(200))
        .body as BetLedgerHistory;
      expect(history.movements.filter((m) => m.live).map((m) => [m.type, m.amount])).toEqual([
        ['BET_PLACEMENT', '20.00'],
        ['BET_SETTLEMENT', '39.00'],
      ]);
      // La corrección del reabrir conserva el retorno oficial anterior.
      expect(history.corrections[0]!.before).toMatchObject({ officialRealizedReturn: '38.50' });
      await expectNetMatchesProfit(bet.id);
      await invariant({ reconcile: true });
    });

    it('un monto solo calculado vuelve a seguir la unidad de la etapa; uno confirmado se conserva', async () => {
      const calculated = await settledWin('39.00');
      expect(calculated).toMatchObject({ officialAmount: '20.00', amountSource: 'CALCULATED' });
      const a = (await reopen('admin', calculated).expect(200)).body as BetDetail;
      expect(a).toMatchObject({
        officialAmount: null,
        amountSource: 'CALCULATED',
        effectiveAmount: '20.00',
      });

      const confirmed = await settledWin('39.00', {
        officialAmount: '25.00',
        placedAt: '2026-06-01T13:10:00.000Z',
      });
      const b = (await reopen('admin', confirmed).expect(200)).body as BetDetail;
      expect(b).toMatchObject({ officialAmount: '25.00', amountSource: 'CONFIRMED' });
      await invariant();
    });

    it('rechaza reabrir una pendiente, una eliminada, sin motivo o con una reserva imposible', async () => {
      const pending = await newBet();
      expect((await reopen('admin', pending)).status).toBe(409);
      const bet = await settledWin();
      expect((await reopen('admin', bet, { reason: '  ' })).status).toBe(400);
      expect((await reopen('admin', bet, { version: bet.version + 3 })).status).toBe(409);
      await trash('admin', bet, { reason: 'Error de registro' }).expect(200);
      expect((await reopen('admin', bet)).status).toBe(409); // en la papelera
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(1);
    });

    it('la vista previa de reabrir muestra el efecto y no escribe', async () => {
      const bet = await settledWin();
      const rowsBefore = await allRows();
      const previewed = (
        await post('admin', `/bets/${bet.id}/reopen/preview`, {
          version: bet.version,
          reason: REASON,
        }).expect(200)
      ).body as CorrectionPreview;
      expect(previewed).toMatchObject({
        kind: 'REOPEN',
        valid: true,
        ledgerChanged: true,
        profitLossBefore: '19.00',
        profitLossAfter: null,
      });
      expect(previewed.reversals).toHaveLength(2);
      expect(previewed.balances[0]).toMatchObject({
        balanceBefore: '519.00',
        balanceAfter: '500.00',
        availableAfter: '480.00', // vuelve a comprometer su monto
      });
      expect(await allRows()).toHaveLength(rowsBefore.length);
      expect((await detail(bet.id)).status).toBe('WON');
    });
  });

  // --- Papelera y restauración -------------------------------------------------------------------

  describe('papelera y restauración de una liquidada (D-A7, D-A11)', () => {
    it('exige bets.correct, reautenticación y motivo; el Colaborador solo elimina pendientes', async () => {
      const bet = await settledWin();
      expect((await trash('collab', bet, { reason: 'x' })).status).toBe(403); // su propia liquidada
      const pending = await newBet({ placedAt: '2026-06-01T13:20:00.000Z' });
      await trash('collab', pending).expect(200); // pendiente: como siempre

      const noReason = await trash('admin', bet);
      expect(noReason.status).toBe(400);
      expireReauth();
      const noReauth = await trash('admin', bet, { reason: 'Error de registro' });
      expect(noReauth.status).toBe(403);
      expect(bodyOf(noReauth).code).toBe('REAUTH_REQUIRED');
      expect((await detail(bet.id)).deletedAt).toBeNull();
    });

    it('enviarla a la papelera revierte todo su efecto: saldo y dashboard coinciden (F1)', async () => {
      const bet = await settledWin();
      expect(await houseBalance()).toBe('519.00');
      await trash('admin', bet, { reason: 'Registrada por error' }).expect(200);

      expect(await houseBalance()).toBe('500.00');
      expect(await netEffect(bet.id)).toBe('0.00');
      const row = (await ctx.t.db.select().from(bets).where(eq(bets.id, bet.id)))[0]!;
      // Los valores de la liquidación se conservan en la apuesta eliminada.
      expect(row).toMatchObject({
        status: 'WON',
        officialRealizedReturn: '39.00',
        deletionReason: 'Registrada por error',
      });
      expect(row.deletedAt).not.toBeNull();
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.trashed'));
      expect(log!.metadata).toMatchObject({ ledgerReversal: true, reason: 'Registrada por error' });
      const [correction] = await ctx.t.db.select().from(betCorrections);
      expect(correction).toMatchObject({ kind: 'TRASH_REVERSAL', reason: 'Registrada por error' });
      await invariant({ reconcile: true });
    });

    it('restaurarla vuelve a registrar su efecto con filas nuevas; exige motivo y reautenticación', async () => {
      const bet = await settledWin();
      await trash('admin', bet, { reason: 'Registrada por error' }).expect(200);
      expect((await restore('admin', bet)).status).toBe(400); // sin motivo
      expect((await restore('collab', bet, { reason: REASON })).status).toBe(403);
      expireReauth();
      expect(bodyOf(await restore('admin', bet, { reason: REASON })).code).toBe('REAUTH_REQUIRED');
      await reauth('admin');

      await restore('admin', bet, { reason: 'Era correcta' }).expect(200);
      expect(await houseBalance()).toBe('519.00');
      await expectNetMatchesProfit(bet.id);
      const rows = await rowsOf(bet.id);
      expect(rows).toHaveLength(6); // colocación, liquidación, 2 reversiones y 2 filas nuevas
      expect((await detail(bet.id)).deletedAt).toBeNull();
      const kinds = (await ctx.t.db.select().from(betCorrections)).map((c) => c.kind).sort();
      expect(kinds).toEqual(['RESTORE_REPOST', 'TRASH_REVERSAL']);
      await invariant({ reconcile: true });
    });

    it('restaurar se rechaza si el saldo ya no cubre lo que registraría, y sigue en la papelera', async () => {
      const bet = await settledWin();
      await trash('admin', bet, { reason: 'Registrada por error' }).expect(200);
      await dbMovement('WITHDRAWAL', '500.00', '2026-06-01T12:30:00.000Z'); // vacía la casa antes de apostar
      const response = await restore('admin', bet, { reason: REASON });
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('CORRECTION_CONFLICT');
      expect((await detail(bet.id)).deletedAt).not.toBeNull();
      expect(await rowsOf(bet.id)).toHaveLength(4); // sin filas nuevas
    });

    it('una apuesta en la papelera no admite otra eliminación; una pendiente conserva su flujo', async () => {
      const bet = await settledWin();
      await trash('admin', bet, { reason: 'Registrada por error' }).expect(200);
      expect((await trash('admin', bet, { reason: 'otra vez' })).status).toBe(409);

      const pending = await newBet({ placedAt: '2026-06-01T13:20:00.000Z' });
      await trash('admin', pending).expect(200);
      await restore('admin', pending).expect(200); // sin motivo ni reautenticación, como antes
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(1);
    });
  });

  // --- Checkpoints y concurrencia ----------------------------------------------------------------

  describe('checkpoints (§112.5)', () => {
    it('invalida solo los posteriores a la fecha más antigua afectada, y solo si el ledger cambia', async () => {
      const bet = await settledWin();
      const early = await checkpointAt('2026-06-01T12:30:00.000Z', '519.00');
      const late = await checkpointAt('2026-06-01T15:00:00.000Z', '519.00');

      // Una marca sin efecto en el ledger no invalida nada.
      await correct('admin', bet, { placedTimeKnown: false }).expect(200);
      expect(await checkpointStatuses()).toEqual(['MATCHED', 'MATCHED']);

      // Cambiar la liquidación (14:00) invalida el de las 15:00, no el de las 12:30.
      await correct('admin', await detail(bet.id), { officialRealizedReturn: '45.00' }).expect(200);
      const checkpoints = await ctx.t.db.select().from(reconciliationCheckpoints);
      expect(checkpoints.find((c) => c.id === early.id)!.status).toBe('MATCHED');
      expect(checkpoints.find((c) => c.id === late.id)!.status).toBe('INVALIDATED');
    });

    it('reabrir y eliminar invalidan desde la colocación', async () => {
      const bet = await settledWin();
      const between = await checkpointAt('2026-06-01T13:30:00.000Z', '519.00'); // entre colocar y liquidar
      await reopen('admin', bet).expect(200);
      const row = (
        await ctx.t.db
          .select()
          .from(reconciliationCheckpoints)
          .where(eq(reconciliationCheckpoints.id, between.id))
      )[0]!;
      expect(row.status).toBe('INVALIDATED');
    });
  });

  describe('concurrencia', () => {
    it('dos correcciones simultáneas con la misma versión: una se aplica y la otra recibe 409', async () => {
      const bet = await settledWin();
      const [a, b] = await Promise.all([
        correct('admin', bet, { officialRealizedReturn: '40.00' }),
        correct('owner', bet, { officialRealizedReturn: '41.00' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(1);
      await expectNetMatchesProfit(bet.id);
      await invariant();
    });

    it('corregir y reabrir a la vez: solo una de las dos prospera y el ledger queda coherente', async () => {
      const bet = await settledWin();
      const [a, b] = await Promise.all([
        correct('admin', bet, { status: 'LOST' }),
        reopen('owner', bet),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      await expectNetMatchesProfit(bet.id);
      await invariant();
    });
  });

  // --- Criterio de aceptación --------------------------------------------------------------------

  describe('criterio de aceptación: saldo ledger = saldo dashboard = saldo conciliable', () => {
    it('se mantiene tras liquidar, corregir, reabrir, eliminar y restaurar, paso a paso', async () => {
      await invariant();
      const a = await settledWin('39.00', { placedAt: '2026-06-01T13:01:00.000Z' });
      await invariant();
      const b = await newBet({ placedAt: '2026-06-01T13:02:00.000Z' });
      await invariant(); // pendiente: solo comprometido
      await post('admin', `/bets/${b.id}/settle`, {
        status: 'LOST',
        settledAt: SETTLED,
        version: b.version,
      }).expect(200);
      await invariant();
      await correct('admin', a, { officialRealizedReturn: '44.00' }).expect(200);
      await invariant();
      await correct('admin', await detail(a.id), { status: 'LOST' }).expect(200);
      await invariant();
      await reopen('admin', await detail(a.id)).expect(200);
      await invariant();
      await post('admin', `/bets/${a.id}/settle`, {
        status: 'WON',
        officialRealizedReturn: '41.00',
        settledAt: '2026-06-01T17:00:00.000Z',
        version: (await detail(a.id)).version,
      }).expect(200);
      await invariant();
      await trash('admin', await detail(a.id), { reason: 'Error' }).expect(200);
      await invariant();
      await restore('admin', await detail(a.id), { reason: 'Era correcta' }).expect(200);
      await invariant();
      await trash('admin', await detail(b.id), { reason: 'Otro error' }).expect(200);
      await invariant({ reconcile: true });
      for (const id of [a.id, b.id]) await expectNetMatchesProfit(id);
      expect(await houseBalance()).toBe('521.00'); // 500 − 20 + 41 (a); b eliminada (neto 0)
    });

    it('resiste una secuencia pseudoaleatoria de operaciones, incluidas las rechazadas', async () => {
      // Generador determinista (mulberry32): la misma secuencia en cada ejecución.
      let seed = 85;
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

      const ids = [
        (await newBet({ stake: '2.00', placedAt: '2026-06-01T13:00:00.000Z' })).id,
        (await newBet({ stake: '3.00', placedAt: '2026-06-01T13:10:00.000Z' })).id,
        (await newBet({ stake: '1.00', placedAt: '2026-06-01T13:20:00.000Z' })).id,
      ];
      const settleBodies = [
        { status: 'WON' },
        { status: 'WON', officialRealizedReturn: '40.00' },
        { status: 'LOST' },
        { status: 'VOID' },
        { status: 'CASHOUT', officialRealizedReturn: '10.00' },
      ];
      const correctionBodies = [
        { status: 'LOST' },
        { status: 'WON' },
        { status: 'VOID' },
        { status: 'CASHOUT', officialRealizedReturn: '15.00' },
        { officialRealizedReturn: '44.00' },
        { officialAmount: '25.00' },
        { settledAt: '2026-06-01T16:00:00.000Z' },
        { placedAt: '2026-06-01T12:45:00.000Z' },
      ];
      const outcomes: number[] = [];
      const applied: Record<string, number> = {};
      let mutations = 0;

      for (let index = 0; index < 45; index++) {
        await reauth('admin');
        const current = await detail(pick(ids));
        const trashed = current.deletedAt !== null;
        let response: request.Response;
        let label: string;
        if (trashed) {
          label = 'restore';
          response = await restore('admin', current, { reason: `Restauración ${index}` });
        } else if (current.status === 'PENDING') {
          label = 'settle';
          response =
            random() < 0.75
              ? await post('admin', `/bets/${current.id}/settle`, {
                  settledAt: '2026-06-01T14:00:00.000Z',
                  version: current.version,
                  ...pick(settleBodies),
                })
              : await trash('admin', current);
          if (response.status === 200 && label === 'settle' && current.deletedAt === null) {
            // `settle` y `trash` de una pendiente comparten rama: se distingue por el estado resultante.
            label = (await detail(current.id)).deletedAt ? 'trash-pending' : 'settle';
          }
        } else {
          const operation = pick(['correct', 'correct', 'reopen', 'trash', 'confirm'] as const);
          label = operation;
          if (operation === 'correct') {
            response = await correct('admin', current, pick(correctionBodies));
          } else if (operation === 'reopen') {
            response = await reopen('admin', current);
          } else if (operation === 'trash') {
            response = await trash('admin', current, { reason: `Eliminación ${index}` });
          } else {
            response = await post('admin', `/bets/${current.id}/confirm-return`, {
              version: current.version,
              officialRealizedReturn: pick(['39.00', '38.00', '41.00']),
              acknowledgeDifference: true,
            });
          }
        }
        outcomes.push(response.status);
        expect(response.status, `paso ${index}: ${JSON.stringify(response.body)}`).toBeLessThan(
          500,
        );
        if (response.status === 200) {
          mutations += 1;
          applied[label] = (applied[label] ?? 0) + 1;
        }
        await invariant();
      }

      expect(mutations, `resultados: ${outcomes.join(',')}`).toBeGreaterThanOrEqual(10);
      // La secuencia ejercita cada operación al menos una vez (si cambia la semilla, revisar).
      for (const operation of ['settle', 'correct', 'reopen', 'trash', 'restore']) {
        expect(applied[operation], `${operation}: ${JSON.stringify(applied)}`).toBeGreaterThan(0);
      }
      for (const id of ids) await expectNetMatchesProfit(id);
      await invariant({ reconcile: true });
    }, 120_000);
  });
});
