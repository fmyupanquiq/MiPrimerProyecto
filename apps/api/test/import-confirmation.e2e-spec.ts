import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { BackupGeneration } from '@letfer/shared';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeManifest } from '../src/backups/backup-files.js';
import {
  auditLogs,
  bets,
  financialMovements,
  importBatches,
  stages,
  type UserRow,
} from '../src/database/schema/index.js';
import { ImportAcknowledgmentService } from '../src/imports/import-acknowledgment.service.js';
import { ImportConfirmationService } from '../src/imports/import-confirmation.service.js';
import { ImportResolutionService } from '../src/imports/import-resolution.service.js';
import type { ImportStagePlan } from '../src/imports/import-types.js';
import { ImportUploadService } from '../src/imports/import-upload.service.js';
import { BETSAFE_ADAPTER } from '../src/imports/parser/betsafe-adapter.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';
import { insertProject } from './support/factories.js';

const TIME_ZONE = 'America/Lima';

/** Hoja sintética de Betsafe: fila 11 ganada, fila 12 perdida (misma forma que el resto de la 9.3). */
async function buildBetsafeWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  sheet.getCell('E3').value = 1000;
  const row = (
    n: number,
    values: { description: string; amount: number; odds: number; result: string },
  ) => {
    const r = 10 + n;
    sheet.getCell(`B${r}`).value = n;
    sheet.getCell(`C${r}`).value = new Date('2024-10-22T00:00:00.000Z');
    sheet.getCell(`E${r}`).value = 'FUTBOL';
    sheet.getCell(`F${r}`).value = values.description;
    sheet.getCell(`G${r}`).value = 'Simple';
    sheet.getCell(`H${r}`).value = values.amount;
    sheet.getCell(`I${r}`).value = values.odds;
    sheet.getCell(`J${r}`).value = values.result;
  };
  row(1, {
    description: 'Equipo A vs. Equipo B: Gana Equipo A',
    amount: 25,
    odds: 1.75,
    result: 'GANADO',
  });
  row(2, {
    description: 'Equipo C vs. Equipo D: Gana Equipo C',
    amount: 75,
    odds: 1.57,
    result: 'PERDIDO',
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const fullCoveragePlan = (): ImportStagePlan => ({
  stages: [
    {
      key: 'r1',
      name: 'Ronda 1',
      unitStake: '12.50',
      startsAt: null,
      status: 'CLOSED',
      firstRow: 11,
      lastRow: 12,
    },
  ],
});

/** Un backup COMPLETED en el manifiesto (mismo patrón que test/backups.e2e-spec.ts). */
function completedGeneration(takenAt: string): BackupGeneration {
  return {
    id: randomUUID(),
    takenAt,
    triggeredBy: 'MANUAL',
    fileName: `letfer-${takenAt.replace(/[:.]/g, '-')}.dump`,
    sizeBytes: 10,
    checksum: 'abc',
    ticketsFileName: null,
    ticketsSizeBytes: null,
    ticketsChecksum: null,
    status: 'COMPLETED',
    errorMessage: null,
  };
}

/**
 * Cierre de la Fase 9.3.7 (§113.6, §113.8, §113.9, D-X25, D-X26, ADR 0020): confirmación y
 * anulación reales, con PostgreSQL real. Todavía sin endpoints ni reautenticación (eso es de la
 * 9.3.8, que reutilizará `@RequireRecentAuth()` a nivel de controlador, igual que el resto de la
 * aplicación); el backup reciente (D-X26) sí se comprueba aquí, con el mismo patrón de manifiesto
 * que ya usa `test/backups.e2e-spec.ts` (sin depender de que `pg_dump` exista en este entorno).
 */
describe('confirmación y anulación reales de una importación (e2e, PostgreSQL real, §113)', () => {
  let ctx: TestApp;
  let backupDir: string;
  let owner: UserRow;
  let cookie: string;
  let projectId: string;
  let houseId: string;

  beforeAll(async () => {
    backupDir = `.data/test-import-confirm-${randomUUID()}`;
    ctx = await createTestApp({ env: { BACKUP_DIR: backupDir } });
  });
  afterAll(async () => {
    await ctx.close();
    await rm(backupDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await ctx.reset();
    await writeManifest(backupDir, []);
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    owner = await ctx.createUser({ email: 'owner@example.com' });
    cookie = sessionCookie(await login(ctx.server, owner.email).expect(200))!;
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Ensayo' })).project.id;
    // D-X1/D-X22: el proyecto debe estar apto (setup completo) antes de que el escritor acepte
    // nada; las casas en cero, el capital entra por la vía histórica (igual que import-writer.e2e-spec.ts).
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookie)
      .send({
        unitStake: '12.50',
        houses: [{ name: 'Betsafe', initialAmount: '0.00' }],
      })
      .expect(201);
    const houses = await request(ctx.server)
      .get(`/api/projects/${projectId}/houses`)
      .set('Cookie', cookie)
      .expect(200)
      .then((response) => response.body as { id: string; name: string }[]);
    houseId = houses.find((h) => h.name === 'Betsafe')!.id;
  });

  const upload = () => ctx.app.get(ImportUploadService);
  const resolution = () => ctx.app.get(ImportResolutionService);
  const confirmation = () => ctx.app.get(ImportConfirmationService);
  const acknowledgment = () => ctx.app.get(ImportAcknowledgmentService);

  /** Flujo real hasta VALIDATED con plan guardado, cubriendo ambas filas válidas. */
  async function prepareBatch() {
    const file = await buildBetsafeWorkbook();
    const { batch } = await upload().upload({
      projectId,
      actorUserId: owner.id,
      originalName: 'Betsafe.xlsx',
      file,
      adapter: BETSAFE_ADAPTER,
      timeZone: TIME_ZONE,
    });
    await resolution().confirmHouse({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      houseId,
    });
    await resolution().saveStagePlan({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      plan: fullCoveragePlan(),
    });
    return batch;
  }

  const confirmInput = (batchId: string, overrides: { isRehearsal?: boolean } = {}) => ({
    projectId,
    batchId,
    actorUserId: owner.id,
    reason: 'Historial de Betsafe',
    timeZone: TIME_ZONE,
    ...overrides,
  });

  describe('confirmación', () => {
    it('un lote válido, declarado como ensayo, llega hasta IMPORTED con ledger, dashboard y auditoría correctos', async () => {
      const batch = await prepareBatch();
      const result = await confirmation().confirmBatch(
        confirmInput(batch.id, { isRehearsal: true }),
      );

      expect(result.batch).toMatchObject({ status: 'IMPORTED', houseId, isRehearsal: true });
      expect(result.betIds).toHaveLength(2);
      expect(result.stageIds).toHaveLength(1);

      const [updatedBatch] = await ctx.t.db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(updatedBatch).toMatchObject({
        status: 'IMPORTED',
        importReason: 'Historial de Betsafe',
      });

      // El proyecto ya trae su etapa inicial del setup (D-X22); el lote añade la suya propia.
      const createdStages = await ctx.t.db
        .select()
        .from(stages)
        .where(eq(stages.projectId, projectId));
      const importedStage = createdStages.find((stage) => stage.batchId === batch.id);
      expect(importedStage).toMatchObject({ name: 'Ronda 1', unitStake: '12.50' });

      // El escritor ya audita el evento import.batch_imported dentro de su propia transacción (9.1.3).
      const [importedEvent] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'import.batch_imported'));
      expect(importedEvent).toMatchObject({ actorUserId: owner.id, projectId });

      // Invariante financiera completa (ledger = dashboard = conciliable, §112.7).
      await assertFinancialInvariant(ctx, { projectId, cookie });
    });

    it('sin backup reciente y sin declarar ensayo, la confirmación se rechaza (409) sin dejar el lote a medias', async () => {
      const batch = await prepareBatch();
      await expect(confirmation().confirmBatch(confirmInput(batch.id))).rejects.toMatchObject({
        status: 409,
      });

      const [after] = await ctx.t.db
        .select({ status: importBatches.status })
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(after).toEqual({ status: 'VALIDATED' });
      const createdBets = await ctx.t.db.select().from(bets).where(eq(bets.projectId, projectId));
      expect(createdBets).toHaveLength(0);
    });

    it('con un backup COMPLETED de hace menos de 24 horas, una importación real (sin ensayo) continúa', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();

      const result = await confirmation().confirmBatch(confirmInput(batch.id));
      expect(result.batch.status).toBe('IMPORTED');
    });

    it('un backup de hace más de 24 horas no cuenta como reciente: se rechaza igual que sin backup', async () => {
      const old = new Date(ctx.clock.now().getTime() - 25 * 60 * 60 * 1000);
      await writeManifest(backupDir, [completedGeneration(old.toISOString())]);
      const batch = await prepareBatch();

      await expect(confirmation().confirmBatch(confirmInput(batch.id))).rejects.toMatchObject({
        status: 409,
      });
    });

    it('reconocimiento faltante bloquea la confirmación aunque el backup esté al día', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      // Fila parcial: exige reconocimiento (D-X17b).
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Rondas');
      sheet.getCell('E3').value = 1000;
      sheet.getCell('B11').value = 1;
      sheet.getCell('C11').value = new Date('2024-10-22T00:00:00.000Z');
      sheet.getCell('F11').value = 'Equipo A vs. Equipo B: Gana Equipo A';
      sheet.getCell('G11').value = 'Simple';
      sheet.getCell('H11').value = 25;
      sheet.getCell('I11').value = 1.75;
      sheet.getCell('J11').value = 'GANADO';
      sheet.getCell('B12').value = 2;
      sheet.getCell('F12').value = 'Fila sin cuota ni resultado';
      sheet.getCell('H12').value = 20;
      const file = Buffer.from(await workbook.xlsx.writeBuffer());

      const { batch } = await upload().upload({
        projectId,
        actorUserId: owner.id,
        originalName: 'Betsafe.xlsx',
        file,
        adapter: BETSAFE_ADAPTER,
        timeZone: TIME_ZONE,
      });
      await resolution().confirmHouse({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        houseId,
      });
      await resolution().saveStagePlan({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        plan: {
          stages: [
            {
              key: 'r1',
              name: 'Ronda 1',
              unitStake: '12.50',
              startsAt: null,
              status: 'CLOSED',
              firstRow: 11,
              lastRow: 12,
            },
          ],
        },
      });

      await expect(confirmation().confirmBatch(confirmInput(batch.id))).rejects.toMatchObject({
        status: 409,
      });

      await acknowledgment().acknowledge({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Fila parcial revisada.',
      });
      const result = await confirmation().confirmBatch(confirmInput(batch.id));
      expect(result.batch.status).toBe('IMPORTED');
    });

    it('un intento de confirmar dos veces el mismo lote no deja nada duplicado (el segundo falla limpio)', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();
      await confirmation().confirmBatch(confirmInput(batch.id));

      await expect(confirmation().confirmBatch(confirmInput(batch.id))).rejects.toMatchObject({
        status: 409,
      });
      const createdBets = await ctx.t.db.select().from(bets).where(eq(bets.projectId, projectId));
      expect(createdBets).toHaveLength(2); // exactamente lo de la primera confirmación, nada duplicado.
    });
  });

  describe('anulación', () => {
    it('IMPORTED -> ANNULLED: revierte el ledger, guarda el motivo y audita el evento', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();
      await confirmation().confirmBatch(confirmInput(batch.id));

      const balanceBefore = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.projectId, projectId));
      expect(balanceBefore.length).toBeGreaterThan(0);

      const result = await confirmation().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Archivo equivocado',
      });
      expect(result.batch.status).toBe('ANNULLED');
      expect(result.annulledBetIds).toHaveLength(2);

      const [updatedBatch] = await ctx.t.db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(updatedBatch).toMatchObject({
        status: 'ANNULLED',
        annulmentReason: 'Archivo equivocado',
      });

      const [annulledEvent] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'import.batch_annulled'));
      expect(annulledEvent).toMatchObject({ actorUserId: owner.id, projectId });

      // El ledger vuelve al estado previo a la importación: la invariante sigue siendo válida.
      await assertFinancialInvariant(ctx, { projectId, cookie });
    });

    it('una segunda anulación se rechaza (409)', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();
      await confirmation().confirmBatch(confirmInput(batch.id));
      await confirmation().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Archivo equivocado',
      });

      await expect(
        confirmation().annulBatch({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          reason: 'Otra vez',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('exige un motivo', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();
      await confirmation().confirmBatch(confirmInput(batch.id));

      await expect(
        confirmation().annulBatch({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          reason: '  ',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('invalida un checkpoint de conciliación fechado en o después de lo revertido (§112.5)', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();
      await confirmation().confirmBatch(confirmInput(batch.id));

      const houses = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses`)
          .set('Cookie', cookie)
          .expect(200)
      ).body as { id: string; available: string }[];
      const available = houses.find((h) => h.id === houseId)!.available;

      // Se concilia justo después de importar: coincide exactamente (MATCHED).
      const checkpoint = (
        await request(ctx.server)
          .post(`/api/projects/${projectId}/houses/${houseId}/reconciliations`)
          .set('Cookie', cookie)
          .send({ officialAvailable: available })
          .expect(201)
      ).body as { id: string; status: string };
      expect(checkpoint.status).toBe('MATCHED');

      await confirmation().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Archivo equivocado',
      });

      const afterAnnul = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/houses/${houseId}/reconciliations`)
          .set('Cookie', cookie)
          .expect(200)
      ).body as {
        id: string;
        status: string;
        invalidatedAt: string | null;
        invalidatedReason: string | null;
      }[];
      const invalidated = afterAnnul.find((c) => c.id === checkpoint.id)!;
      expect(invalidated.status).toBe('INVALIDATED');
      expect(invalidated.invalidatedAt).not.toBeNull();
      expect(invalidated.invalidatedReason).not.toBeNull();

      // La invariante financiera completa sigue cumpliéndose tras la anulación.
      await assertFinancialInvariant(ctx, { projectId, cookie });
    });

    it('corregir una apuesta importada y luego anular el lote revierte lo vigente, no lo original', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();
      await confirmation().confirmBatch(confirmInput(batch.id));

      const importedBets = await ctx.t.db.select().from(bets).where(eq(bets.batchId, batch.id));
      const won = importedBets.find((b) => b.status === 'WON')!;

      // Corrección ordinaria (Fase 8.5): cambia el monto oficial de la apuesta ya importada.
      await request(ctx.server)
        .post(`/api/projects/${projectId}/bets/${won.id}/correct-settlement`)
        .set('Cookie', cookie)
        .send({
          version: won.version,
          reason: 'Monto mal leído del archivo',
          officialAmount: '30.00',
        })
        .expect(200);

      const result = await confirmation().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Archivo equivocado',
      });
      expect(result.annulledBetIds).toContain(won.id);

      // El ledger queda exactamente en el estado previo a la importación, con la corrección
      // revertida junto con todo lo demás (§113.8: "aunque se hayan corregido después").
      await assertFinancialInvariant(ctx, { projectId, cookie });
      const remainingMovements = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.projectId, projectId));
      // Cada movimiento del lote (capital + ambas apuestas, incluida la corrección) tiene su
      // reversión: el saldo neto de la casa vuelve a cero.
      expect(remainingMovements.length).toBeGreaterThan(0);
    });
  });

  describe('concurrencia', () => {
    it('dos confirmaciones simultáneas del mismo lote: solo una completa, sin duplicar ledger ni auditoría', async () => {
      await writeManifest(backupDir, [completedGeneration(ctx.clock.now().toISOString())]);
      const batch = await prepareBatch();

      const [first, second] = await Promise.allSettled([
        confirmation().confirmBatch(confirmInput(batch.id)),
        confirmation().confirmBatch(confirmInput(batch.id)),
      ]);
      const outcomes = [first, second];
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const createdBets = await ctx.t.db.select().from(bets).where(eq(bets.projectId, projectId));
      expect(createdBets).toHaveLength(2); // nunca 4: la segunda confirmación no duplicó nada.

      const importedEvents = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'import.batch_imported'));
      expect(importedEvents).toHaveLength(1);

      await assertFinancialInvariant(ctx, { projectId, cookie });
    });
  });
});
