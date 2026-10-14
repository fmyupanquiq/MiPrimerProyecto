import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bets, betDrafts, financialMovements, type UserRow } from '../src/database/schema/index.js';
import { bodyOf, createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

/*
 * Borradores de "Añadir apuesta" (ADR 0024) e idempotencia del registro. Un borrador NO es una apuesta:
 * no crea movimientos, no reserva saldo y solo lo ve quien lo creó.
 */

type Actor = 'owner' | 'collab' | 'reader' | 'stranger';

interface DraftBody {
  id: string;
  summary: string;
  version: number;
  ticketId: string | null;
  payload?: { houseId: string; stake: string; selections: { event: string }[] };
  code?: string;
}
interface BetBody {
  id: string;
  version: number;
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04]);

const payload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  format: 'MULTIPLE',
  houseId: '',
  placed: { date: '2026-10-10', time: '20:05' },
  placedTimeKnown: true,
  selections: [
    {
      eventGroup: 0,
      position: 0,
      sport: 'Fútbol',
      event: 'Universitario de Deportes - FBC Melgar',
      market: 'Doble oportunidad',
      selection: '1X',
      visibleOdds: '2.15',
      legScore: '2-2',
      legResult: '',
      conditionStatus: '',
    },
    {
      eventGroup: 1,
      position: 0,
      sport: 'Fútbol',
      event: 'Liverpool FC - Manchester City',
      market: 'Resultado del partido',
      selection: 'Manchester City',
      visibleOdds: '2.47',
      legScore: '',
      legResult: '',
      conditionStatus: '',
    },
    {
      eventGroup: 1,
      position: 1,
      sport: 'Fútbol',
      event: 'Liverpool FC - Manchester City',
      market: 'Manchester City Más/Menos Córners',
      selection: 'Más de 2.5',
      visibleOdds: '',
      legScore: '',
      legResult: '',
      conditionStatus: '',
    },
  ],
  totalOdds: '',
  oddsKindChoice: null,
  calculatedOdds: null,
  stake: '',
  customStake: false,
  status: 'PENDING',
  statusChosen: false,
  statusFromAi: false,
  settled: { date: '2026-10-10', time: '22:00' },
  profitOverride: null,
  officialAmount: '10.00',
  officialPotentialReturn: '',
  reason: '',
  ticketId: null,
  aiApplied: false,
  ...overrides,
});

