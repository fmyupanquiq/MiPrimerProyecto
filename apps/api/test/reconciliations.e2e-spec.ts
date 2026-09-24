import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface HouseBody {
  id: string;
  name: string;
}
interface CheckpointBody {
  id: string;
  status: string;
  letferAvailable: string;
  officialAvailable: string;
  committed: string;
  difference: string;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
}

describe('conciliación (e2e, PostgreSQL real, §32, §80, §109.1)', () => {
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

  // Función, no constante: `projectId` todavía no tiene valor cuando se evalúa este bloque
  // (se asigna en `beforeEach`), así que la ruta debe recalcularse en cada llamada.
  const base = () => `/api/projects/${projectId}`;
  const confirm = (actor: Actor, body: object) =>
    request(ctx.server)
      .post(`${base()}/houses/${houseId}/reconciliations`)
      .set('Cookie', cookies[actor])
      .send(body);
  const list = (actor: Actor) =>
    request(ctx.server)
      .get(`${base()}/houses/${houseId}/reconciliations`)
      .set('Cookie', cookies[actor]);
  const status = (actor: Actor) =>
    request(ctx.server)
      .get(`${base()}/houses/${houseId}/reconciliations/status`)
      .set('Cookie', cookies[actor]);
  const review = (actor: Actor) =>
    request(ctx.server)
      .get(`${base()}/houses/${houseId}/reconciliations/review`)
      .set('Cookie', cookies[actor]);
  const createBet = (actor: Actor, body: object) =>
    request(ctx.server).post(`${base()}/bets`).set('Cookie', cookies[actor]).send(body);
  const moveBetStage = (actor: Actor, betId: string, body: object) =>
    request(ctx.server)
      .post(`${base()}/bets/${betId}/move-stage`)
      .set('Cookie', cookies[actor])
      .send(body);

  describe('confirmar (D-C1, D-C2: un solo paso)', () => {
    it('coincide: crea un checkpoint MATCHED con los campos del §80, sin tocar el saldo', async () => {
      const body = (await confirm('owner', { officialAvailable: '500.00' }).expect(201))
        .body as CheckpointBody;
      expect(body).toMatchObject({
        status: 'MATCHED',
        letferAvailable: '500.00',
        officialAvailable: '500.00',
        committed: '0.00',
        difference: '0.00',
      });

      const houseList = (
        await request(ctx.server).get(`${base()}/houses`).set('Cookie', cookies.owner).expect(200)
      ).body as { id: string; balance: string }[];
      expect(houseList.find((h) => h.id === houseId)!.balance).toBe('500.00'); // sin cambios
    });

    it('no coincide: registra DISCREPANCY, sin alterar saldos ni crear movimientos (D-C1)', async () => {
      const body = (await confirm('owner', { officialAvailable: '450.00' }).expect(201))
        .body as CheckpointBody;
      expect(body).toMatchObject({
        status: 'DISCREPANCY',
        letferAvailable: '500.00',
        officialAvailable: '450.00',
        difference: '-50.00',
      });

      const movements = (
        await request(ctx.server)
          .get(`${base()}/movements`)
          .set('Cookie', cookies.owner)
          .expect(200)
      ).body as unknown[];
      expect(movements).toHaveLength(1); // solo el capital inicial: la conciliación no crea nada
    });

    it('no exige reautenticación (D-C7): funciona con una sesión recién iniciada, sin más', async () => {
      // El login de beforeEach ya cuenta como reciente, pero D-C7 solo garantiza que no se exige
      // en absoluto: confirmarlo con un depósito de por medio, sin ningún paso de reauth, basta.
      await confirm('owner', { officialAvailable: '500.00' }).expect(201);
    });

    it('el comprometido es diagnóstico, no participa en la comparación (D-C3)', async () => {
      const bet = (
        await createBet('collab', {
          houseId,
          stake: '2.00',
          visibleTotalOdds: '1.95',
          placedAt: '2026-06-01T20:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'Real Madrid vs. Barcelona',
              selection: 'Real Madrid gana',
              visibleOdds: '1.95',
            },
          ],
        }).expect(201)
      ).body as { id: string };
      void bet;
      // Disponible = 500 - 20 comprometido = 480.00; declarar exactamente eso es MATCHED.
      const body = (await confirm('owner', { officialAvailable: '480.00' }).expect(201))
        .body as CheckpointBody;
      expect(body).toMatchObject({
        status: 'MATCHED',
        committed: '20.00',
        letferAvailable: '480.00',
      });
    });

    it('funciona con el proyecto CLOSED ("conciliación final", §85)', async () => {
      await request(ctx.server)
        .post(`${base()}/close`)
        .set('Cookie', cookies.owner)
        .send({})
        .expect(200);
      await confirm('owner', { officialAvailable: '500.00' }).expect(201);
    });

    it('permisos: Colaborador y Lector no pueden confirmar; Administrador y Propietario sí', async () => {
      await confirm('collab', { officialAvailable: '500.00' }).expect(403);
      await confirm('reader', { officialAvailable: '500.00' }).expect(403);
      await confirm('admin', { officialAvailable: '500.00' }).expect(201);
    });

    it('un desconocido al proyecto recibe 404', async () => {
      await confirm('stranger', { officialAvailable: '500.00' }).expect(404);
    });
  });

  describe('estado y "requiere nueva conciliación" (§74, §109.1.3, D-C6)', () => {
    it('requiere conciliación hasta el primer MATCHED; luego no', async () => {
      const before = (await status('owner').expect(200)).body as {
        requiresReconciliation: boolean;
        lastMatchedCheckpoint: null;
      };
      expect(before).toMatchObject({ requiresReconciliation: true, lastMatchedCheckpoint: null });

      await confirm('owner', { officialAvailable: '500.00' }).expect(201);
      const after = (await status('owner').expect(200)).body as { requiresReconciliation: boolean };
      expect(after.requiresReconciliation).toBe(false);
    });

    it('una discrepancia no cuenta como conciliación válida: sigue requiriéndose', async () => {
      await confirm('owner', { officialAvailable: '450.00' }).expect(201);
      const after = (await status('owner').expect(200)).body as { requiresReconciliation: boolean };
      expect(after.requiresReconciliation).toBe(true);
    });

    it('una apuesta anterior al checkpoint lo invalida; una posterior no (§74)', async () => {
      const matched = (await confirm('owner', { officialAvailable: '500.00' }).expect(201))
        .body as CheckpointBody;

      // Posterior al checkpoint (2026-06-01T12:00:00Z): no debe invalidar nada.
      await createBet('collab', {
        houseId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-07-01T00:00:00.000Z',
        selections: [
          { eventGroup: 0, position: 0, event: 'A vs B', selection: 'A gana', visibleOdds: '1.95' },
        ],
      }).expect(201);
      const stillMatched = (await status('owner').expect(200)).body as {
        requiresReconciliation: boolean;
      };
      expect(stillMatched.requiresReconciliation).toBe(false);

      // Anterior al checkpoint: debe invalidarlo.
      await createBet('collab', {
        houseId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-05-01T00:00:00.000Z',
        selections: [
          { eventGroup: 0, position: 0, event: 'C vs D', selection: 'C gana', visibleOdds: '1.95' },
        ],
      }).expect(201);
      const invalidated = (await status('owner').expect(200)).body as {
        requiresReconciliation: boolean;
      };
      expect(invalidated.requiresReconciliation).toBe(true);

      const checkpoints = (await list('owner').expect(200)).body as CheckpointBody[];
      const row = checkpoints.find((c) => c.id === matched.id)!;
      expect(row.status).toBe('INVALIDATED');
      expect(row.invalidatedAt).not.toBeNull();
      expect(row.invalidatedReason).not.toBeNull();
    });

    it('H1 (revisión de arquitectura): mover una pendiente sin monto oficial a otra unidad invalida', async () => {
      const bet = (
        await createBet('collab', {
          houseId,
          stageId,
          stake: '2.00',
          visibleTotalOdds: '1.95',
          // Antes del checkpoint (que ocurrirá a las 12:00 del reloj falso, fijado en
          // beforeEach): así el checkpoint sí "conoce" esta apuesta y puede invalidarse por ella.
          placedAt: '2026-06-01T08:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'A vs B',
              selection: 'A gana',
              visibleOdds: '1.95',
            },
          ],
        }).expect(201)
      ).body as { id: string; version: number };

      // Disponible = 500 - 20 comprometido (stake 2.00 × unidad 10.00) = 480.00.
      await confirm('owner', { officialAvailable: '480.00' }).expect(201);
      expect((await status('owner').expect(200)).body).toMatchObject({
        requiresReconciliation: false,
      });

      const newStage = (
        await request(ctx.server)
          .post(`${base()}/stages`)
          .set('Cookie', cookies.owner)
          .send({ name: 'Etapa 2', unitStake: '20.00' })
          .expect(201)
      ).body as { id: string };
      // Mover a la nueva etapa cambia el comprometido calculado (2.00 × 20.00 = 40.00, no 20.00):
      // el checkpoint que asumía 480.00 de disponible ya no es correcto.
      await moveBetStage('owner', bet.id, { stageId: newStage.id, version: bet.version }).expect(
        200,
      );

      expect((await status('owner').expect(200)).body).toMatchObject({
        requiresReconciliation: true,
      });
    });

    it('H1: mover una pendiente CON monto oficial confirmado no invalida nada', async () => {
      const bet = (
        await createBet('collab', {
          houseId,
          stageId,
          stake: '2.00',
          officialAmount: '25.00',
          visibleTotalOdds: '1.95',
          // Antes del checkpoint, igual que en la prueba anterior: si esto invalidara, sería por
          // el monto oficial (no debería), no porque la apuesta quedara fuera de la comparación.
          placedAt: '2026-06-01T08:00:00.000Z',
          selections: [
            {
              eventGroup: 0,
              position: 0,
              event: 'A vs B',
              selection: 'A gana',
              visibleOdds: '1.95',
            },
          ],
        }).expect(201)
      ).body as { id: string; version: number };

      // Disponible = 500 - 25 (monto oficial, no depende de la unidad) = 475.00.
      await confirm('owner', { officialAvailable: '475.00' }).expect(201);

      const newStage = (
        await request(ctx.server)
          .post(`${base()}/stages`)
          .set('Cookie', cookies.owner)
          .send({ name: 'Etapa 2', unitStake: '20.00' })
          .expect(201)
      ).body as { id: string };
      await moveBetStage('owner', bet.id, { stageId: newStage.id, version: bet.version }).expect(
        200,
      );

      // El comprometido sigue siendo 25.00 (monto oficial): el checkpoint sigue siendo válido.
      expect((await status('owner').expect(200)).body).toMatchObject({
        requiresReconciliation: false,
      });
    });
  });

  describe('revisar desde última conciliación (§32.2)', () => {
    it('sin checkpoint previo, muestra todo desde el origen', async () => {
      await createBet('collab', {
        houseId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T20:00:00.000Z',
        selections: [
          { eventGroup: 0, position: 0, event: 'A vs B', selection: 'A gana', visibleOdds: '1.95' },
        ],
      }).expect(201);
      const body = (await review('owner').expect(200)).body as {
        since: string | null;
        bets: unknown[];
      };
      expect(body.since).toBeNull();
      expect(body.bets).toHaveLength(1);
    });

    it('con checkpoint previo, solo muestra actividad posterior', async () => {
      await confirm('owner', { officialAvailable: '500.00' }).expect(201);
      await createBet('collab', {
        houseId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-07-01T00:00:00.000Z',
        selections: [
          { eventGroup: 0, position: 0, event: 'A vs B', selection: 'A gana', visibleOdds: '1.95' },
        ],
      }).expect(201);
      const body = (await review('owner').expect(200)).body as {
        since: string | null;
        bets: unknown[];
      };
      expect(body.since).not.toBeNull();
      expect(body.bets).toHaveLength(1);
    });
  });

  describe('permisos de consulta (§109.5)', () => {
    it('todo rol de proyecto puede consultar list/status/review', async () => {
      for (const actor of ['admin', 'collab', 'reader'] as const) {
        await list(actor).expect(200);
        await status(actor).expect(200);
        await review(actor).expect(200);
      }
    });
  });
});
