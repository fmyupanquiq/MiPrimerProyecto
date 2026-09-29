import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  importBatches,
  importRows,
  stages,
  type HouseRow,
  type ImportBatchRow,
  type NewImportBatch,
  type UserRow,
} from '../src/database/schema/index.js';
import { ImportResolutionService } from '../src/imports/import-resolution.service.js';
import type { ImportStagePlan } from '../src/imports/import-types.js';
import { createTestApp, type TestApp } from './support/create-app.js';
import { insertHouse, insertProject } from './support/factories.js';

const FILE = Buffer.from('contenido del archivo original de Betsafe');
const SHA256 = createHash('sha256').update(FILE).digest('hex');
const now = new Date('2026-06-01T12:00:00.000Z');

/** Un plan de etapas estructuralmente válido: dos etapas, rangos de filas sin solaparse. */
const validPlan = (): ImportStagePlan => ({
  stages: [
    {
      key: 'r1',
      name: 'Ronda 1',
      unitStake: '12.50',
      startsAt: null,
      status: 'CLOSED',
      firstRow: 11,
      lastRow: 15,
    },
    {
      key: 'r2',
      name: 'Ronda 2',
      unitStake: '15.00',
      startsAt: null,
      status: 'ACTIVE',
      firstRow: 16,
      lastRow: 20,
    },
  ],
});

/**
 * Fase 9.3.4 (§113.2, §113.3, ADR 0020, docs/PLAN_FASE_9_3.md §3–§5, D-X7, D-X8): resolución
 * humana de casa y plan de etapas, aislada de todo lo que depende de ellas (stageKey, stake,
 * etapas reales, reconocimientos, confirmación) y sin tocar nunca el staging ya persistido.
 */
