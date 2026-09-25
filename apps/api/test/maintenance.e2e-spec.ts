import type { MaintenanceRunSummary } from '@letfer/shared';
import { count, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { MaintenanceModeService } from '../src/backups/maintenance-mode.service.js';
import { MaintenanceService } from '../src/admin/maintenance.service.js';
import { newId } from '../src/database/schema/columns.js';
import {
  auditLogs,
  invitations,
  loginAttempts,
  maintenanceRuns,
  passwordResetTokens,
  projects,
  sessions,
  users,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'plain';

const at = (iso: string) => new Date(iso);

describe('mantenimiento: purga de registros auxiliares (e2e, PostgreSQL real, §111.6)', () => {
  let ctx: TestApp;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    await ctx.reset();
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.plain = await ctx.createUser({ email: 'plain@example.com', firstName: 'Paula' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  // Reloj de pruebas: 2026-06-01T12:00Z; retención de 30 días → límite 2026-05-02T12:00Z.
  const purge = (actor: Actor) =>
    request(ctx.server).post('/api/admin/maintenance/purge').set('Cookie', cookies[actor]);
  const runs = (actor: Actor) =>
    request(ctx.server).get('/api/admin/maintenance/runs').set('Cookie', cookies[actor]);
  const summary = (response: request.Response) => response.body as MaintenanceRunSummary;

  interface Fixtures {
    sessionIds: Record<string, string>;
    tokenIds: Record<string, string>;
  }

  /** Registros auxiliares con distintas edades. `purge*` deben desaparecer; `keep*` no. */
  async function seedAuxiliary(): Promise<Fixtures> {
    const userId = people.plain.id;
    const session = async (
      key: string,
      values: { expiresAt: Date; lastSeenAt: Date; revokedAt?: Date; idleTimeoutSeconds?: number },
    ) => {
      const [row] = await ctx.t.db
        .insert(sessions)
        .values({
          userId,
          tokenHash: `hash-${key}-${newId()}`,
          persistent: false,
          createdAt: at('2026-01-01T00:00:00.000Z'),
          reauthenticatedAt: at('2026-01-01T00:00:00.000Z'),
          idleTimeoutSeconds: 3600,
          ...values,
        })
        .returning();
      return [key, row!.id] as const;
    };
    const token = async (
      key: string,
      values: { expiresAt: Date; usedAt?: Date; invalidatedAt?: Date },
    ) => {
      const [row] = await ctx.t.db
        .insert(passwordResetTokens)
        .values({
          userId,
          tokenHash: `token-${key}-${newId()}`,
          createdAt: at('2026-01-01T00:00:00.000Z'),
          ...values,
        })
        .returning();
      return [key, row!.id] as const;
    };

    const sessionIds = Object.fromEntries([
      // Dejaron de valer hace más de 30 días: se purgan.
      await session('purgeExpired', {
        expiresAt: at('2026-04-01T00:00:00.000Z'),
        lastSeenAt: at('2026-03-31T00:00:00.000Z'),
      }),
      await session('purgeRevoked', {
        expiresAt: at('2026-12-01T00:00:00.000Z'),
        lastSeenAt: at('2026-04-10T00:00:00.000Z'),
        revokedAt: at('2026-04-10T00:00:00.000Z'),
      }),
      await session('purgeIdle', {
        expiresAt: at('2026-12-01T00:00:00.000Z'),
        lastSeenAt: at('2026-03-01T00:00:00.000Z'),
      }),
      // Dejaron de valer hace menos de 30 días: se conservan.
      await session('keepRecentExpired', {
        expiresAt: at('2026-05-20T00:00:00.000Z'),
        lastSeenAt: at('2026-05-19T00:00:00.000Z'),
      }),
      await session('keepRecentRevoked', {
        expiresAt: at('2026-12-01T00:00:00.000Z'),
        lastSeenAt: at('2026-05-25T00:00:00.000Z'),
        revokedAt: at('2026-05-25T00:00:00.000Z'),
      }),
    ]);

    await ctx.t.db.insert(loginAttempts).values([
      {
        emailNormalized: 'old@example.com',
        succeeded: false,
        attemptedAt: at('2026-04-01T00:00:00Z'),
      },
      {
        emailNormalized: 'new@example.com',
        succeeded: false,
        attemptedAt: at('2026-05-30T00:00:00Z'),
      },
    ]);

    const tokenIds = Object.fromEntries([
      await token('purgeUsed', {
        expiresAt: at('2026-04-01T01:00:00.000Z'),
        usedAt: at('2026-04-01T00:30:00.000Z'),
      }),
      await token('purgeInvalidated', {
        expiresAt: at('2026-12-01T00:00:00.000Z'),
        invalidatedAt: at('2026-04-02T00:00:00.000Z'),
      }),
      await token('purgeExpired', { expiresAt: at('2026-04-05T00:00:00.000Z') }),
      await token('keepRecentExpired', { expiresAt: at('2026-05-30T00:00:00.000Z') }),
      await token('keepActive', { expiresAt: at('2026-06-01T13:00:00.000Z') }),
    ]);
    return { sessionIds, tokenIds };
  }

  const remaining = async (): Promise<{
    sessions: string[];
    tokens: string[];
    attempts: string[];
  }> => ({
    sessions: (await ctx.t.db.select({ id: sessions.id }).from(sessions)).map((row) => row.id),
    tokens: (await ctx.t.db.select({ id: passwordResetTokens.id }).from(passwordResetTokens)).map(
      (row) => row.id,
    ),
    attempts: (
      await ctx.t.db.select({ email: loginAttempts.emailNormalized }).from(loginAttempts)
    ).map((row) => row.email),
  });

  describe('qué purga', () => {
    it('elimina solo lo caducado hace más de 30 días y conserva lo vigente y lo reciente', async () => {
      const fixtures = await seedAuxiliary();
      const before = await remaining();

      const response = await purge('root').expect(200);
      expect(summary(response)).toMatchObject({
        trigger: 'MANUAL',
        status: 'COMPLETED',
        retentionDays: 30,
        runBy: { id: people.root.id, name: 'Ana Pérez' },
        purged: { sessions: 3, loginAttempts: 1, passwordResetTokens: 3 },
        errorMessage: null,
      });

      const after = await remaining();
      const ids = fixtures.sessionIds;
      for (const key of ['purgeExpired', 'purgeRevoked', 'purgeIdle']) {
        expect(after.sessions).not.toContain(ids[key]);
      }
      for (const key of ['keepRecentExpired', 'keepRecentRevoked']) {
        expect(after.sessions).toContain(ids[key]);
      }
      for (const key of ['purgeUsed', 'purgeInvalidated', 'purgeExpired']) {
        expect(after.tokens).not.toContain(fixtures.tokenIds[key]);
      }
      for (const key of ['keepRecentExpired', 'keepActive']) {
        expect(after.tokens).toContain(fixtures.tokenIds[key]);
      }
      expect(after.attempts).not.toContain('old@example.com');
      expect(after.attempts).toContain('new@example.com');
      // Las tres sesiones iniciadas por las pruebas siguen vivas.
      expect(before.sessions.length - after.sessions.length).toBe(3);
      await request(ctx.server).get('/api/auth/me').set('Cookie', cookies.plain).expect(200);
    });

    it('nunca toca datos de negocio, invitaciones, usuarios ni la auditoría', async () => {
      await seedAuxiliary();
      const { project } = await insertProject(ctx.t.db, { owner: people.owner });
      await ctx.t.db.insert(invitations).values({
        projectId: project.id,
        createdBy: people.owner.id,
        roleId: (await ctx.t.db.query.roles.findFirst({
          where: (r, { eq: e }) => e(r.key, 'READER'),
        }))!.id,
        tokenHash: `inv-${newId()}`,
        singleUse: false,
        expiresAt: at('2020-01-01T00:00:00.000Z'), // vencida hace años: NO se purga
      });
      await ctx.t.db.insert(auditLogs).values({
        action: 'test.ancient',
        entityType: 'thing',
        occurredAt: at('2020-01-01T00:00:00.000Z'),
      });
      const tables = async () => ({
        users: (await ctx.t.db.select({ n: count() }).from(users))[0]!.n,
        projects: (await ctx.t.db.select({ n: count() }).from(projects))[0]!.n,
        invitations: (await ctx.t.db.select({ n: count() }).from(invitations))[0]!.n,
        oldAudit: (
          await ctx.t.db
            .select({ n: count() })
            .from(auditLogs)
            .where(eq(auditLogs.action, 'test.ancient'))
        )[0]!.n,
      });
      const before = await tables();
      const auditBefore = (await ctx.t.db.select({ n: count() }).from(auditLogs))[0]!.n;

      await purge('root').expect(200);

      expect(await tables()).toEqual(before);
      // La auditoría solo crece: la propia purga deja una entrada y no se borra ninguna.
      expect((await ctx.t.db.select({ n: count() }).from(auditLogs))[0]!.n).toBe(auditBefore + 1);
    });

    it('es idempotente: una segunda ejecución no encuentra nada que purgar', async () => {
      await seedAuxiliary();
      await purge('root').expect(200);
      const again = summary(await purge('root').expect(200));
      expect(again.purged).toEqual({ sessions: 0, loginAttempts: 0, passwordResetTokens: 0 });
      expect(again.status).toBe('COMPLETED');
    });

    it('dos purgas simultáneas no cuentan dos veces la misma fila', async () => {
      await seedAuxiliary();
      const [a, b] = await Promise.all([purge('root'), purge('root')]);
      const total = (key: 'sessions' | 'loginAttempts' | 'passwordResetTokens') =>
        summary(a).purged[key] + summary(b).purged[key];
      expect(total('sessions')).toBe(3);
      expect(total('loginAttempts')).toBe(1);
      expect(total('passwordResetTokens')).toBe(3);
      expect((await ctx.t.db.select({ n: count() }).from(maintenanceRuns))[0]!.n).toBe(2);
    });
  });

  describe('registro y auditoría', () => {
    it('cada ejecución queda en el historial y en la auditoría, con quién la lanzó', async () => {
      await seedAuxiliary();
      const created = summary(await purge('root').expect(200));
      const history = (await runs('root').expect(200)).body as MaintenanceRunSummary[];
      expect(history.map((run) => run.id)).toEqual([created.id]);
      expect(history[0]).toMatchObject({ trigger: 'MANUAL', runBy: { id: people.root.id } });

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'maintenance.purge.completed'));
      expect(log).toMatchObject({
        actorUserId: people.root.id,
        entityId: created.id,
        metadata: {
          trigger: 'MANUAL',
          retentionDays: 30,
          purgedSessions: 3,
          purgedLoginAttempts: 1,
          purgedRecoveryLinks: 3,
        },
      });
    });

    it('el historial se muestra de la más reciente a la más antigua', async () => {
      const first = summary(await purge('root').expect(200));
      ctx.clock.advanceSeconds(60);
      const second = summary(await purge('root').expect(200));
      const history = (await runs('root').expect(200)).body as MaintenanceRunSummary[];
      expect(history.map((run) => run.id)).toEqual([second.id, first.id]);
    });

    it('el historial es inmutable: no se edita, no se borra ni se vacía', async () => {
      const created = summary(await purge('root').expect(200));
      await expect(
        ctx.t.pool.query("UPDATE maintenance_runs SET status = 'FAILED' WHERE id = $1", [
          created.id,
        ]),
      ).rejects.toMatchObject({ code: '23001' });
      await expect(
        ctx.t.pool.query('DELETE FROM maintenance_runs WHERE id = $1', [created.id]),
      ).rejects.toMatchObject({ code: '23001' });
      await expect(ctx.t.pool.query('TRUNCATE maintenance_runs')).rejects.toMatchObject({
        code: '23001',
      });
    });
  });

  describe('permisos', () => {
    it('solo el Administrador Global puede purgar y consultar el historial', async () => {
      await seedAuxiliary();
      const before = await remaining();
      for (const actor of ['owner', 'plain'] as const) {
        await purge(actor).expect(403);
        await runs(actor).expect(403);
      }
      await request(ctx.server).post('/api/admin/maintenance/purge').expect(401);
      await request(ctx.server).get('/api/admin/maintenance/runs').expect(401);
      expect(await remaining()).toEqual(before); // nada se purgó
    });
  });

  describe('tarea diaria interna', () => {
    const service = () => ctx.app.get(MaintenanceService, { strict: false });

    it('no corre antes de la hora configurada ni dos veces el mismo día', async () => {
      ctx.clock.set('2026-06-01T03:00:00.000Z'); // antes de las 04:00 UTC
      expect(await service().maybeRunScheduled()).toBeNull();

      ctx.clock.set('2026-06-01T05:00:00.000Z');
      const first = await service().maybeRunScheduled();
      expect(first).toMatchObject({ trigger: 'SCHEDULED', status: 'COMPLETED', runBy: null });

      ctx.clock.set('2026-06-01T09:00:00.000Z'); // mismo día: ya corrió
      expect(await service().maybeRunScheduled()).toBeNull();

      ctx.clock.set('2026-06-02T05:00:00.000Z'); // al día siguiente vuelve a correr
      expect(await service().maybeRunScheduled()).toMatchObject({ trigger: 'SCHEDULED' });
      expect((await ctx.t.db.select({ n: count() }).from(maintenanceRuns))[0]!.n).toBe(2);
    });

    it('la ejecución programada purga igual y se audita como acción del sistema', async () => {
      await seedAuxiliary();
      ctx.clock.set('2026-06-01T05:00:00.000Z');
      const run = await service().maybeRunScheduled();
      expect(run!.purged).toMatchObject({ sessions: 3, passwordResetTokens: 3 });
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'maintenance.purge.completed'));
      expect(log!.actorUserId).toBeNull();
      expect(log!.metadata).toMatchObject({ trigger: 'SCHEDULED' });
    });

    it('no corre mientras hay una restauración de backup en curso', async () => {
      const mode = ctx.app.get(MaintenanceModeService, { strict: false });
      ctx.clock.set('2026-06-01T05:00:00.000Z');
      mode.activate();
      try {
        expect(await service().maybeRunScheduled()).toBeNull();
      } finally {
        mode.deactivate();
      }
      expect(await service().maybeRunScheduled()).not.toBeNull();
    });
  });

  describe('fallos', () => {
    it('si la purga falla no se elimina nada, queda una ejecución FAILED sin detalles internos', async () => {
      await seedAuxiliary();
      const before = await remaining();
      // El primer registro de auditoría (dentro de la transacción de la purga) falla.
      vi.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(
        new Error('detalle-interno-secreto: contraseña de la base de datos'),
      );

      const response = await purge('root').expect(200);
      const failed = summary(response);
      expect(failed).toMatchObject({
        status: 'FAILED',
        purged: { sessions: 0, loginAttempts: 0, passwordResetTokens: 0 },
      });
      expect(JSON.stringify(response.body)).not.toContain('detalle-interno-secreto');
      expect(failed.errorMessage).toBeTruthy();

      // La transacción se revirtió: todo sigue ahí.
      expect(await remaining()).toEqual(before);
      const rows = await ctx.t.db.select().from(maintenanceRuns);
      expect(rows.map((row) => row.status)).toEqual(['FAILED']);
      expect(
        await ctx.t.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'maintenance.purge.failed')),
      ).toHaveLength(1);
      expect(
        await ctx.t.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'maintenance.purge.completed')),
      ).toHaveLength(0);

      // Al reintentar, ya funciona.
      const retry = summary(await purge('root').expect(200));
      expect(retry.status).toBe('COMPLETED');
      expect(retry.purged.sessions).toBe(3);
    });
  });
});
