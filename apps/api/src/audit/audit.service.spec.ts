import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../test/support/fake-clock.js';
import { insertUser } from '../../test/support/factories.js';
import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../test/support/test-database.js';
import { RequestContext } from '../common/request-context.js';
import { PG_RESTRICT_VIOLATION, pgErrorCode } from '../database/pg-errors.js';
import { auditLogs } from '../database/schema/index.js';
import { AuditService } from './audit.service.js';

describe('AuditService (PostgreSQL real)', () => {
  let t: TestDatabase;
  let clock: FakeClock;
  let audit: AuditService;

  beforeAll(() => {
    t = createTestDatabase();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.pool);
    clock = new FakeClock('2026-06-01T12:00:00.000Z');
    audit = new AuditService(clock);
  });

  const lastEntries = () => t.db.select().from(auditLogs).orderBy(desc(auditLogs.occurredAt));

  it('registra la entrada con los datos de la petición en curso', async () => {
    const userId = (await insertUser(t.db)).id;
    const sessionId = randomUUID();
    const entityId = randomUUID();

    await RequestContext.run(
      { requestId: 'req-1', ip: '203.0.113.7', userAgent: 'UA/1', userId, sessionId },
      () =>
        audit.record(t.db, {
          action: 'user.profile.updated',
          entityType: 'user',
          entityId,
          oldValues: { lastName: 'Ruiz' },
          newValues: { lastName: 'Rojas' },
          metadata: { reason: 'prueba' },
        }),
    );

    const [row] = await lastEntries();
    expect(row).toMatchObject({
      action: 'user.profile.updated',
      entityType: 'user',
      entityId,
      actorUserId: userId,
      sessionId,
      ip: '203.0.113.7',
      userAgent: 'UA/1',
      requestId: 'req-1',
      projectId: null,
      oldValues: { lastName: 'Ruiz' },
      newValues: { lastName: 'Rojas' },
      metadata: { reason: 'prueba' },
    });
    expect(row!.occurredAt.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('actorUserId null expresa una acción anónima aunque haya usuario en el contexto', async () => {
    await RequestContext.run({ requestId: 'r', userId: randomUUID() }, () =>
      audit.record(t.db, {
        action: 'auth.password_reset.requested',
        entityType: 'user',
        actorUserId: null,
      }),
    );
    const [row] = await lastEntries();
    expect(row!.actorUserId).toBeNull();
  });

  it('funciona fuera de una petición (comandos) sin datos de contexto', async () => {
    await audit.record(t.db, { action: 'user.bootstrap_admin', entityType: 'user' });
    const [row] = await lastEntries();
    expect(row).toMatchObject({ actorUserId: null, ip: null, sessionId: null, requestId: null });
  });

  it('no guarda secretos aunque se le pasen por error', async () => {
    await audit.record(t.db, {
      action: 'user.created',
      entityType: 'user',
      newValues: { email: 'a@x.com', passwordHash: '$argon2id$secreto' },
    });
    const [row] = await lastEntries();
    expect(row!.newValues).toEqual({ email: 'a@x.com', passwordHash: '[REDACTED]' });
    expect(JSON.stringify(row)).not.toContain('secreto');
  });

  it('se revierte junto con la transacción de la operación auditada (§57)', async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await audit.record(tx, { action: 'demo.acción', entityType: 'demo' });
        throw new Error('la operación de negocio falló');
      }),
    ).rejects.toThrow('la operación de negocio falló');

    expect(await lastEntries()).toHaveLength(0);
  });

  it('se confirma junto con la transacción cuando todo sale bien', async () => {
    await t.db.transaction(async (tx) => {
      await audit.record(tx, { action: 'demo.acción', entityType: 'demo' });
    });
    expect(await lastEntries()).toHaveLength(1);
  });

  it('la tabla es inmutable: UPDATE, DELETE y TRUNCATE fallan', async () => {
    await audit.record(t.db, { action: 'demo.acción', entityType: 'demo' });
    const [row] = await lastEntries();

    const attempts = [
      () => t.pool.query(`UPDATE audit_logs SET action = 'alterada' WHERE id = $1`, [row!.id]),
      () => t.pool.query(`DELETE FROM audit_logs WHERE id = $1`, [row!.id]),
      () => t.pool.query(`TRUNCATE audit_logs`),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toSatisfy(
        (error) => pgErrorCode(error) === PG_RESTRICT_VIOLATION,
      );
    }
    const [same] = await t.db.select().from(auditLogs).where(eq(auditLogs.id, row!.id));
    expect(same!.action).toBe('demo.acción');
  });
});
