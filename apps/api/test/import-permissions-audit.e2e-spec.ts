import { IMPORT_AUDIT_ACTIONS } from '@letfer/shared';
import { createHash } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import {
  auditLogs,
  importBatches,
  importRows,
  rolePermissions,
  roles,
  type ImportBatchRow,
  type NewImportBatch,
  type UserRow,
} from '../src/database/schema/index.js';
import { ImportAuditService } from '../src/imports/import-audit.service.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertHouse, insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

const FILE = Buffer.from('contenido del archivo original de Betsafe');
const SHA256 = createHash('sha256').update(FILE).digest('hex');
const now = new Date('2026-06-01T12:00:00.000Z');

/**
 * Fase 9.1.3 (§113.9, ADR 0020): permisos `imports.view` e `import.run` y auditoría por lote.
 * Todavía no hay endpoints de importación: los permisos se comprueban en la matriz sembrada y en lo
 * que cada rol recibe del proyecto; la auditoría, con el servicio que usará el escritor de la 9.1.5.
 */
describe('permisos y auditoría de importación (e2e, PostgreSQL real, §113.9)', () => {
  let ctx: TestApp;
  let projectId: string;
  let houseId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' })).project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    houseId = (await insertHouse(ctx.t.db, { projectId, name: 'Betsafe' })).id;
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const audit = () => ctx.app.get(ImportAuditService);
  const importEvents = () =>
    ctx.t.db.select().from(auditLogs).where(like(auditLogs.action, 'import.%'));

  async function upload(overrides: Partial<NewImportBatch> = {}): Promise<ImportBatchRow> {
    const [batch] = await ctx.t.db
      .insert(importBatches)
      .values({
        projectId,
        origin: 'Betsafe',
        originalName: 'Betsafe.xlsx',
        sourceFile: FILE,
        sourceSha256: SHA256,
        sourceSizeBytes: FILE.length,
        createdBy: people.admin.id,
        ...overrides,
      })
      .returning();
    return batch!;
  }
  const setBatch = (id: string, values: Partial<NewImportBatch>) =>
    ctx.t.db
      .update(importBatches)
      .set(values)
      .where(eq(importBatches.id, id))
      .returning()
      .then((rows) => rows[0]!);

  describe('permisos', () => {
    it('la base de datos los concede solo al Administrador de Proyecto y al Global', async () => {
      for (const code of ['imports.view', 'import.run']) {
        const holders = await ctx.t.db
          .select({ key: roles.key })
          .from(rolePermissions)
          .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
          .where(eq(rolePermissions.permissionCode, code));
        expect(holders.map((r) => r.key).sort(), code).toEqual(['GLOBAL_ADMIN', 'PROJECT_ADMIN']);
      }
    });

    it('cada rol recibe del proyecto exactamente lo que le corresponde', async () => {
      const permissionsOf = async (actor: Actor) => {
        const response = await request(ctx.server)
          .get(`/api/projects/${projectId}`)
          .set('Cookie', cookies[actor]);
        return response.status === 200
          ? (response.body as { myPermissions: string[] }).myPermissions
          : response.status;
      };
      const expected: Record<Actor, boolean | 404> = {
        root: true, // Administrador Global: todos los permisos en todos los proyectos.
        owner: true,
        admin: true,
        collab: false,
        reader: false,
        stranger: 404, // Quien no tiene acceso al proyecto lo recibe como inexistente.
      };
      for (const [actor, allowed] of Object.entries(expected) as [Actor, boolean | 404][]) {
        const permissions = await permissionsOf(actor);
        if (allowed === 404) {
          expect(permissions, actor).toBe(404);
        } else if (allowed) {
          expect(permissions, actor).toEqual(
            expect.arrayContaining(['imports.view', 'import.run']),
          );
        } else {
          expect(permissions, actor).not.toContain('imports.view');
          expect(permissions, actor).not.toContain('import.run');
        }
      }
    });

    it('quien no tiene imports.view ni audit.view no ve los eventos de importación', async () => {
      const batch = await upload();
      await ctx.t.db.transaction((tx) => audit().uploaded(tx, batch, people.admin.id));
      const list = (actor: Actor) =>
        request(ctx.server)
          .get(`/api/projects/${projectId}/audit-logs?action=import.`)
          .set('Cookie', cookies[actor]);
      const asAdmin = await list('admin').expect(200);
      expect((asAdmin.body as { items: unknown[] }).items).toHaveLength(1);
      await list('collab').expect(403);
      await list('reader').expect(403);
      await list('stranger').expect(404);
    });
  });

  describe('auditoría por lote', () => {
    it('cada paso del ciclo registra un solo evento con actor, proyecto, lote, huella y contadores', async () => {
      const uploaded = await upload();
      await ctx.t.db.transaction((tx) => audit().uploaded(tx, uploaded, people.admin.id));

      const validated = await setBatch(uploaded.id, {
        status: 'VALIDATED',
        houseId,
        validatedAt: now,
        validatedBy: people.admin.id,
        rowsTotal: 158,
        rowsValid: 6,
        rowsTemplate: 152,
      });
      await ctx.t.db.transaction((tx) =>
        audit().validated(tx, validated, people.admin.id, { previousStatus: 'UPLOADED' }),
      );

      const imported = await setBatch(uploaded.id, {
        status: 'IMPORTED',
        importedAt: now,
        importedBy: people.admin.id,
        importReason: 'Historial de Betsafe',
        report: { semaphore: 'GREEN' },
      });
      await ctx.t.db.transaction((tx) =>
        audit().imported(tx, imported, people.admin.id, { reason: 'Historial de Betsafe' }),
      );

      const annulled = await setBatch(uploaded.id, {
        status: 'ANNULLED',
        annulledAt: now,
        annulledBy: people.owner.id,
        annulmentReason: 'Archivo equivocado',
      });
      await ctx.t.db.transaction((tx) =>
        audit().annulled(tx, annulled, people.owner.id, { reason: 'Archivo equivocado' }),
      );

      const events = (await importEvents()).sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
      expect(events.map((e) => e.action).sort()).toEqual(
        Object.values(IMPORT_AUDIT_ACTIONS).sort(),
      );
      for (const event of events) {
        expect(event).toMatchObject({
          entityType: 'import_batch',
          entityId: uploaded.id,
          projectId,
        });
        // La huella completa y sin redactar, con la clave `sha256`.
        expect(event.metadata).toMatchObject({
          batchId: uploaded.id,
          sha256: SHA256,
          originalName: 'Betsafe.xlsx',
          sizeBytes: FILE.length,
        });
        expect(JSON.stringify(event)).not.toContain('REDACTED');
      }

      const byAction = (action: string) => events.find((e) => e.action === action)!;
      const uploadedEvent = byAction(IMPORT_AUDIT_ACTIONS.uploaded);
      expect(uploadedEvent.actorUserId).toBe(people.admin.id);
      expect(uploadedEvent.metadata).toMatchObject({ houseId: null });
      expect(uploadedEvent.newValues).toEqual({ status: 'UPLOADED' });

      const validatedEvent = byAction(IMPORT_AUDIT_ACTIONS.validated);
      expect(validatedEvent.metadata).toMatchObject({
        houseId,
        rows: { total: 158, valid: 6, template: 152, empty: 0, partial: 0, invalid: 0 },
      });
      expect(validatedEvent).toMatchObject({
        oldValues: { status: 'UPLOADED' },
        newValues: { status: 'VALIDATED' },
      });

      expect(byAction(IMPORT_AUDIT_ACTIONS.imported)).toMatchObject({
        actorUserId: people.admin.id,
        oldValues: { status: 'VALIDATED' },
        newValues: { status: 'IMPORTED' },
        metadata: { reason: 'Historial de Betsafe', rehearsal: false, houseId },
      });

      // La anulación deja quién, por qué y de qué a qué estado.
      expect(byAction(IMPORT_AUDIT_ACTIONS.annulled)).toMatchObject({
        actorUserId: people.owner.id,
        oldValues: { status: 'IMPORTED' },
        newValues: { status: 'ANNULLED' },
        metadata: { reason: 'Archivo equivocado', sha256: SHA256, houseId },
      });
      expect(events).toHaveLength(4);
    });

    it('no se crean eventos por fila: veinte filas de staging siguen siendo un solo evento', async () => {
      const batch = await upload();
      await ctx.t.db.insert(importRows).values(
        Array.from({ length: 20 }, (_, index) => ({
          importBatchId: batch.id,
          rowNumber: index + 1,
          rawValues: { N: String(index + 1) },
          status: 'VALID' as const,
        })),
      );
      await ctx.t.db.transaction((tx) => audit().uploaded(tx, batch, people.admin.id));
      expect(await importEvents()).toHaveLength(1);
      expect(
        await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.entityType, 'import_row')),
      ).toEqual([]);
    });

    it('la huella no se redacta aunque la auditoría oculte las claves con "hash"', async () => {
      const batch = await upload();
      await ctx.t.db.transaction(async (tx) => {
        await audit().uploaded(tx, batch, people.admin.id);
        // Una clave llamada `fileHash` sí se oculta: por eso se usa `sha256`.
        await ctx.app.get(AuditService).record(tx, {
          action: 'import.batch_probe',
          entityType: 'import_batch',
          entityId: batch.id,
          actorUserId: people.admin.id,
          projectId,
          metadata: { sha256: SHA256, fileHash: SHA256 },
        });
      });
      const [probe] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'import.batch_probe'));
      expect(probe!.metadata).toEqual({ sha256: SHA256, fileHash: '[REDACTED]' });
      const [real] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, IMPORT_AUDIT_ACTIONS.uploaded));
      expect((real!.metadata as { sha256: string }).sha256).toHaveLength(64);
    });
  });

  describe('atomicidad y operaciones rechazadas', () => {
    it('si falla la auditoría, la operación auditada se revierte', async () => {
      const batch = await upload();
      const spy = vi
        .spyOn(ctx.app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('fallo simulado de auditoría'));

      await expect(
        ctx.t.db.transaction(async (tx) => {
          const validated = await tx
            .update(importBatches)
            .set({ status: 'VALIDATED', houseId, validatedAt: now, validatedBy: people.admin.id })
            .where(eq(importBatches.id, batch.id))
            .returning()
            .then((rows) => rows[0]!);
          await audit().validated(tx, validated, people.admin.id, { previousStatus: 'UPLOADED' });
        }),
      ).rejects.toThrow('fallo simulado de auditoría');
      spy.mockRestore();

      const [after] = await ctx.t.db
        .select({ status: importBatches.status, houseId: importBatches.houseId })
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(after).toEqual({ status: 'UPLOADED', houseId: null });
      expect(await importEvents()).toEqual([]);

      // Y se puede reintentar con normalidad.
      await ctx.t.db.transaction(async (tx) => {
        const validated = await tx
          .update(importBatches)
          .set({ status: 'VALIDATED', houseId, validatedAt: now, validatedBy: people.admin.id })
          .where(eq(importBatches.id, batch.id))
          .returning()
          .then((rows) => rows[0]!);
        await audit().validated(tx, validated, people.admin.id, { previousStatus: 'UPLOADED' });
      });
      expect(await importEvents()).toHaveLength(1);
    });

    it('una operación rechazada por la base de datos no deja auditoría', async () => {
      const batch = await upload();
      // Anular un lote que no está importado lo rechaza el disparador, antes de auditar.
      await expect(
        ctx.t.db.transaction(async (tx) => {
          const annulled = await tx
            .update(importBatches)
            .set({
              status: 'ANNULLED',
              annulledAt: now,
              annulledBy: people.owner.id,
              annulmentReason: 'Prematuro',
            })
            .where(eq(importBatches.id, batch.id))
            .returning()
            .then((rows) => rows[0]!);
          await audit().annulled(tx, annulled, people.owner.id, { reason: 'Prematuro' });
        }),
      ).rejects.toThrow();
      expect(await importEvents()).toEqual([]);
      const [after] = await ctx.t.db
        .select({ status: importBatches.status })
        .from(importBatches)
        .where(and(eq(importBatches.id, batch.id)));
      expect(after!.status).toBe('UPLOADED');
    });
  });
});
