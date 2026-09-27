import type { BetDetail, BetSummary, TrashItem, UnconfirmedReturnItem } from '@letfer/shared';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bets,
  financialMovements,
  importBatches,
  type ImportBatchRow,
  type UserRow,
} from '../src/database/schema/index.js';
import {
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

type Actor = 'owner' | 'admin' | 'collab';
type BatchStatus = 'IMPORTED' | 'ANNULLED';

const selection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};
const SETTLED = '2026-06-01T14:00:00.000Z';
const REASON = 'Prueba de guardia de lote';
const FILE = Buffer.from('archivo original');
const now = new Date('2026-06-01T12:00:00.000Z');

/**
 * Fase 9.1.4 (§113.8, D-X25): una apuesta de un lote anulado no se restaura ni se corrige de forma
 * individual, no aparece en la papelera ni en los listados, y no cuenta como retorno por confirmar;
 * una apuesta de un lote importado vigente se comporta como cualquier otra. Todavía no existe el
 * escritor de importación: el lote y su anulación se simulan con la base de datos (la anulación
 * real revertirá el ledger con el motor de correcciones; aquí se usa la papelera, que ya lo hace).
 */
describe('guardas de las apuestas de un lote (e2e, PostgreSQL real, §113.8)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  let owner: UserRow;
  let salt = 0;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.owner = owner = await ctx.createUser({ email: 'owner@example.com' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Grupo' })).project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
    await request(ctx.server)
      .post(api('/setup'))
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    houseId = (await get<{ id: string }[]>('/houses'))[0]!.id;
  });

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const req = (actor: Actor, method: 'get' | 'post', path: string, body?: object) => {
    const r = request(ctx.server)[method](api(path)).set('Cookie', cookies[actor]);
    return body ? r.send(body) : r;
  };
  const get = <T>(path: string, actor: Actor = 'owner') =>
    req(actor, 'get', path)
      .expect(200)
      .then((response) => response.body as T);
  const post = (path: string, body: object = {}, actor: Actor = 'admin') =>
    req(actor, 'post', path, body);
  const reauth = () =>
    request(ctx.server)
      .post('/api/auth/reauth')
      .set('Cookie', cookies.admin)
      .send({ password: TEST_PASSWORD })
      .expect(200);
  const invariant = () => assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner });
  const ledgerRows = async () => (await ctx.t.db.select().from(financialMovements)).length;

  const pendingBet = async () =>
    (
      await post('/bets', {
        houseId,
        stake: '2.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T13:00:00.000Z',
        selections: [selection],
      }).expect(201)
    ).body as BetDetail;
  const settledBet = async () => {
    const bet = await pendingBet();
    return (
      await post(`/bets/${bet.id}/settle`, {
        status: 'WON',
        settledAt: SETTLED,
        version: bet.version,
      }).expect(200)
    ).body as BetDetail;
  };
  const detail = (id: string) => get<BetDetail>(`/bets/${id}`);
  const trash = async (bet: BetDetail) => {
    if (bet.status !== 'PENDING') await reauth();
    return post(`/bets/${bet.id}/trash`, { reason: REASON, version: bet.version });
  };
  const restore = async (bet: BetDetail) => {
    if (bet.status !== 'PENDING') await reauth();
    return post(`/bets/${bet.id}/restore`, { reason: REASON });
  };

  /** Lote simulado en el estado pedido, con la apuesta asociada a él. */
  async function attachToBatch(betId: string, status: BatchStatus): Promise<ImportBatchRow> {
    salt += 1;
    const bytes = Buffer.concat([FILE, Buffer.from(String(salt))]);
    const [uploaded] = await ctx.t.db
      .insert(importBatches)
      .values({
        projectId,
        originalName: 'Betano.xlsx',
        sourceFile: bytes,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceSizeBytes: bytes.length,
        createdBy: owner.id,
      })
      .returning();
    const step = (values: Partial<typeof importBatches.$inferInsert>) =>
      ctx.t.db
        .update(importBatches)
        .set(values)
        .where(eq(importBatches.id, uploaded!.id))
        .returning()
        .then((rows) => rows[0]!);
    await step({ status: 'VALIDATED', houseId, validatedAt: now, validatedBy: owner.id });
    let batch = await step({
      status: 'IMPORTED',
      importedAt: now,
      importedBy: owner.id,
      importReason: 'Historial',
      report: {},
    });
    if (status === 'ANNULLED') {
      batch = await step({
        status: 'ANNULLED',
        annulledAt: now,
        annulledBy: owner.id,
        annulmentReason: 'Lote anulado',
      });
    }
    await ctx.t.db.update(bets).set({ batchId: batch.id }).where(eq(bets.id, betId));
    return batch;
  }

  describe('apuesta ordinaria y de un lote importado vigente: reglas normales', () => {
    it('una apuesta ordinaria pendiente o liquidada se sigue eliminando y restaurando', async () => {
      const pending = await pendingBet();
      await trash(pending).then((r) => expect(r.status).toBe(200));
      await restore(pending).then((r) => expect(r.status).toBe(200));
      const settled = await settledBet();
      await trash(await detail(settled.id)).then((r) => expect(r.status).toBe(200));
      await restore(await detail(settled.id)).then((r) => expect(r.status).toBe(200));
      expect(await detail(settled.id)).toMatchObject({ batchId: null, batchStatus: null });
      await invariant();
    });

    it('una apuesta de un lote importado vigente sigue las mismas reglas y se identifica', async () => {
      const pending = await pendingBet();
      const settled = await settledBet();
      const batch = await attachToBatch(pending.id, 'IMPORTED');
      await attachToBatch(settled.id, 'IMPORTED');

      expect(await detail(pending.id)).toMatchObject({
        batchId: batch.id,
        batchStatus: 'IMPORTED',
      });
      await trash(await detail(pending.id)).then((r) => expect(r.status).toBe(200));
      await trash(await detail(settled.id)).then((r) => expect(r.status).toBe(200));

      // Aparecen en la papelera con su lote.
      const items = await get<TrashItem[]>('/trash');
      expect(items.map((i) => [i.id, i.batchStatus]).sort()).toEqual(
        [pending.id, settled.id].map((id) => [id, 'IMPORTED']).sort(),
      );
      expect(items.every((i) => i.batchId !== null)).toBe(true);

      await restore(await detail(pending.id)).then((r) => expect(r.status).toBe(200));
      await restore(await detail(settled.id)).then((r) => expect(r.status).toBe(200));
      await invariant();
    });

    it('sus ganadas provisionales aparecen en los retornos por confirmar, con su lote', async () => {
      const ordinary = await settledBet();
      const imported = await settledBet();
      const batch = await attachToBatch(imported.id, 'IMPORTED');

      const all = await get<UnconfirmedReturnItem[]>('/bets/unconfirmed-returns');
      expect(all.map((i) => i.betId).sort()).toEqual([ordinary.id, imported.id].sort());
      expect(all.find((i) => i.betId === imported.id)!.batchId).toBe(batch.id);
      expect(all.find((i) => i.betId === ordinary.id)!.batchId).toBeNull();
      expect(
        (await get<{ retornosPorConfirmar: number }>('/dashboard/status')).retornosPorConfirmar,
      ).toBe(2);

      // Filtro por lote.
      const onlyBatch = await get<UnconfirmedReturnItem[]>(
        `/bets/unconfirmed-returns?batchId=${batch.id}`,
      );
      expect(onlyBatch.map((i) => i.betId)).toEqual([imported.id]);
      await req('owner', 'get', '/bets/unconfirmed-returns?batchId=no-es-uuid').expect(400);
      await invariant();
    });
  });

  describe('apuesta de un lote anulado (D-X25)', () => {
    it('una pendiente eliminada no puede restaurarse y no vuelve a comprometer saldo', async () => {
      const bet = await pendingBet();
      await trash(bet).then((r) => expect(r.status).toBe(200));
      await attachToBatch(bet.id, 'ANNULLED');
      const rowsBefore = await ledgerRows();
      const status = await get<{ capitalActual: string; comprometido: string }>(
        '/dashboard/status',
      );

      const response = await restore(await detail(bet.id));
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('INVALID_STATE');

      const after = await detail(bet.id);
      expect(after.deletedAt).not.toBeNull();
      expect(after).toMatchObject({ batchStatus: 'ANNULLED' });
      expect(await ledgerRows()).toBe(rowsBefore);
      expect(await get('/dashboard/status')).toMatchObject(status);
      await invariant();
    });

    it('una liquidada eliminada no puede restaurarse ni vuelve a registrar el ledger', async () => {
      const bet = await settledBet();
      await trash(await detail(bet.id)).then((r) => expect(r.status).toBe(200));
      await attachToBatch(bet.id, 'ANNULLED');
      const rowsBefore = await ledgerRows();

      const response = await restore(await detail(bet.id)); // con reautenticación y motivo
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('INVALID_STATE');
      expect((await detail(bet.id)).deletedAt).not.toBeNull();
      expect(await ledgerRows()).toBe(rowsBefore);
      await invariant();
    });

    it('no admite ninguna corrección: corregir, reabrir ni liquidar', async () => {
      const bet = await settledBet();
      await trash(await detail(bet.id)).then((r) => expect(r.status).toBe(200));
      await attachToBatch(bet.id, 'ANNULLED');
      const current = await detail(bet.id);
      await reauth();
      for (const [path, body] of [
        ['correct-settlement', { status: 'LOST', reason: REASON, version: current.version }],
        ['reopen', { reason: REASON, version: current.version }],
      ] as const) {
        expect((await post(`/bets/${bet.id}/${path}`, body)).status, path).toBe(409);
      }
      await invariant();
    });

    it('no aparece en la papelera, en el listado de eliminadas ni en los retornos', async () => {
      const pending = await pendingBet();
      const settled = await settledBet();
      const visible = await settledBet(); // ordinaria: control
      await trash(pending).then((r) => expect(r.status).toBe(200));
      await trash(await detail(settled.id)).then((r) => expect(r.status).toBe(200));
      await attachToBatch(pending.id, 'ANNULLED');
      await attachToBatch(settled.id, 'ANNULLED');

      expect(await get<TrashItem[]>('/trash')).toEqual([]);
      expect(await get<BetSummary[]>('/bets?status=TRASHED')).toEqual([]);
      expect((await get<BetSummary[]>('/bets')).map((b) => b.id)).toEqual([visible.id]);
      expect(
        (await get<UnconfirmedReturnItem[]>('/bets/unconfirmed-returns')).map((i) => i.betId),
      ).toEqual([visible.id]);
      // El detalle sigue disponible y la identifica como parte de un lote anulado.
      expect(await detail(settled.id)).toMatchObject({ batchStatus: 'ANNULLED' });
      await invariant();
    });

    it('un lote anulado nunca cuenta como retorno por confirmar, aunque la apuesta siguiera viva', async () => {
      // Estado defensivo (la anulación real elimina las apuestas del lote): la exclusión de los
      // informes no depende de que la apuesta esté eliminada.
      const bet = await settledBet();
      const batch = await attachToBatch(bet.id, 'ANNULLED');
      expect(await get<UnconfirmedReturnItem[]>('/bets/unconfirmed-returns')).toEqual([]);
      expect(
        await get<UnconfirmedReturnItem[]>(`/bets/unconfirmed-returns?batchId=${batch.id}`),
      ).toEqual([]);
      expect(
        (await get<{ retornosPorConfirmar: number }>('/dashboard/status')).retornosPorConfirmar,
      ).toBe(0);
      expect(
        (await get<{ unconfirmedReturns: { count: number } }>('/dashboard/analysis'))
          .unconfirmedReturns.count,
      ).toBe(0);
      expect(await get<{ compared: number }>('/bets/return-differences')).toMatchObject({
        compared: 0,
      });
    });
  });

  describe('diferencias de retorno', () => {
    it('excluyen el lote anulado, incluyen el vigente y se pueden filtrar por lote', async () => {
      const officialBet = async (official: string) => {
        const bet = await pendingBet();
        return (
          await post(`/bets/${bet.id}/settle`, {
            status: 'WON',
            officialRealizedReturn: official,
            settledAt: SETTLED,
            version: bet.version,
          }).expect(200)
        ).body as BetDetail;
      };
      const ordinary = await officialBet('39.10'); // calculado 39.00: difiere
      const imported = await officialBet('39.10');
      const annulled = await officialBet('39.10');
      const active = await attachToBatch(imported.id, 'IMPORTED');
      await attachToBatch(annulled.id, 'ANNULLED');

      const report = await get<{
        compared: number;
        items: { betId: string; batchId: string | null }[];
      }>('/bets/return-differences');
      expect(report.compared).toBe(2);
      expect(report.items.map((i) => i.betId).sort()).toEqual([ordinary.id, imported.id].sort());
      expect(report.items.find((i) => i.betId === imported.id)!.batchId).toBe(active.id);

      const onlyBatch = await get<{ compared: number; items: { betId: string }[] }>(
        `/bets/return-differences?batchId=${active.id}`,
      );
      expect(onlyBatch.items.map((i) => i.betId)).toEqual([imported.id]);
    });
  });
});