describe('borradores de apuesta (e2e, PostgreSQL real, ADR 0024)', () => {
  let ctx: TestApp;
  let ticketsDir: string;
  let projectId: string;
  let otherProjectId: string;
  let houseId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ticketsDir = `.data/test-tickets-${randomUUID()}`;
    ctx = await createTestApp({ env: { TICKETS_DIR: ticketsDir } });
  });
  afterAll(async () => {
    await ctx.close();
    await rm(ticketsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-10-10T12:00:00.000Z');
    for (const actor of ['owner', 'collab', 'reader', 'stranger'] as const) {
      people[actor] = await ctx.createUser({ email: `${actor}@example.com` });
    }
    projectId = (await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' })).project.id;
    await insertMember(ctx.t.db, {
      projectId,
      userId: people.collab.id,
      roleKey: 'COLLABORATOR',
    });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const actor of ['owner', 'collab', 'reader', 'stranger'] as const) {
      cookies[actor] = sessionCookie(await login(ctx.server, people[actor].email).expect(200))!;
    }
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '2.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = (
      (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookies.owner)
      ).body as { id: string }[]
    )[0]!.id;
    otherProjectId = (await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' }))
      .project.id;
  });

  const drafts = (actor: Actor, id = '', proj = projectId) =>
    request(ctx.server)
      .get(`/api/projects/${proj}/bet-drafts${id ? `/${id}` : ''}`)
      .set('Cookie', cookies[actor]);
  const save = (actor: Actor, body: object, proj = projectId) =>
    request(ctx.server)
      .post(`/api/projects/${proj}/bet-drafts`)
      .set('Cookie', cookies[actor])
      .send(body);
  const put = (actor: Actor, id: string, body: object) =>
    request(ctx.server)
      .put(`/api/projects/${projectId}/bet-drafts/${id}`)
      .set('Cookie', cookies[actor])
      .send(body);
  const discard = (actor: Actor, id: string) =>
    request(ctx.server)
      .delete(`/api/projects/${projectId}/bet-drafts/${id}`)
      .set('Cookie', cookies[actor]);
  const ledger = async () =>
    (await ctx.t.db.select().from(financialMovements)).map((m) => [m.type, m.amount]);

  it('guardar, listar, recuperar y actualizar: la estructura vuelve exacta (4 legs lógicos, 5 filas)', async () => {
    const created = bodyOf(
      await save('owner', {
        payload: payload({ houseId }),
        summary: 'Betano · Liverpool FC - Manchester City',
      }).expect(201),
    ) as unknown as DraftBody;
    expect(created).toMatchObject({
      version: 1,
      summary: 'Betano · Liverpool FC - Manchester City',
    });

    const list = bodyOf(await drafts('owner').expect(200)) as unknown as DraftBody[];
    expect(list.map((d) => d.id)).toEqual([created.id]);
    expect(list[0]).not.toHaveProperty('payload'); // la lista es un resumen

    const fetched = bodyOf(await drafts('owner', created.id).expect(200)) as unknown as DraftBody;
    expect(fetched.payload).toEqual(payload({ houseId }));

    const updated = bodyOf(
      await put('owner', created.id, {
        payload: payload({ houseId, stake: '5' }),
        summary: 'v2',
        version: created.version,
      }).expect(200),
    ) as unknown as DraftBody;
    expect(updated).toMatchObject({ version: 2, summary: 'v2' });
    expect(((await drafts('owner', created.id)).body as DraftBody).payload!.stake).toBe('5');
  });

  it('un borrador NO es una apuesta: ni movimientos, ni reserva de saldo, ni figura en la lista de apuestas', async () => {
    const before = await ledger();
    await save('owner', { payload: payload({ houseId, stake: '5' }), summary: 'x' }).expect(201);
    expect(await ledger()).toEqual(before);
    expect(await ctx.t.db.select().from(bets)).toEqual([]);
    const houses = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
    ).body as { balance: string; committed: string; available: string }[];
    expect(houses[0]).toMatchObject({ balance: '500.00', committed: '0.00', available: '500.00' });
    const betList = (
      await request(ctx.server).get(`/api/projects/${projectId}/bets`).set('Cookie', cookies.owner)
    ).body as unknown[];
    expect(betList).toEqual([]);
    await assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner });
  });

  it('solo su dueño lo ve: otro miembro con permiso recibe 404 al leer, editar y descartar', async () => {
    const created = bodyOf(
      await save('owner', { payload: payload(), summary: 'mío' }).expect(201),
    ) as unknown as DraftBody;
    expect(((await drafts('collab').expect(200)).body as DraftBody[]).length).toBe(0);
    await drafts('collab', created.id).expect(404);
    await put('collab', created.id, {
      payload: payload(),
      summary: 'ajeno',
      version: created.version,
    }).expect(404);
    await discard('collab', created.id).expect(404);
    // Sigue intacto para su dueño.
    expect(((await drafts('owner', created.id)).body as DraftBody).summary).toBe('mío');
  });

  it('exige bets.create y pertenecer al proyecto: Lector 403, ajeno 404, sin sesión 401', async () => {
    await save('reader', { payload: payload(), summary: '' }).expect(403);
    await drafts('reader').expect(403);
    await save('stranger', { payload: payload(), summary: '' }).expect(404);
    await request(ctx.server).get(`/api/projects/${projectId}/bet-drafts`).expect(401);
    // Un borrador de otro proyecto no se lee desde este.
    await request(ctx.server)
      .post(`/api/projects/${otherProjectId}/setup`)
      .set('Cookie', cookies.stranger)
      .send({ unitStake: '2.00', houses: [{ name: 'Casa', initialAmount: '100.00' }] })
      .expect(201);
    const foreign = bodyOf(
      await save('stranger', { payload: payload(), summary: 'otro' }, otherProjectId).expect(201),
    ) as unknown as DraftBody;
    await drafts('owner', foreign.id).expect(404);
  });

  it('versión obsoleta ⇒ 409; descartar es lógico y lo saca de la lista', async () => {
    const created = bodyOf(
      await save('owner', { payload: payload(), summary: 'a' }).expect(201),
    ) as unknown as DraftBody;
    await put('owner', created.id, {
      payload: payload(),
      summary: 'b',
      version: created.version,
    }).expect(200);
    const stale = await put('owner', created.id, {
      payload: payload(),
      summary: 'c',
      version: created.version,
    }).expect(409);
    expect((stale.body as DraftBody).code).toBe('CONCURRENCY_CONFLICT');

    await discard('owner', created.id).expect(204);
    expect(((await drafts('owner')).body as DraftBody[]).length).toBe(0);
    await drafts('owner', created.id).expect(404);
    const [row] = await ctx.t.db.select().from(betDrafts); // borrado lógico: la fila se conserva
    expect(row!.deletedAt).not.toBeNull();
  });

  it('rechaza contenido inválido, demasiado grande o con un ticket de otro proyecto', async () => {
    await save('owner', { payload: payload({ format: 'TRIPLE' }), summary: '' }).expect(400);
    await save('owner', { payload: { ...payload(), schemaVersion: 2 }, summary: '' }).expect(400);
    await save('owner', { payload: payload({ selections: [] }), summary: '' }).expect(400);
    await save('owner', {
      payload: payload({ reason: 'x'.repeat(2000) }),
      summary: '',
    }).expect(400);
    await save('owner', {
      payload: payload({ ticketId: randomUUID() }),
      summary: '',
    }).expect(400);
    expect(await ctx.t.db.select().from(betDrafts)).toEqual([]);
  });

  it('un ticket ya subido puede acompañar al borrador sin vincularse a ninguna apuesta', async () => {
    const ticket = bodyOf(
      await request(ctx.server)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Cookie', cookies.owner)
        .attach('file', JPEG_BYTES, 'ticket.jpg')
        .expect(201),
    ) as unknown as { id: string };
    const created = bodyOf(
      await save('owner', {
        payload: payload({ ticketId: ticket.id }),
        summary: 'con ticket',
      }).expect(201),
    ) as unknown as DraftBody;
    expect(created.ticketId).toBe(ticket.id);
    expect(await ctx.t.db.select().from(bets)).toEqual([]);
  });

  it('GET de un ticket suelto (para retomar un borrador): con tickets.view sí, sin pertenecer al proyecto 404', async () => {
    const ticket = bodyOf(
      await request(ctx.server)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Cookie', cookies.owner)
        .attach('file', JPEG_BYTES, 'ticket.jpg')
        .expect(201),
    ) as unknown as { id: string };
    const get = (actor: Actor, id: string) =>
      request(ctx.server)
        .get(`/api/projects/${projectId}/tickets/${id}`)
        .set('Cookie', cookies[actor]);
    expect((await get('owner', ticket.id).expect(200)).body).toMatchObject({
      id: ticket.id,
      betId: null,
      originalFileName: 'ticket.jpg',
      lastAnalysis: null,
    });
    await get('reader', ticket.id).expect(200);
    await get('stranger', ticket.id).expect(404);
    await get('owner', 'no-es-un-id').expect(404);
  });

  it('límite de 25 borradores vivos por persona', async () => {
    for (let i = 0; i < 25; i += 1) {
      await save('owner', { payload: payload(), summary: `d${i}` }).expect(201);
    }
    await save('owner', { payload: payload(), summary: 'd26' }).expect(409);
    // Otra persona no se ve afectada.
    await save('collab', { payload: payload(), summary: 'mío' }).expect(201);
  });

  describe('registro idempotente (clientRequestId)', () => {
    const body = (extra: Record<string, unknown> = {}) => ({
      houseId,
      stake: '1',
      visibleTotalOdds: '1.95',
      totalOddsSource: 'OFFICIAL',
      placedAt: '2026-10-10T20:05:00.000Z',
      selections: [
        {
          eventGroup: 0,
          position: 0,
          event: 'A - B',
          market: 'M',
          selection: 'X',
          visibleOdds: '1.95',
        },
      ],
      ...extra,
    });
    const post = (actor: Actor, b: object) =>
      request(ctx.server)
        .post(`/api/projects/${projectId}/bets`)
        .set('Cookie', cookies[actor])
        .send(b);

    it('el mismo intento repetido devuelve la misma apuesta y no duplica nada', async () => {
      const key = randomUUID();
      const first = bodyOf(
        await post('owner', body({ clientRequestId: key })).expect(201),
      ) as unknown as BetBody;
      const again = bodyOf(
        await post('owner', body({ clientRequestId: key })).expect(201),
      ) as unknown as BetBody;
      expect(again.id).toBe(first.id);
      expect(await ctx.t.db.select().from(bets)).toHaveLength(1);
      const reserved = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookies.owner)
      ).body as { committed: string }[];
      expect(reserved[0]!.committed).toBe('2.00'); // 1 × S/ 2.00: reservado UNA sola vez
      await assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner });
    });

    it('dos envíos simultáneos con la misma clave crean una sola apuesta', async () => {
      const key = randomUUID();
      const results = await Promise.all([
        post('owner', body({ clientRequestId: key })),
        post('owner', body({ clientRequestId: key })),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(new Set(results.map((r) => (r.body as BetBody).id)).size).toBe(1);
      expect(await ctx.t.db.select().from(bets)).toHaveLength(1);
    });

    it('sin clave, o con claves distintas, son apuestas distintas; la clave de otra persona no sirve', async () => {
      await post('owner', body()).expect(201);
      await post('owner', body()).expect(201);
      const key = randomUUID();
      const a = bodyOf(
        await post('owner', body({ clientRequestId: key })).expect(201),
      ) as unknown as BetBody;
      const b = bodyOf(
        await post('collab', body({ clientRequestId: key })).expect(201),
      ) as unknown as BetBody;
      expect(a.id).not.toBe(b.id);
      expect(await ctx.t.db.select().from(bets)).toHaveLength(4);
    });

    it('una clave mal formada se rechaza con 400', async () => {
      await post('owner', body({ clientRequestId: 'no-es-un-uuid' })).expect(400);
    });
  });
});
