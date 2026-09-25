import type {
  BetDetail,
  ReturnDifferencesReport,
  ReturnMismatchDetails,
  UnconfirmedReturnItem,
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

/**
 * Fase 8.5.2 (§77, §112.2, D-A3, D-A8, D-A12): liquidación provisional, confirmación del retorno
 * oficial y reportes, con PostgreSQL real. Cada escenario termina comprobando el criterio de
 * aceptación de la fase: saldo del ledger = saldo del dashboard = saldo conciliable.
 */
describe('retorno calculado y retorno oficial (e2e, PostgreSQL real, §77, §112.2)', () => {
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
  /** Tras un salto de reloj largo la sesión temporal caduca (1 h de inactividad): se vuelve a entrar. */
  const relogin = async (actor: Actor) => {
    cookies[actor] = sessionCookie(await login(ctx.server, people[actor].email).expect(200))!;
  };
  /** Deja pasar la ventana de reautenticación reciente (5 minutos, §104.5). */
  const expireReauth = () => ctx.clock.advanceSeconds(6 * 60);
  const invariant = (options: { reconcile?: boolean } = {}) =>
    assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner, ...options });

  const newBet = async (overrides: Record<string, unknown> = {}) =>
    (
      await post('collab', '/bets', {
        houseId,
        stake: '2.00', // × unidad 10.00 = S/ 20.00
        visibleTotalOdds: '1.95', // cuota → retorno calculado S/ 39.00
        placedAt: PLACED,
        selections: [selection],
        ...overrides,
      }).expect(201)
    ).body as BetDetail;
  const settle = (actor: Actor, bet: BetDetail, body: object) =>
    post(actor, `/bets/${bet.id}/settle`, { settledAt: SETTLED, version: bet.version, ...body });
  /** Ganada de S/ 20.00 liquidada con retorno calculado de S/ 39.00 (sin retorno oficial). */
  async function provisionalWin(overrides: Record<string, unknown> = {}): Promise<BetDetail> {
    const bet = await newBet(overrides);
    return (await settle('admin', bet, { status: 'WON' }).expect(200)).body as BetDetail;
  }
  const confirm = (actor: Actor, bet: BetDetail, body: object) =>
    post(actor, `/bets/${bet.id}/confirm-return`, { version: bet.version, ...body });
  const rowsOf = (betId: string) =>
    ctx.t.db.select().from(financialMovements).where(eq(financialMovements.operationId, betId));
  const betRow = async (betId: string) =>
    (await ctx.t.db.select().from(bets).where(eq(bets.id, betId)))[0]!;
  const houseBalance = async () =>
    ((await get('owner', '/houses').expect(200)).body as HouseBody[]).find((h) => h.id === houseId)!
      .balance;

  describe('liquidar sin retorno oficial (D-A3)', () => {
    it('una ganada sin retorno oficial se liquida con el calculado, marcado como no confirmado', async () => {
      const won = await provisionalWin();
      expect(won).toMatchObject({
        status: 'WON',
        officialRealizedReturn: null,
        calculatedRealizedReturn: '39.00', // 20.00 × 1.95
        effectiveReturn: '39.00',
        returnSource: 'CALCULATED',
        profitLoss: '19.00', // provisional
      });
      // El ledger refleja el retorno calculado: 500 − 20 + 39.
      expect(await houseBalance()).toBe('519.00');
      const settlement = (await rowsOf(won.id)).find((row) => row.type === 'BET_SETTLEMENT');
      expect(settlement).toMatchObject({ amount: '39.00', direction: 'CREDIT' });
      await invariant({ reconcile: true });
    });

    it('con retorno oficial se guarda como oficial y también el calculado (para compararlos)', async () => {
      const bet = await newBet();
      const won = (
        await settle('admin', bet, { status: 'WON', officialRealizedReturn: '38.50' }).expect(200)
      ).body as BetDetail;
      expect(won).toMatchObject({
        officialRealizedReturn: '38.50',
        calculatedRealizedReturn: '39.00',
        effectiveReturn: '38.50',
        returnSource: 'OFFICIAL',
        profitLoss: '18.50',
      });
      expect(await houseBalance()).toBe('518.50');
      await invariant();
    });

    it('una anulada sin retorno queda confirmada con retorno = monto (sin ganancia ni pérdida)', async () => {
      const bet = await newBet();
      const voided = (await settle('admin', bet, { status: 'VOID' }).expect(200)).body as BetDetail;
      expect(voided).toMatchObject({
        status: 'VOID',
        officialRealizedReturn: '20.00',
        calculatedRealizedReturn: null,
        returnSource: 'OFFICIAL',
        profitLoss: '0.00',
      });
      expect(await houseBalance()).toBe('500.00');
      await invariant();
    });

    it('el cash out exige el retorno oficial; una perdida no lleva retorno', async () => {
      const bet = await newBet();
      const denied = await settle('admin', bet, { status: 'CASHOUT' }).expect(400);
      expect(bodyOf(denied).code).toBe('VALIDATION_FAILED');
      await settle('admin', bet, { status: 'LOST', officialRealizedReturn: '5.00' }).expect(400);
      const cashout = (
        await settle('admin', bet, { status: 'CASHOUT', officialRealizedReturn: '12.50' }).expect(
          200,
        )
      ).body as BetDetail;
      expect(cashout).toMatchObject({ returnSource: 'OFFICIAL', profitLoss: '-7.50' });
      await invariant();
    });

    it('una perdida no tiene retorno de ningún tipo', async () => {
      const bet = await newBet();
      const lost = (await settle('admin', bet, { status: 'LOST' }).expect(200)).body as BetDetail;
      expect(lost).toMatchObject({
        officialRealizedReturn: null,
        calculatedRealizedReturn: null,
        returnSource: null,
        profitLoss: '-20.00',
      });
      const row = await betRow(lost.id);
      expect([row.officialRealizedReturn, row.calculatedRealizedReturn]).toEqual([null, null]);
      await invariant({ reconcile: true });
    });

    it('el retorno provisional participa en el P/L del dashboard (D-A6)', async () => {
      await provisionalWin();
      const analysis = (await get('owner', '/dashboard/analysis').expect(200)).body as {
        profitLoss: string;
        counts: { won: number };
      };
      expect(analysis).toMatchObject({ profitLoss: '19.00', counts: { won: 1 } });
    });

    it('liquidar una pendiente antigua no introduce conflictos: su reserva ya ocupaba ese saldo (§74)', async () => {
      const bet = await newBet({ placedAt: '2026-05-01T10:00:00.000Z' });
      const settled = (await settle('admin', bet, { status: 'LOST' }).expect(200))
        .body as BetDetail;
      expect(settled.status).toBe('LOST');
      await invariant();
    });
  });

  describe('procedencia del monto: amount_confirmed (§76)', () => {
    it('liquidar congela el monto calculado sin marcarlo como confirmado', async () => {
      const won = await provisionalWin();
      expect(won).toMatchObject({ officialAmount: '20.00', amountSource: 'CALCULATED' });
      expect((await betRow(won.id)).amountConfirmed).toBe(false);
    });

    it('un monto indicado al registrar, editar o liquidar sí queda confirmado', async () => {
      const fromTicket = await newBet({ officialAmount: '25.00' });
      expect(fromTicket).toMatchObject({ officialAmount: '25.00', amountSource: 'CONFIRMED' });
      const settled = (await settle('admin', fromTicket, { status: 'LOST' }).expect(200))
        .body as BetDetail;
      expect(settled.amountSource).toBe('CONFIRMED'); // conserva lo confirmado

      const other = await newBet();
      expect(other.amountSource).toBe('CALCULATED');
      const edited = (
        await request(ctx.server)
          .patch(api(`/bets/${other.id}`))
          .set('Cookie', cookies.admin)
          .send({ officialAmount: '30.00', version: other.version })
          .expect(200)
      ).body as BetDetail;
      expect(edited.amountSource).toBe('CONFIRMED');

      const third = await newBet();
      const withAmount = (
        await settle('admin', third, { status: 'LOST', officialAmount: '18.00' }).expect(200)
      ).body as BetDetail;
      expect(withAmount).toMatchObject({ officialAmount: '18.00', amountSource: 'CONFIRMED' });
    });

    it('confirmar el retorno oficial no confirma el monto: son dos cosas distintas', async () => {
      const won = await provisionalWin();
      const confirmed = (
        await confirm('admin', won, { officialRealizedReturn: '39.00' }).expect(200)
      ).body as BetDetail;
      expect(confirmed.returnSource).toBe('OFFICIAL');
      expect(confirmed.amountSource).toBe('CALCULATED');
      expect((await betRow(won.id)).amountConfirmed).toBe(false);
    });
  });

  describe('confirmar el retorno oficial (§77, D-A8, D-A12)', () => {
    it('igual al calculado: solo se marca confirmado; el ledger no cambia y no exige reautenticación', async () => {
      const won = await provisionalWin();
      const rowsBefore = await ctx.t.db.select().from(financialMovements);
      expireReauth(); // sin diferencia, la reautenticación no hace falta (D-A12)

      const confirmed = (
        await confirm('admin', won, { officialRealizedReturn: '39.00' }).expect(200)
      ).body as BetDetail;
      expect(confirmed).toMatchObject({
        officialRealizedReturn: '39.00',
        calculatedRealizedReturn: '39.00',
        returnSource: 'OFFICIAL',
        profitLoss: '19.00',
      });
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(rowsBefore.length);

      const [correction] = await ctx.t.db.select().from(betCorrections);
      expect(correction).toMatchObject({
        kind: 'RETURN_CONFIRMATION',
        betId: won.id,
        reason: null,
        createdBy: people.admin.id,
        before: { officialRealizedReturn: null, calculatedRealizedReturn: '39.00' },
        after: { officialRealizedReturn: '39.00', calculatedRealizedReturn: '39.00' },
      });
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.return_confirmed'));
      expect(log).toMatchObject({
        entityId: won.id,
        actorUserId: people.admin.id,
        projectId,
        metadata: { differed: false, delta: '0.00', ledgerChanged: false },
      });
      await invariant({ reconcile: true });
    });

    it('distinto sin confirmación explícita: 409 RETURN_MISMATCH con los tres valores y nada cambia', async () => {
      const won = await provisionalWin();
      const rowsBefore = await ctx.t.db.select().from(financialMovements);
      const response = await confirm('admin', won, { officialRealizedReturn: '38.50' });
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('RETURN_MISMATCH');
      expect(bodyOf(response).details as unknown as ReturnMismatchDetails).toEqual({
        calculated: '39.00',
        official: '38.50',
        delta: '-0.50',
      });
      expect((await betRow(won.id)).officialRealizedReturn).toBeNull();
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(rowsBefore.length);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(0);
      await invariant();
    });

    it('distinto y confirmado: exige reautenticación reciente; con ella corrige el ledger y audita', async () => {
      const won = await provisionalWin();
      expireReauth();
      const denied = await confirm('admin', won, {
        officialRealizedReturn: '38.50',
        acknowledgeDifference: true,
      });
      expect(denied.status).toBe(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');
      expect((await betRow(won.id)).officialRealizedReturn).toBeNull();

      await reauth('admin');
      const confirmed = (
        await confirm('admin', won, {
          officialRealizedReturn: '38.50',
          acknowledgeDifference: true,
          reason: 'El ticket muestra 38.50',
        }).expect(200)
      ).body as BetDetail;
      expect(confirmed).toMatchObject({
        officialRealizedReturn: '38.50',
        calculatedRealizedReturn: '39.00', // se conserva para comparar
        returnSource: 'OFFICIAL',
        profitLoss: '18.50',
      });

      // Reversión de la liquidación calculada (misma fecha) y liquidación oficial nueva.
      const rows = await rowsOf(won.id);
      const reversal = rows.find((row) => row.type === 'REVERSAL')!;
      expect(reversal).toMatchObject({
        direction: 'DEBIT',
        amount: '39.00',
        reason: 'El ticket muestra 38.50',
      });
      expect(reversal.occurredAt.toISOString()).toBe(SETTLED);
      expect(
        rows
          .filter((row) => row.type === 'BET_SETTLEMENT')
          .map((row) => row.amount)
          .sort(),
      ).toEqual(['38.50', '39.00']);
      expect(await houseBalance()).toBe('518.50');

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.return_confirmed'));
      expect(log).toMatchObject({
        newValues: { officialRealizedReturn: '38.50', returnSource: 'OFFICIAL' },
        metadata: {
          calculatedRealizedReturn: '39.00',
          delta: '-0.50',
          differed: true,
          ledgerChanged: true,
          reason: 'El ticket muestra 38.50',
        },
      });
      const [correction] = await ctx.t.db.select().from(betCorrections);
      expect(correction).toMatchObject({ reason: 'El ticket muestra 38.50' });
      expect(reversal.correctionId).toBe(correction!.id);
      await invariant({ reconcile: true });
    });

    it('un oficial mayor que el calculado también corrige el ledger', async () => {
      const won = await provisionalWin();
      await confirm('admin', won, {
        officialRealizedReturn: '40.00',
        acknowledgeDifference: true,
      }).expect(200);
      expect(await houseBalance()).toBe('520.00');
      await invariant();
    });

    it('confirmar con acknowledgeDifference exige reautenticación aunque no haya diferencia', async () => {
      const won = await provisionalWin();
      expireReauth();
      const response = await confirm('admin', won, {
        officialRealizedReturn: '39.00',
        acknowledgeDifference: true,
      });
      expect(bodyOf(response).code).toBe('REAUTH_REQUIRED');
    });

    it('una corrección que dejaría el historial en negativo se rechaza y no cambia nada', async () => {
      const won = await provisionalWin();
      // Un retiro posterior que solo cabe con el retorno calculado: 519.00 → saldo 0.
      await ctx.t.db.insert(financialMovements).values({
        projectId,
        stageId,
        type: 'WITHDRAWAL',
        direction: 'DEBIT',
        houseId,
        amount: '519.00',
        reason: 'Retiro de prueba',
        occurredAt: new Date('2026-06-01T16:00:00.000Z'),
        createdBy: people.owner.id,
      });
      const rowsBefore = await ctx.t.db.select().from(financialMovements);
      const response = await confirm('admin', won, {
        officialRealizedReturn: '38.00',
        acknowledgeDifference: true,
      });
      expect(response.status).toBe(409);
      expect(bodyOf(response).code).toBe('CORRECTION_CONFLICT');
      expect(await ctx.t.db.select().from(financialMovements)).toHaveLength(rowsBefore.length);
      expect(await ctx.t.db.select().from(betCorrections)).toHaveLength(0);
      expect((await betRow(won.id)).officialRealizedReturn).toBeNull();
    });

    it('invalida los checkpoints afectados solo si el ledger cambia (§112.5)', async () => {
      const first = await provisionalWin();
      const second = await provisionalWin({ placedAt: '2026-06-01T13:30:00.000Z' });
      ctx.clock.set('2026-06-01T15:00:00.000Z');
      await relogin('admin');
      await request(ctx.server)
        .post(api(`/houses/${houseId}/reconciliations`))
        .set('Cookie', cookies.admin)
        .send({ officialAvailable: '538.00' }) // 500 − 20 + 39 − 20 + 39
        .expect(201);
      const status = async () =>
        (await ctx.t.db.select().from(reconciliationCheckpoints))[0]!.status;
      expect(await status()).toBe('MATCHED');

      // Sin diferencia no hay efecto en el ledger: el checkpoint sigue vigente.
      await confirm('admin', first, { officialRealizedReturn: '39.00' }).expect(200);
      expect(await status()).toBe('MATCHED');

      // Con diferencia, la liquidación (14:00) es anterior al checkpoint (15:00): se invalida.
      await confirm('admin', second, {
        officialRealizedReturn: '37.00',
        acknowledgeDifference: true,
      }).expect(200);
      expect(await status()).toBe('INVALIDATED');
      const [checkpoint] = await ctx.t.db.select().from(reconciliationCheckpoints);
      expect(checkpoint!.invalidatedReason).toContain('retorno oficial');
    });

    it('no invalida un checkpoint anterior a la fecha más antigua afectada', async () => {
      const bet = await newBet();
      ctx.clock.set('2026-06-01T12:30:00.000Z'); // antes de colocar (13:00) y de liquidar (14:00)
      await relogin('admin');
      await request(ctx.server)
        .post(api(`/houses/${houseId}/reconciliations`))
        .set('Cookie', cookies.admin)
        .send({ officialAvailable: '480.00' }) // 500 − 20 comprometidos
        .expect(201);
      const settled = (await settle('admin', bet, { status: 'WON' }).expect(200)).body as BetDetail;
      await confirm('admin', settled, {
        officialRealizedReturn: '36.00',
        acknowledgeDifference: true,
      }).expect(200);
      // La liquidación cambia después del checkpoint: no puede alterar lo que ya se conciliaba.
      const checkpoints = await ctx.t.db.select().from(reconciliationCheckpoints);
      expect(checkpoints.map((c) => c.status)).toContain('MATCHED');
    });
  });

  describe('permisos y estados de la confirmación (D-A8)', () => {
    it('el Colaborador no puede confirmar, ni siquiera su propia apuesta; el Lector tampoco', async () => {
      const won = await provisionalWin(); // la creó el Colaborador
      expect((await confirm('collab', won, { officialRealizedReturn: '39.00' })).status).toBe(403);
      expect((await confirm('reader', won, { officialRealizedReturn: '39.00' })).status).toBe(403);
      expect((await confirm('stranger', won, { officialRealizedReturn: '39.00' })).status).toBe(
        404,
      );
      expect((await betRow(won.id)).officialRealizedReturn).toBeNull();
    });

    it('el propietario y el Administrador de Proyecto sí pueden', async () => {
      const a = await provisionalWin();
      await confirm('owner', a, { officialRealizedReturn: '39.00' }).expect(200);
      const b = await provisionalWin({ placedAt: '2026-06-01T13:10:00.000Z' });
      await confirm('admin', b, { officialRealizedReturn: '39.00' }).expect(200);
    });

    it('solo una ganada con retorno calculado sin confirmar admite la confirmación', async () => {
      const pending = await newBet();
      expect((await confirm('admin', pending, { officialRealizedReturn: '39.00' })).status).toBe(
        409,
      );

      const lost = (await settle('admin', await newBet(), { status: 'LOST' }).expect(200))
        .body as BetDetail;
      expect((await confirm('admin', lost, { officialRealizedReturn: '39.00' })).status).toBe(409);

      const officialAtSettle = (
        await settle('admin', await newBet(), {
          status: 'WON',
          officialRealizedReturn: '39.00',
        }).expect(200)
      ).body as BetDetail;
      expect(
        (await confirm('admin', officialAtSettle, { officialRealizedReturn: '39.00' })).status,
      ).toBe(409);

      const won = await provisionalWin();
      const confirmed = (
        await confirm('admin', won, { officialRealizedReturn: '39.00' }).expect(200)
      ).body as BetDetail;
      const again = await confirm('admin', confirmed, { officialRealizedReturn: '39.00' });
      expect(again.status).toBe(409);
      expect(bodyOf(again).message).toContain('ya está confirmado');
    });

    it('una apuesta en la papelera no admite la confirmación', async () => {
      const won = await provisionalWin();
      await ctx.t.db
        .update(bets)
        .set({ deletedAt: new Date(), purgeEligibleAt: new Date() })
        .where(eq(bets.id, won.id));
      expect((await confirm('admin', won, { officialRealizedReturn: '39.00' })).status).toBe(409);
    });

    it('valida el cuerpo, la versión y el identificador', async () => {
      const won = await provisionalWin();
      await confirm('admin', won, {}).expect(400);
      await confirm('admin', won, { officialRealizedReturn: '0.00' }).expect(400); // debe ser positivo
      await confirm('admin', won, { officialRealizedReturn: '-1.00' }).expect(400);
      await confirm('admin', won, {
        officialRealizedReturn: '39.00',
        acknowledgeDifference: 'sí',
      }).expect(400);
      const stale = await post('admin', `/bets/${won.id}/confirm-return`, {
        officialRealizedReturn: '39.00',
        version: won.version + 5,
      });
      expect(stale.status).toBe(409);
      await post('admin', '/bets/no-es-un-uuid/confirm-return', {
        officialRealizedReturn: '39.00',
        version: 1,
      }).expect(404);
    });

    it('dos confirmaciones simultáneas: una tiene éxito y la otra recibe 409', async () => {
      const won = await provisionalWin();
      const [a, b] = await Promise.all([
        confirm('admin', won, { officialRealizedReturn: '39.00' }),
        confirm('owner', won, { officialRealizedReturn: '39.00' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        await ctx.t.db.select().from(betCorrections).where(eq(betCorrections.betId, won.id)),
      ).toHaveLength(1);
      await invariant();
    });
  });

  describe('listado de pendientes y reporte de diferencias (evidencia para D-B8)', () => {
    it('lista las ganadas por confirmar y deja de listarlas al confirmarlas', async () => {
      const a = await provisionalWin();
      await provisionalWin({ placedAt: '2026-06-01T13:10:00.000Z' });
      let items = (await get('reader', '/bets/unconfirmed-returns').expect(200))
        .body as UnconfirmedReturnItem[];
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        houseName: 'Betano',
        effectiveAmount: '20.00',
        calculatedRealizedReturn: '39.00',
        provisionalProfit: '19.00',
      });

      await confirm('admin', a, { officialRealizedReturn: '39.00' }).expect(200);
      items = (await get('owner', '/bets/unconfirmed-returns').expect(200))
        .body as UnconfirmedReturnItem[];
      expect(items.map((item) => item.betId)).not.toContain(a.id);
      expect(items).toHaveLength(1);
      expect((await get('stranger', '/bets/unconfirmed-returns')).status).toBe(404);
    });

    it('compara calculado y oficial: cuántas difieren, en cuánto y por casa', async () => {
      // Tres ganadas: una igual, una 0.50 menos y una liquidada con oficial 0.02 más.
      const same = await provisionalWin({ placedAt: '2026-06-01T13:01:00.000Z' });
      await confirm('admin', same, { officialRealizedReturn: '39.00' }).expect(200);
      const lower = await provisionalWin({ placedAt: '2026-06-01T13:02:00.000Z' });
      await confirm('admin', lower, {
        officialRealizedReturn: '38.50',
        acknowledgeDifference: true,
      }).expect(200);
      const bet = await newBet({ placedAt: '2026-06-01T13:03:00.000Z' });
      await settle('admin', bet, { status: 'WON', officialRealizedReturn: '39.02' }).expect(200);
      await provisionalWin({ placedAt: '2026-06-01T13:04:00.000Z' }); // sin oficial: no se compara

      const report = (await get('reader', '/bets/return-differences').expect(200))
        .body as ReturnDifferencesReport;
      expect(report).toMatchObject({ compared: 3, differing: 2, totalDelta: '-0.48' });
      expect(report.byHouse).toEqual([
        { houseId, houseName: 'Betano', compared: 3, differing: 2, totalDelta: '-0.48' },
      ]);
      expect(report.items.map((item) => item.delta).sort()).toEqual(['-0.50', '0.02']);
      expect(report.items[0]).toMatchObject({
        houseName: 'Betano',
        effectiveAmount: '20.00',
        visibleTotalOdds: '1.950000',
        calculatedRealizedReturn: '39.00',
      });
      await invariant({ reconcile: true });
    });

    it('sin apuestas que comparar, el reporte está vacío', async () => {
      expect((await get('owner', '/bets/return-differences').expect(200)).body).toEqual({
        compared: 0,
        differing: 0,
        totalDelta: '0.00',
        byHouse: [],
        items: [],
      });
    });
  });

  describe('criterio de aceptación: saldo ledger = saldo dashboard = saldo conciliable', () => {
    it('se mantiene tras una secuencia de liquidaciones provisionales y confirmaciones', async () => {
      await invariant();
      const a = await provisionalWin({ placedAt: '2026-06-01T13:01:00.000Z' });
      await invariant();
      const b = await newBet({ placedAt: '2026-06-01T13:02:00.000Z' });
      await invariant(); // una pendiente: solo comprometido, sin ledger
      await settle('admin', b, { status: 'LOST' }).expect(200);
      await invariant();
      await confirm('admin', a, {
        officialRealizedReturn: '37.25',
        acknowledgeDifference: true,
      }).expect(200);
      await invariant();
      const c = await provisionalWin({ placedAt: '2026-06-01T13:03:00.000Z' });
      await confirm('admin', c, { officialRealizedReturn: '39.00' }).expect(200);
      await invariant({ reconcile: true });
      expect(await houseBalance()).toBe(
        // 500 − 20 + 37.25 (a) − 20 (b perdida) − 20 + 39 (c)
        '516.25',
      );
    });
  });
});