describe('resolución humana de casa y plan de etapas (e2e, PostgreSQL real, §113)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let projectId: string;
  let house: HouseRow;
  let otherHouse: HouseRow;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Ensayo' })).project.id;
    house = await insertHouse(ctx.t.db, { projectId, name: 'Betsafe' });
    otherHouse = await insertHouse(ctx.t.db, { projectId, name: 'Betano' });
  });

  const service = () => ctx.app.get(ImportResolutionService);

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
        createdBy: owner.id,
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

  async function importedBatch(): Promise<ImportBatchRow> {
    const batch = await upload({
      status: 'VALIDATED',
      houseId: house.id,
      validatedAt: now,
      validatedBy: owner.id,
    });
    return setBatch(batch.id, {
      status: 'IMPORTED',
      importedAt: now,
      importedBy: owner.id,
      importReason: 'Historial de Betsafe',
      report: { semaphore: 'GREEN' },
    });
  }

  async function annulledBatch(): Promise<ImportBatchRow> {
    const batch = await importedBatch();
    return setBatch(batch.id, {
      status: 'ANNULLED',
      annulledAt: now,
      annulledBy: owner.id,
      annulmentReason: 'Archivo equivocado',
    });
  }

  const importEvents = () =>
    ctx.t.db.select().from(auditLogs).where(like(auditLogs.action, 'import.%'));

  describe('casa', () => {
    it('UPLOADED permite confirmar la casa y pasa a VALIDATED', async () => {
      const batch = await upload();
      const result = await service().confirmHouse({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        houseId: house.id,
      });

      expect(result).toMatchObject({
        status: 'VALIDATED',
        houseId: house.id,
        validatedBy: owner.id,
      });
      expect(result.validatedAt).not.toBeNull();
      expect(result).not.toHaveProperty('sourceFile');

      const events = await importEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'import.batch_validated',
        actorUserId: owner.id,
        oldValues: { status: 'UPLOADED' },
        newValues: { status: 'VALIDATED' },
      });
      expect((events[0]!.metadata as { houseId: string }).houseId).toBe(house.id);
    });

    it('VALIDATED permite corregir la casa sin cambiar el estado ni la primera atribución', async () => {
      const batch = await upload();
      const first = await service().confirmHouse({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        houseId: house.id,
      });

      const corrected = await service().confirmHouse({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        houseId: otherHouse.id,
      });

      expect(corrected).toMatchObject({
        status: 'VALIDATED',
        houseId: otherHouse.id,
        // La primera confirmación no se pierde al corregir la casa (trazabilidad).
        validatedBy: owner.id,
      });
      expect(corrected.validatedAt).toEqual(first.validatedAt);
      expect(corrected.version).toBe(first.version + 1);

      const events = await importEvents();
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        action: 'import.batch_validated',
        oldValues: { status: 'VALIDATED' },
        newValues: { status: 'VALIDATED' },
      });
      expect((events[1]!.metadata as { houseId: string }).houseId).toBe(otherHouse.id);
    });

    it('IMPORTED rechaza cualquier cambio de casa', async () => {
      const batch = await importedBatch();
      await expect(
        service().confirmHouse({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          houseId: otherHouse.id,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const [after] = await ctx.t.db
        .select({ houseId: importBatches.houseId, status: importBatches.status })
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(after).toEqual({ houseId: house.id, status: 'IMPORTED' });
    });

    it('ANNULLED rechaza cualquier cambio de casa', async () => {
      const batch = await annulledBatch();
      await expect(
        service().confirmHouse({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          houseId: otherHouse.id,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const [after] = await ctx.t.db
        .select({ houseId: importBatches.houseId })
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(after).toEqual({ houseId: house.id });
    });

    it('rechaza una casa que no existe en el proyecto', async () => {
      const batch = await upload();
      await expect(
        service().confirmHouse({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          houseId: '00000000-0000-7000-8000-000000000000',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('plan de etapas', () => {
    it('un plan válido se guarda correctamente, sin crear etapas reales', async () => {
      const batch = await upload();
      const result = await service().saveStagePlan({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        plan: validPlan(),
      });

      expect(result.status).toBe('UPLOADED'); // guardar el plan no cambia el estado por sí solo.
      expect(result.stagePlan).toEqual({
        stages: [
          {
            key: 'r1',
            name: 'Ronda 1',
            unitStake: '12.50',
            startsAt: null,
            status: 'CLOSED',
            firstRow: 11,
            lastRow: 15,
          },
          {
            key: 'r2',
            name: 'Ronda 2',
            unitStake: '15.00',
            startsAt: null,
            status: 'ACTIVE',
            firstRow: 16,
            lastRow: 20,
          },
        ],
      });

      // Guardar el plan no crea ninguna etapa real (D-X7): eso queda para el escritor, al confirmar.
      const created = await ctx.t.db.select().from(stages).where(eq(stages.projectId, projectId));
      expect(created).toHaveLength(0);
    });

    it('guardar el plan dos veces lo reemplaza por completo, mientras el lote sigue editable', async () => {
      const batch = await upload();
      const first = await service().saveStagePlan({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        plan: validPlan(),
      });

      const revised: ImportStagePlan = {
        stages: [
          {
            key: 'unica',
            name: 'Ronda única',
            unitStake: '20.00',
            startsAt: null,
            status: 'ACTIVE',
            firstRow: 11,
            lastRow: 20,
          },
        ],
      };
      const second = await service().saveStagePlan({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        plan: revised,
      });

      // Reemplazo completo, no una fusión: no queda ningún rastro del primer plan (dos etapas, "r1"/"r2").
      expect(second.stagePlan).toEqual({
        stages: [
          {
            key: 'unica',
            name: 'Ronda única',
            unitStake: '20.00',
            startsAt: null,
            status: 'ACTIVE',
            firstRow: 11,
            lastRow: 20,
          },
        ],
      });
      expect(second.version).toBe(first.version + 1);

      // También funciona una vez que la casa ya se confirmó (lote VALIDATED, sigue editable).
      await service().confirmHouse({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        houseId: house.id,
      });
      const third = await service().saveStagePlan({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        plan: validPlan(),
      });
      expect(third.status).toBe('VALIDATED');
      expect(third.stagePlan).toEqual({
        stages: [
          {
            key: 'r1',
            name: 'Ronda 1',
            unitStake: '12.50',
            startsAt: null,
            status: 'CLOSED',
            firstRow: 11,
            lastRow: 15,
          },
          {
            key: 'r2',
            name: 'Ronda 2',
            unitStake: '15.00',
            startsAt: null,
            status: 'ACTIVE',
            firstRow: 16,
            lastRow: 20,
          },
        ],
      });
    });

    it('un plan con rangos de filas solapados se rechaza sin modificar el lote', async () => {
      const batch = await upload();
      const overlapping: ImportStagePlan = {
        stages: [
          {
            key: 'r1',
            name: 'Ronda 1',
            unitStake: '12.50',
            startsAt: null,
            status: 'CLOSED',
            firstRow: 11,
            lastRow: 15,
          },
          {
            key: 'r2',
            name: 'Ronda 2',
            unitStake: '15.00',
            startsAt: null,
            status: 'CLOSED',
            firstRow: 15,
            lastRow: 20,
          },
        ],
      };

      await expect(
        service().saveStagePlan({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          plan: overlapping,
        }),
      ).rejects.toMatchObject({ status: 400 });

      const [after] = await ctx.t.db
        .select({ stagePlan: importBatches.stagePlan, version: importBatches.version })
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(after).toEqual({ stagePlan: null, version: batch.version });
    });

    it('IMPORTED rechaza cambiar el plan de etapas', async () => {
      const batch = await importedBatch();
      await expect(
        service().saveStagePlan({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          plan: validPlan(),
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('ANNULLED rechaza cambiar el plan de etapas', async () => {
      const batch = await annulledBatch();
      await expect(
        service().saveStagePlan({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          plan: validPlan(),
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('las filas de staging permanecen intactas tras confirmar la casa y guardar el plan', async () => {
    const batch = await upload();
    const stagingRow = {
      importBatchId: batch.id,
      rowNumber: 11,
      rawValues: { H: 62.5, I: 1.75, J: 'GANADO' },
      status: 'VALID' as const,
      trafficLight: 'GREEN' as const,
      findings: [],
    };
    await ctx.t.db.insert(importRows).values(stagingRow);
    const [before] = await ctx.t.db
      .select()
      .from(importRows)
      .where(eq(importRows.importBatchId, batch.id));

    await service().confirmHouse({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      houseId: house.id,
    });
    await service().saveStagePlan({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      plan: validPlan(),
    });

    const [after] = await ctx.t.db
      .select()
      .from(importRows)
      .where(eq(importRows.importBatchId, batch.id));
    expect(after).toEqual(before);
  });
});
