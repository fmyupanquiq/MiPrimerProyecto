import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, bets, financialMovements, type UserRow } from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'collab2' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
  name: string;
  balance: string;
  committed: string;
  available: string;
}
interface SelectionBody {
  id: string;
  eventGroup: number;
  position: number;
  event: string;
  selection: string;
  visibleOdds: string;
}
interface BetBody {
  id: string;
  stageId: string;
  betType: string;
  stake: string;
  officialAmount: string | null;
  effectiveAmount: string;
  amountSource: string;
  officialRealizedReturn: string | null;
  profitLoss: string | null;
  status: string;
  version: number;
  createdBy: { id: string; name: string };
  selections?: SelectionBody[];
  code?: string;
}

const simpleSelection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};

describe('apuestas, selecciones y liquidaciones (e2e, PostgreSQL real, §18-§27, §107)', () => {
  let ctx: TestApp;
  let projectId: string;
  let stageId: string;
  let houseId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.collab2 = await ctx.createUser({ email: 'collab2@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab2.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }

    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    houseId = houseList[0]!.id;
    const stageList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as { id: string }[];
    stageId = stageList[0]!.id;
  });

  const listBets = (actor: Actor, query = '') =>
    request(ctx.server)
      .get(`/api/projects/${projectId}/bets${query}`)
      .set('Cookie', cookies[actor]);
  const createBet = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets`)
      .set('Cookie', cookies[actor])
      .send(body);
  const updateBet = (actor: Actor, betId: string, body: object) =>
    request(ctx.server)
      .patch(`/api/projects/${projectId}/bets/${betId}`)
      .set('Cookie', cookies[actor])
      .send(body);
  const settleBet = (actor: Actor, betId: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets/${betId}/settle`)
      .set('Cookie', cookies[actor])
      .send(body);
  const moveBetStage = (actor: Actor, betId: string, body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets/${betId}/move-stage`)
      .set('Cookie', cookies[actor])
      .send(body);
  const trashBet = (actor: Actor, betId: string, body: object = {}) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets/${betId}/trash`)
      .set('Cookie', cookies[actor])
      .send(body);
  const restoreBet = (actor: Actor, betId: string) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets/${betId}/restore`)
      .set('Cookie', cookies[actor])
      .send({});
  const houseOf = async () => {
    const list = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as HouseBody[];
    return list.find((h) => h.id === houseId)!;
  };
  const reauthAs = (actor: Actor) =>
    request(ctx.server)
      .post('/api/auth/reauth')
      .set('Cookie', cookies[actor])
      .send({ password: TEST_PASSWORD })
      .expect(200);
  const simpleBet = (overrides: Record<string, unknown> = {}) => ({
    houseId,
    stake: '2.00',
    visibleTotalOdds: '1.95',
    placedAt: '2026-06-01T20:00:00.000Z',
    selections: [simpleSelection],
    ...overrides,
  });

  describe('crear (§18-§20, §75, §90)', () => {
    it('apuesta simple: deriva betType, calcula el monto y lo reserva como comprometido', async () => {
      const response = await createBet('collab', simpleBet()).expect(201);
      const body = response.body as BetBody;
      expect(body).toMatchObject({
        betType: 'SIMPLE',
        stake: '2.0000', // NUMERIC(10,4, §12, D-B8): el stake no es dinero, no se formatea a 2
        officialAmount: null,
        effectiveAmount: '20.00', // stake 2.00 × unidad 10.00
        amountSource: 'CALCULATED',
        status: 'PENDING',
      });
      expect(body.createdBy.id).toBe(people.collab.id);
      expect(body.selections).toHaveLength(1);

      const house = await houseOf();
      expect(house).toMatchObject({ balance: '500.00', committed: '20.00', available: '480.00' });

      const movements = await ctx.t.db.select().from(financialMovements);
      expect(movements).toHaveLength(1); // solo el capital inicial: sin ledger todavía (§107.3)
    });

    it('con monto oficial: amountSource es CONFIRMED y ese es el monto reservado', async () => {
      const response = await createBet('collab', simpleBet({ officialAmount: '25.00' })).expect(
        201,
      );
      expect(response.body).toMatchObject({
        officialAmount: '25.00',
        effectiveAmount: '25.00',
        amountSource: 'CONFIRMED',
      });
      expect((await houseOf()).committed).toBe('25.00');
    });

    it('apuesta creada: mismo eventGroup, varias selecciones', async () => {
      const response = await createBet(
        'collab',
        simpleBet({
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Final',
              selection: 'Más de 2.5 goles',
              visibleOdds: '1.80',
            },
            {
              eventGroup: 0,
              position: 1,
              event: 'Final',
              selection: 'Ambos anotan',
              visibleOdds: '1.70',
            },
          ],
        }),
      ).expect(201);
      expect((response.body as BetBody).betType).toBe('CREATED');
    });

    it('apuesta múltiple: distintos eventGroup', async () => {
      const response = await createBet(
        'collab',
        simpleBet({
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Partido 1',
              selection: 'Local',
              visibleOdds: '1.50',
            },
            {
              eventGroup: 1,
              position: 0,
              event: 'Partido 2',
              selection: 'Visita',
              visibleOdds: '2.10',
            },
          ],
        }),
      ).expect(201);
      expect((response.body as BetBody).betType).toBe('MULTIPLE');
    });

    it('rechaza por saldo insuficiente (§75): no crea la apuesta', async () => {
      const response = await createBet('collab', simpleBet({ stake: '1000.00' })).expect(409);
      expect(bodyOf(response).code).toBe('INVALID_STATE');
      expect((await houseOf()).committed).toBe('0.00');
    });

    it('exige al menos una selección', async () => {
      await createBet('collab', simpleBet({ selections: [] })).expect(400);
    });

    it('sin etapa activa (proyecto sin configurar) responde 409', async () => {
      // people.stranger ya tiene sesión (beforeEach): se usa como propietaria de un proyecto
      // aparte, sin pasar por un login nuevo (insertUser no deja una contraseña utilizable).
      const { project: other } = await insertProject(ctx.t.db, {
        owner: people.stranger,
        name: 'Sin configurar',
      });
      const response = await request(ctx.server)
        .post(`/api/projects/${other.id}/bets`)
        .set('Cookie', cookies.stranger)
        .send(simpleBet({ houseId: '01960000-0000-7000-8000-000000000000' }));
      expect(response.status).toBe(409);
    });

    it('lector no puede crear (403)', async () => {
      await createBet('reader', simpleBet()).expect(403);
    });

    it('se audita', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bet.created'));
      expect(log?.entityId).toBe(created.id);
      expect(log?.actorUserId).toBe(people.collab.id);
    });

    describe('restricción de etapa al crear (§25, revisión de arquitectura)', () => {
      it('sin bets.move_stage, un stageId distinto de la activa responde 403', async () => {
        const closedStageId = stageId; // la etapa del beforeEach queda cerrada tras crear la 2ª
        const second = await request(ctx.server)
          .post(`/api/projects/${projectId}/stages`)
          .set('Cookie', cookies.owner)
          .send({ unitStake: '20.00' })
          .expect(201);
        const activeStageId = (second.body as { id: string }).id;

        const denied = await createBet('collab', simpleBet({ stageId: closedStageId }));
        expect(denied.status).toBe(403);

        // Sin indicar stageId, o indicando exactamente la activa, sí se puede (no es un cambio real).
        const implicit = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
        expect(implicit.stageId).toBe(activeStageId);
        const explicitActive = (
          await createBet('collab', simpleBet({ stageId: activeStageId })).expect(201)
        ).body as BetBody;
        expect(explicitActive.stageId).toBe(activeStageId);
      });

      it('con bets.move_stage, un administrador sí puede crear directamente en otra etapa', async () => {
        const closedStageId = stageId;
        await request(ctx.server)
          .post(`/api/projects/${projectId}/stages`)
          .set('Cookie', cookies.owner)
          .send({ unitStake: '20.00' })
          .expect(201);

        const created = (
          await createBet('admin', simpleBet({ stageId: closedStageId })).expect(201)
        ).body as BetBody;
        expect(created.stageId).toBe(closedStageId);
      });
    });
  });

  describe('editar (§24)', () => {
    it('pendiente: admite cambiar casa, stake y selecciones, revalidando saldo', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const response = await updateBet('collab', created.id, {
        stake: '3.00',
        version: created.version,
      }).expect(200);
      expect((response.body as BetBody).effectiveAmount).toBe('30.00');
      expect((await houseOf()).committed).toBe('30.00');
    });

    it('rechaza si el nuevo monto excede el disponible', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const response = await updateBet('collab', created.id, {
        stake: '1000.00',
        version: created.version,
      });
      expect(response.status).toBe(409);
    });

    it('el Colaborador solo edita las propias (403 en una ajena)', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await updateBet('collab2', created.id, { reason: 'ajeno', version: created.version }).expect(
        403,
      );
      await updateBet('admin', created.id, {
        reason: 'admin edita',
        version: created.version,
      }).expect(200);
    });

    it('liquidada: solo admite motivo y fecha; otros campos responden 409', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', created.id, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(200);

      const okResponse = await updateBet('collab', created.id, {
        reason: 'Nota posterior',
        version: 2,
      }).expect(200);
      expect((okResponse.body as BetBody).status).toBe('WON');

      const rejected = await updateBet('collab', created.id, { stake: '5.00', version: 3 });
      expect(rejected.status).toBe(409);
    });
  });

  describe('liquidar (§21, §77, §78, D-B2)', () => {
    it('ganada: genera BET_PLACEMENT + BET_SETTLEMENT y calcula la ganancia', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const response = await settleBet('admin', created.id, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(200);
      const body = response.body as BetBody;
      expect(body).toMatchObject({
        status: 'WON',
        officialRealizedReturn: '39.00',
        profitLoss: '19.00',
      });

      const movements = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.operationId, created.id));
      expect(movements.map((m) => `${m.type}:${m.direction}:${m.amount}`).sort()).toEqual(
        ['BET_PLACEMENT:DEBIT:20.00', 'BET_SETTLEMENT:CREDIT:39.00'].sort(),
      );
      const house = await houseOf();
      expect(house).toMatchObject({ balance: '519.00', committed: '0.00', available: '519.00' });
    });

    it('perdida (D-B2): solo BET_PLACEMENT, sin fila de liquidación', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const response = await settleBet('admin', created.id, {
        status: 'LOST',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(200);
      expect(response.body).toMatchObject({
        status: 'LOST',
        officialRealizedReturn: null,
        profitLoss: '-20.00',
      });
      const movements = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.operationId, created.id));
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ type: 'BET_PLACEMENT', direction: 'DEBIT' });
      expect((await houseOf()).balance).toBe('480.00');
    });

    it('anulada (VOID): retorno = monto, sin ganancia ni pérdida', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const response = await settleBet('admin', created.id, {
        status: 'VOID',
        officialRealizedReturn: '20.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(200);
      expect(response.body).toMatchObject({ status: 'VOID', profitLoss: '0.00' });
      expect((await houseOf()).balance).toBe('500.00'); // sale y vuelve: neto 0
    });

    it('rechaza liquidar dos veces', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', created.id, {
        status: 'LOST',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(200);
      const response = await settleBet('admin', created.id, {
        status: 'WON',
        officialRealizedReturn: '10.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: 2,
      });
      expect(response.status).toBe(409);
    });

    it('el Colaborador NO puede liquidar, ni siquiera su propia apuesta (revisión de arquitectura: bets.settle es de administrador)', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const response = await settleBet('collab', created.id, {
        status: 'LOST',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      });
      expect(response.status).toBe(403);
      const [bet] = await ctx.t.db.select().from(bets).where(eq(bets.id, created.id));
      expect(bet!.status).toBe('PENDING');
    });

    it('el Lector no puede liquidar (403)', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('reader', created.id, {
        status: 'LOST',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(403);
    });

    it('LOST con officialRealizedReturn responde 400 (validación, D-B2)', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', created.id, {
        status: 'LOST',
        officialRealizedReturn: '10.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      }).expect(400);
    });
  });

  describe('mover de etapa (§25)', () => {
    it('solo administradores, con contraseña reciente', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      const second = await request(ctx.server)
        .post(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .send({ unitStake: '20.00' })
        .expect(201);
      const newStageId = (second.body as { id: string }).id;

      // El login inicial (beforeEach) ya cuenta como reautenticación reciente (§39): hay que
      // dejar pasar la ventana para ejercer de verdad el guard (mismo patrón que retiros, Fase 3).
      ctx.clock.advanceSeconds(6 * 60);

      await moveBetStage('collab', created.id, {
        stageId: newStageId,
        version: created.version,
      }).expect(403);

      const denied = await moveBetStage('admin', created.id, {
        stageId: newStageId,
        version: created.version,
      });
      expect(denied.status).toBe(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');

      await reauthAs('admin');
      const response = await moveBetStage('admin', created.id, {
        stageId: newStageId,
        version: created.version,
      }).expect(200);
      expect((response.body as BetBody & { stageId: string }).stageId).toBe(newStageId);
    });
  });

  describe('papelera (§26, §88, D-B6)', () => {
    it('el Colaborador envía su propia apuesta a la papelera', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await trashBet('collab', created.id).expect(200);
      const response = await listBets('collab', '?status=TRASHED');
      expect(response.status).toBe(403); // sin bets.restore, no ve la papelera
    });

    it('el Colaborador no envía a la papelera la apuesta de otro (403)', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await trashBet('collab2', created.id).expect(403);
    });

    it('límite diario del Colaborador: al undécimo intento responde 409', async () => {
      for (let i = 0; i < 10; i += 1) {
        const created = (await createBet('collab', simpleBet({ stake: '0.10' })).expect(201))
          .body as BetBody;
        await trashBet('collab', created.id).expect(200);
      }
      const eleventh = (await createBet('collab', simpleBet({ stake: '0.10' })).expect(201))
        .body as BetBody;
      const response = await trashBet('collab', eleventh.id);
      expect(response.status).toBe(409);
    });

    it('un administrador (bets.trash_any) no tiene límite diario', async () => {
      for (let i = 0; i < 10; i += 1) {
        const created = (await createBet('collab', simpleBet({ stake: '0.10' })).expect(201))
          .body as BetBody;
        await trashBet('admin', created.id).expect(200);
      }
      const eleventh = (await createBet('collab', simpleBet({ stake: '0.10' })).expect(201))
        .body as BetBody;
      await trashBet('admin', eleventh.id).expect(200);
    });

    it('restaurar: solo administradores', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await trashBet('admin', created.id).expect(200);
      await restoreBet('collab', created.id).expect(403);
      await restoreBet('admin', created.id).expect(200);
      const list = (await listBets('admin').expect(200)).body as BetBody[];
      expect(list.map((b) => b.id)).toContain(created.id);
    });
  });

  describe('una apuesta en la papelera no admite operaciones (revisión de arquitectura)', () => {
    it('bloquea editar, liquidar y mover de etapa; restaurar sí funciona y las desbloquea', async () => {
      const created = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await trashBet('collab', created.id).expect(200);

      const updateDenied = await updateBet('admin', created.id, {
        reason: 'intento',
        version: created.version,
      });
      expect(updateDenied.status).toBe(409);

      const settleDenied = await settleBet('admin', created.id, {
        status: 'LOST',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: created.version,
      });
      expect(settleDenied.status).toBe(409);

      const second = await request(ctx.server)
        .post(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .send({ unitStake: '20.00' })
        .expect(201);
      await reauthAs('admin');
      const moveDenied = await moveBetStage('admin', created.id, {
        stageId: (second.body as { id: string }).id,
        version: created.version,
      });
      expect(moveDenied.status).toBe(409);

      // Nada de lo anterior cambió el estado ni la versión de la apuesta (fallaron antes del UPDATE).
      const [stillTrashed] = await ctx.t.db.select().from(bets).where(eq(bets.id, created.id));
      expect(stillTrashed!.deletedAt).not.toBeNull();
      expect(stillTrashed!.version).toBe(2); // 1 al crear, 2 al enviar a la papelera

      // Restaurar sí funciona, y a partir de ahí las operaciones vuelven a admitirse.
      await restoreBet('admin', created.id).expect(200);
      const [restored] = await ctx.t.db.select().from(bets).where(eq(bets.id, created.id));
      expect(restored!.deletedAt).toBeNull();
      await updateBet('admin', created.id, {
        reason: 'ya restaurada',
        version: restored!.version,
      }).expect(200);
    });
  });

  describe('listar y filtrar', () => {
    it('filtra por etapa, casa y estado', async () => {
      const won = (await createBet('collab', simpleBet()).expect(201)).body as BetBody;
      await settleBet('admin', won.id, {
        status: 'WON',
        officialRealizedReturn: '39.00',
        settledAt: '2026-06-02T22:00:00.000Z',
        version: won.version,
      }).expect(200);
      await createBet('collab', simpleBet()).expect(201);

      const onlyWon = (await listBets('collab', '?status=WON').expect(200)).body as BetBody[];
      expect(onlyWon).toHaveLength(1);
      expect(onlyWon[0]!.id).toBe(won.id);

      const byStage = (await listBets('collab', `?stageId=${stageId}`).expect(200))
        .body as BetBody[];
      expect(byStage).toHaveLength(2);

      const byHouse = (await listBets('collab', `?houseId=${houseId}`).expect(200))
        .body as BetBody[];
      expect(byHouse).toHaveLength(2);
    });

    it('un desconocido no ve las apuestas del proyecto (404)', async () => {
      await listBets('stranger').expect(404);
    });
  });
});
