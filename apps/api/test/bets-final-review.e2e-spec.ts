import type { AuditLogPage, BetDetail } from '@letfer/shared';
import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import {
  auditLogs,
  betCorrections,
  bets,
  financialMovements,
  projects,
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

type Actor = 'owner' | 'admin' | 'collab' | 'reader' | 'stranger' | 'root';

const selection = {
  eventGroup: 0,
  position: 0,
  event: 'Real Madrid vs. Barcelona',
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
};
const SETTLED = '2026-06-01T14:00:00.000Z';
const REASON = 'Revisión final';

/**
 * Fase 8.5.6: revisión final de la Fase 8.5 (ADR 0019). Comprueba, con PostgreSQL real, la matriz
 * de permisos de todas las operaciones nuevas, que cada una deja su auditoría (y las rechazadas
 * ninguna), la atomicidad, la concurrencia entre operaciones distintas y el criterio de aceptación.
 */
describe('revisión final de la Fase 8.5 (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
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
    houseId = ((await get('owner', '/houses').expect(200)).body as { id: string }[])[0]!.id;
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
  const invariant = (options: { reconcile?: boolean } = {}) =>
    assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner, ...options });

  let betCounter = 0;
  const newBet = async () =>
    (
      await post('collab', '/bets', {
        houseId,
        stake: '2.00',
        visibleTotalOdds: '1.95',
        placedAt: `2026-06-01T13:${String(betCounter++ % 60).padStart(2, '0')}:00.000Z`,
        selections: [selection],
      }).expect(201)
    ).body as BetDetail;
  /** Ganada de S/ 20.00 liquidada por el Administrador: con o sin retorno oficial. */
  const settledWin = async (official: string | null): Promise<BetDetail> => {
    const bet = await newBet();
    return (
      await post('admin', `/bets/${bet.id}/settle`, {
        status: 'WON',
        ...(official ? { officialRealizedReturn: official } : {}),
        settledAt: SETTLED,
        version: bet.version,
      }).expect(200)
    ).body as BetDetail;
  };
  const detail = async (betId: string) =>
    (await get('owner', `/bets/${betId}`).expect(200)).body as BetDetail;
  const rows = () => ctx.t.db.select().from(financialMovements);
  const corrections = () => ctx.t.db.select().from(betCorrections);
  const auditOf = (action: string) =>
    ctx.t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, action))
      .orderBy(asc(auditLogs.occurredAt));

  // --- 1. Permisos -----------------------------------------------------------------------------

  describe('matriz de permisos de las operaciones nuevas (D-A8, D-A11)', () => {
    const allowed: Actor[] = ['owner', 'admin', 'root'];
    const denied: Actor[] = ['collab', 'reader'];

    interface Operation {
      name: string;
      /** Deja una apuesta en el estado que la operación necesita. */
      prepare: () => Promise<BetDetail>;
      call: (actor: Actor, bet: BetDetail) => request.Test;
      /** Comprueba que la apuesta no cambió tras un intento denegado. */
      unchanged: (before: BetDetail) => Promise<void>;
    }
    const sameVersion = async (before: BetDetail) => {
      expect((await detail(before.id)).version).toBe(before.version);
    };
    const operations: Operation[] = [
      {
        name: 'confirmar el retorno oficial',
        prepare: () => settledWin(null),
        call: (actor, bet) =>
          post(actor, `/bets/${bet.id}/confirm-return`, {
            version: bet.version,
            officialRealizedReturn: '39.00',
          }),
        unchanged: sameVersion,
      },
      {
        name: 'corregir la liquidación',
        prepare: () => settledWin('39.00'),
        call: (actor, bet) =>
          post(actor, `/bets/${bet.id}/correct-settlement`, {
            version: bet.version,
            reason: REASON,
            status: 'LOST',
          }),
        unchanged: sameVersion,
      },
      {
        name: 'previsualizar una corrección',
        prepare: () => settledWin('39.00'),
        call: (actor, bet) =>
          post(actor, `/bets/${bet.id}/correct-settlement/preview`, {
            version: bet.version,
            reason: REASON,
            status: 'LOST',
          }),
        unchanged: sameVersion,
      },
      {
        name: 'reabrir',
        prepare: () => settledWin('39.00'),
        call: (actor, bet) =>
          post(actor, `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON }),
        unchanged: sameVersion,
      },
      {
        name: 'previsualizar una reapertura',
        prepare: () => settledWin('39.00'),
        call: (actor, bet) =>
          post(actor, `/bets/${bet.id}/reopen/preview`, { version: bet.version, reason: REASON }),
        unchanged: sameVersion,
      },
      {
        name: 'enviar a la papelera una liquidada',
        prepare: () => settledWin('39.00'),
        call: (actor, bet) => post(actor, `/bets/${bet.id}/trash`, { reason: REASON }),
        unchanged: async (before) => expect((await detail(before.id)).deletedAt).toBeNull(),
      },
      {
        name: 'restaurar una liquidada',
        prepare: async () => {
          const bet = await settledWin('39.00');
          await post('admin', `/bets/${bet.id}/trash`, { reason: 'Error' }).expect(200);
          return bet;
        },
        call: (actor, bet) => post(actor, `/bets/${bet.id}/restore`, { reason: REASON }),
        unchanged: async (before) => expect((await detail(before.id)).deletedAt).not.toBeNull(),
      },
    ];

    for (const operation of operations) {
      it(`${operation.name}: Administrador, propietario y Administrador Global sí; Colaborador y Lector, 403; ajeno, 404`, async () => {
        for (const actor of allowed) {
          const bet = await operation.prepare();
          const response = await operation.call(actor, bet);
          expect(
            response.status,
            `${operation.name} como ${actor}: ${JSON.stringify(response.body)}`,
          ).toBe(200);
        }
        for (const actor of denied) {
          const bet = await operation.prepare();
          const before = await detail(bet.id);
          const response = await operation.call(actor, bet);
          expect(response.status, `${operation.name} como ${actor}`).toBe(403);
          await operation.unchanged(before);
        }
        const bet = await operation.prepare();
        const response = await operation.call('stranger', bet);
        expect(response.status, `${operation.name} como ajeno`).toBe(404);
        await invariant();
      });
    }

    it('los reportes y el historial son de solo lectura para todos los miembros; un ajeno recibe 404', async () => {
      const bet = await settledWin(null);
      for (const path of [
        '/bets/unconfirmed-returns',
        '/bets/return-differences',
        `/bets/${bet.id}/ledger`,
      ]) {
        for (const actor of ['owner', 'admin', 'collab', 'reader', 'root'] as const) {
          expect((await get(actor, path)).status, `${path} como ${actor}`).toBe(200);
        }
        expect((await get('stranger', path)).status, `${path} como ajeno`).toBe(404);
        expect((await request(ctx.server).get(api(path))).status).toBe(401);
      }
    });

    it('sin sesión, ninguna operación nueva responde', async () => {
      const bet = await settledWin('39.00');
      for (const path of [
        'confirm-return',
        'correct-settlement',
        'correct-settlement/preview',
        'reopen',
        'reopen/preview',
      ]) {
        const response = await request(ctx.server)
          .post(api(`/bets/${bet.id}/${path}`))
          .send({ version: 1, reason: 'x' });
        expect(response.status, path).toBe(401);
      }
    });

    it('la reautenticación es obligatoria en corregir, reabrir y en eliminar o restaurar una liquidada', async () => {
      const bet = await settledWin('39.00');
      ctx.clock.advanceSeconds(6 * 60);
      const attempts = [
        () =>
          post('admin', `/bets/${bet.id}/correct-settlement`, {
            version: bet.version,
            reason: REASON,
            status: 'LOST',
          }),
        () => post('admin', `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON }),
        () => post('admin', `/bets/${bet.id}/trash`, { reason: REASON }),
      ];
      for (const attempt of attempts) {
        const response = await attempt();
        expect(response.status).toBe(403);
        expect(bodyOf(response).code).toBe('REAUTH_REQUIRED');
      }
      await reauth('admin');
      await post('admin', `/bets/${bet.id}/trash`, { reason: REASON }).expect(200);
      ctx.clock.advanceSeconds(6 * 60);
      const restore = await post('admin', `/bets/${bet.id}/restore`, { reason: REASON });
      expect(bodyOf(restore).code).toBe('REAUTH_REQUIRED');
    });
  });

  // --- 2. Auditoría ----------------------------------------------------------------------------

  describe('auditoría de cada operación financiera (§35, §112)', () => {
    it('cada operación deja exactamente un evento con actor, proyecto, entidad y su corrección', async () => {
      const bet = await settledWin(null); // bet.settled (retorno calculado)
      const confirmed = (
        await post('admin', `/bets/${bet.id}/confirm-return`, {
          version: bet.version,
          officialRealizedReturn: '38.00',
          acknowledgeDifference: true,
          reason: 'Ticket oficial',
        }).expect(200)
      ).body as BetDetail;
      const corrected = (
        await post('admin', `/bets/${bet.id}/correct-settlement`, {
          version: confirmed.version,
          reason: 'Retorno mal copiado',
          officialRealizedReturn: '40.00',
        }).expect(200)
      ).body as BetDetail;
      const reopened = (
        await post('admin', `/bets/${bet.id}/reopen`, {
          version: corrected.version,
          reason: 'Liquidada por error',
        }).expect(200)
      ).body as BetDetail;
      await post('admin', `/bets/${bet.id}/settle`, {
        status: 'WON',
        officialRealizedReturn: '41.00',
        settledAt: SETTLED,
        version: reopened.version,
      }).expect(200);
      await post('admin', `/bets/${bet.id}/trash`, { reason: 'Registrada por error' }).expect(200);
      await post('admin', `/bets/${bet.id}/restore`, { reason: 'Era correcta' }).expect(200);

      const byKind = new Map((await corrections()).map((row) => [row.kind, row]));
      const expected: [string, string, Record<string, unknown>][] = [
        [
          'bet.return_confirmed',
          'RETURN_CONFIRMATION',
          {
            differed: true,
            differenceAcknowledged: true,
            delta: '-1.00',
            calculatedRealizedReturn: '39.00',
          },
        ],
        [
          'bet.settlement_corrected',
          'SETTLEMENT_CORRECTION',
          { reason: 'Retorno mal copiado', ledgerChanged: true },
        ],
        ['bet.reopened', 'REOPEN', { reason: 'Liquidada por error', ledgerChanged: true }],
        ['bet.trashed', 'TRASH_REVERSAL', { reason: 'Registrada por error', ledgerReversal: true }],
        ['bet.restored', 'RESTORE_REPOST', { reason: 'Era correcta', ledgerRepost: true }],
      ];
      for (const [action, kind, metadata] of expected) {
        const entries = await auditOf(action);
        expect(entries, action).toHaveLength(1);
        expect(entries[0], action).toMatchObject({
          entityType: 'bet',
          entityId: bet.id,
          projectId,
          actorUserId: people.admin.id,
          metadata: { ...metadata, correctionId: byKind.get(kind as never)!.id },
        });
      }
      // La liquidación provisional y la segunda liquidación también quedan (sin corrección).
      const settles = await auditOf('bet.settled');
      expect(settles).toHaveLength(2);
      expect(settles[0]!.newValues).toMatchObject({ returnSource: 'CALCULATED' });
      expect(settles[1]!.newValues).toMatchObject({ returnSource: 'OFFICIAL' });

      // Los valores anteriores se conservan en la auditoría (p. ej. al reabrir).
      const [reopenLog] = await auditOf('bet.reopened');
      expect(reopenLog!.oldValues).toMatchObject({
        officialRealizedReturn: '40.00',
        status: 'WON',
      });
      await invariant({ reconcile: true });
    });

    it('confirmar sin diferencia se audita como tal: no acepta ninguna diferencia', async () => {
      const bet = await settledWin(null);
      await post('admin', `/bets/${bet.id}/confirm-return`, {
        version: bet.version,
        officialRealizedReturn: '39.00',
      }).expect(200);
      const [log] = await auditOf('bet.return_confirmed');
      expect(log!.metadata).toMatchObject({
        differed: false,
        differenceAcknowledged: false,
        ledgerChanged: false,
      });
    });

    it('las operaciones rechazadas no dejan auditoría, correcciones ni filas', async () => {
      const bet = await settledWin('39.00');
      // Un retiro posterior que solo cabe con el retorno: corregir a perdida es imposible.
      await ctx.t.db.insert(financialMovements).values({
        projectId,
        stageId: (await ctx.t.db.select().from(bets))[0]!.stageId,
        type: 'WITHDRAWAL',
        direction: 'DEBIT',
        houseId,
        amount: '519.00',
        reason: 'Retiro de prueba',
        occurredAt: new Date('2026-06-01T16:00:00.000Z'),
        createdBy: people.owner.id,
      });
      const before = {
        rows: (await rows()).length,
        audits: (await ctx.t.db.select().from(auditLogs)).length,
        corrections: (await corrections()).length,
      };
      const attempts = [
        () =>
          post('admin', `/bets/${bet.id}/correct-settlement`, {
            version: bet.version,
            reason: REASON,
            status: 'LOST',
          }), // conflicto
        () => post('admin', `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON }), // conflicto
        () =>
          post('admin', `/bets/${bet.id}/correct-settlement`, {
            version: bet.version + 9,
            reason: REASON,
            status: 'LOST',
          }), // versión
        () =>
          post('admin', `/bets/${bet.id}/correct-settlement`, {
            version: bet.version,
            status: 'LOST',
          }), // sin motivo
        () => post('collab', `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON }), // permiso
        () =>
          post('admin', `/bets/${bet.id}/confirm-return`, {
            version: bet.version,
            officialRealizedReturn: '39.00',
          }), // no provisional
      ];
      for (const attempt of attempts) expect((await attempt()).status).toBeLessThan(500);
      expect(
        {
          rows: (await rows()).length,
          audits: (await ctx.t.db.select().from(auditLogs)).length,
          corrections: (await corrections()).length,
        },
        // Las comprobaciones de permiso y de reautenticación no auditan; los conflictos, tampoco.
      ).toEqual(before);
    });

    it('la auditoría del proyecto muestra estos eventos al Administrador y sin datos de conexión', async () => {
      const bet = await settledWin(null);
      await post('admin', `/bets/${bet.id}/confirm-return`, {
        version: bet.version,
        officialRealizedReturn: '38.00',
        acknowledgeDifference: true,
      }).expect(200);
      const page = (await get('owner', '/audit-logs?action=bet.').expect(200)).body as AuditLogPage;
      const actions = page.items.map((item) => item.action);
      expect(actions).toContain('bet.return_confirmed');
      expect(actions).toContain('bet.settled');
      for (const item of page.items)
        expect(item).toMatchObject({ ip: null, userAgent: null, sessionId: null });
      // Ni secretos ni datos personales sensibles en los valores.
      expect(JSON.stringify(page.items)).not.toMatch(/password|token|secret|hash/i);
      expect((await get('collab', '/audit-logs')).status).toBe(403);
    });
  });

  // --- 3. Atomicidad y concurrencia --------------------------------------------------------------

  describe('atomicidad', () => {
    it('si falla la auditoría, la corrección se revierte por completo (nada a medias)', async () => {
      const bet = await settledWin('39.00');
      const snapshot = { rows: (await rows()).length, corrections: (await corrections()).length };
      vi.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(
        new Error('auditoría caída'),
      );
      const response = await post('admin', `/bets/${bet.id}/correct-settlement`, {
        version: bet.version,
        reason: REASON,
        status: 'LOST',
      });
      expect(response.status).toBe(500);
      expect({ rows: (await rows()).length, corrections: (await corrections()).length }).toEqual(
        snapshot,
      );
      expect(await detail(bet.id)).toMatchObject({ status: 'WON', version: bet.version });
      await invariant();
      // Al reintentar, funciona.
      await post('admin', `/bets/${bet.id}/correct-settlement`, {
        version: bet.version,
        reason: REASON,
        status: 'LOST',
      }).expect(200);
      await invariant();
    });
  });

  describe('concurrencia entre operaciones distintas', () => {
    it('confirmar y corregir a la vez la misma apuesta: solo una prospera', async () => {
      const bet = await settledWin(null);
      const [confirm, correct] = await Promise.all([
        post('admin', `/bets/${bet.id}/confirm-return`, {
          version: bet.version,
          officialRealizedReturn: '38.00',
          acknowledgeDifference: true,
        }),
        post('owner', `/bets/${bet.id}/correct-settlement`, {
          version: bet.version,
          reason: REASON,
          status: 'LOST',
        }),
      ]);
      expect([confirm.status, correct.status].sort()).toEqual([200, 409]);
      await invariant();
    });

    it('corregir y eliminar a la vez la misma apuesta: el resultado es coherente', async () => {
      const bet = await settledWin('39.00');
      const [correct, trash] = await Promise.all([
        post('admin', `/bets/${bet.id}/correct-settlement`, {
          version: bet.version,
          reason: REASON,
          officialRealizedReturn: '45.00',
        }),
        post('owner', `/bets/${bet.id}/trash`, { reason: REASON }),
      ]);
      expect(correct.status).toBeLessThan(500);
      expect(trash.status).toBeLessThan(500);
      expect([correct.status, trash.status]).toContain(200);
      await invariant();
    });

    it('varias apuestas de la misma casa con operaciones simultáneas: sin bloqueos mutuos y con el ledger coherente', async () => {
      const list = [
        await settledWin(null),
        await settledWin('39.00'),
        await settledWin(null),
        await settledWin('41.00'),
      ];
      const results = await Promise.all([
        post('admin', `/bets/${list[0]!.id}/confirm-return`, {
          version: list[0]!.version,
          officialRealizedReturn: '37.00',
          acknowledgeDifference: true,
        }),
        post('owner', `/bets/${list[1]!.id}/correct-settlement`, {
          version: list[1]!.version,
          reason: REASON,
          status: 'LOST',
        }),
        post('admin', `/bets/${list[2]!.id}/reopen`, { version: list[2]!.version, reason: REASON }),
        post('root', `/bets/${list[3]!.id}/trash`, { reason: REASON }),
        post('admin', `/bets/${list[1]!.id}/reopen/preview`, {
          version: list[1]!.version,
          reason: REASON,
        }),
        post('owner', `/bets/${list[0]!.id}/correct-settlement/preview`, {
          version: list[0]!.version,
          reason: REASON,
          status: 'LOST',
        }),
      ]);
      for (const response of results)
        expect(response.status, JSON.stringify(response.body)).toBeLessThan(500);
      // Las cuatro operaciones que escriben tocan apuestas distintas: todas prosperan.
      expect(results.slice(0, 4).map((r) => r.status)).toEqual([200, 200, 200, 200]);
      await invariant({ reconcile: true });
    });

    it('dos confirmaciones o reaperturas idénticas a la vez nunca duplican filas ni correcciones', async () => {
      const bet = await settledWin(null);
      const [a, b] = await Promise.all([
        post('admin', `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON }),
        post('owner', `/bets/${bet.id}/reopen`, { version: bet.version, reason: REASON }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await corrections()).toHaveLength(1);
      const reversals = (await rows()).filter((row) => row.type === 'REVERSAL');
      expect(reversals).toHaveLength(2); // colocación y liquidación, cada una anulada una sola vez
      await invariant();
    });
  });

  // --- 4. Ciclo de vida del proyecto --------------------------------------------------------------

  describe('ciclo de vida del proyecto (§85)', () => {
    it('un proyecto cerrado admite correcciones (tarea administrativa y conciliación final); uno en la papelera, no', async () => {
      const bet = await settledWin('39.00');
      await ctx.t.db.update(projects).set({ status: 'CLOSED' }).where(eq(projects.id, projectId));
      const corrected = await post('admin', `/bets/${bet.id}/correct-settlement`, {
        version: bet.version,
        reason: REASON,
        officialRealizedReturn: '45.00',
      });
      expect(corrected.status).toBe(200);
      await invariant();

      await ctx.t.db
        .update(projects)
        .set({
          status: 'TRASHED',
          previousStatus: 'CLOSED',
          deletedAt: new Date(),
          purgeEligibleAt: new Date(),
        })
        .where(eq(projects.id, projectId));
      const inTrash = await post('admin', `/bets/${bet.id}/reopen`, {
        version: 99,
        reason: REASON,
      });
      expect(inTrash.status).toBe(404);
    });
  });
});
