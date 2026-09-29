import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { BackupGeneration } from '@letfer/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeManifest } from '../src/backups/backup-files.js';
import type { UserRow } from '../src/database/schema/index.js';
import { ImportAcknowledgmentService } from '../src/imports/import-acknowledgment.service.js';
import { ImportBatchQueryService } from '../src/imports/import-batch-query.service.js';
import { ImportConfirmationService } from '../src/imports/import-confirmation.service.js';
import { ImportResolutionService } from '../src/imports/import-resolution.service.js';
import type { ImportStagePlan } from '../src/imports/import-types.js';
import { ImportUploadService } from '../src/imports/import-upload.service.js';
import { BETSAFE_ADAPTER } from '../src/imports/parser/betsafe-adapter.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';

const TIME_ZONE = 'America/Lima';

/**
 * Una sola fila (11): mismo contenido siempre que `overrides` no lo cambie. `salt` cambia los
 * bytes del archivo (huella distinta, D-X10 "archivo ya importado") sin tocar ninguna celda que
 * el pipeline lea: dos archivos con el mismo `salt` producen exactamente el mismo contenido.
 */
async function buildSingleBetWorkbook(
  overrides: {
    description?: string;
    amount?: number;
    odds?: number;
    result?: string;
    salt?: string;
  } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  sheet.getCell('E3').value = 1000;
  if (overrides.salt) sheet.getCell('Z1').value = overrides.salt;
  sheet.getCell('B11').value = 1;
  sheet.getCell('C11').value = new Date('2024-10-22T00:00:00.000Z');
  sheet.getCell('E11').value = 'FUTBOL';
  sheet.getCell('F11').value = overrides.description ?? 'Equipo A vs. Equipo B: Gana Equipo A';
  sheet.getCell('G11').value = 'Simple';
  sheet.getCell('H11').value = overrides.amount ?? 25;
  sheet.getCell('I11').value = overrides.odds ?? 1.75;
  sheet.getCell('J11').value = overrides.result ?? 'GANADO';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const plan = (): ImportStagePlan => ({
  stages: [
    {
      key: 'r1',
      name: 'Ronda 1',
      unitStake: '12.50',
      startsAt: null,
      status: 'CLOSED',
      firstRow: 11,
      lastRow: 11,
    },
  ],
});

/**
 * D-X10 (Fase 9.3.9, §113.6): duplicados por contenido, dentro del archivo (ya probado sin BD en
 * `parser/import-duplicate-detection.spec.ts`) y contra el histórico ya importado de la misma
 * casa. Nunca bloquea por sí solo: exige el mismo reconocimiento que una fila parcial o el
 * semáforo financiero en rojo.
 */
describe('duplicados por contenido D-X10 (e2e, PostgreSQL real, §113.6)', () => {
  let ctx: TestApp;
  let backupDir: string;
  let owner: UserRow;
  let cookie: string;
  let projectId: string;
  let houseId: string;

  beforeAll(async () => {
    backupDir = `.data/test-import-duplicates-${randomUUID()}`;
    ctx = await createTestApp({ env: { BACKUP_DIR: backupDir } });
  });
  afterAll(async () => {
    await ctx.close();
    await rm(backupDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await ctx.reset();
    await writeManifest(backupDir, [
      {
        id: randomUUID(),
        takenAt: new Date('2026-06-01T12:00:00.000Z').toISOString(),
        triggeredBy: 'MANUAL',
        fileName: 'seed.dump',
        sizeBytes: 10,
        checksum: 'abc',
        ticketsFileName: null,
        ticketsSizeBytes: null,
        ticketsChecksum: null,
        status: 'COMPLETED',
        errorMessage: null,
      } satisfies BackupGeneration,
    ]);
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    owner = await ctx.createUser({ email: 'owner@example.com' });
    cookie = sessionCookie(await login(ctx.server, owner.email).expect(200))!;
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Ensayo' })).project.id;
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookie)
      .send({ unitStake: '12.50', houses: [{ name: 'Betsafe', initialAmount: '0.00' }] })
      .expect(201);
    const houses = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookie)
        .expect(200)
    ).body as { id: string; name: string }[];
    houseId = houses.find((h) => h.name === 'Betsafe')!.id;
  });

  const upload = () => ctx.app.get(ImportUploadService);
  const resolution = () => ctx.app.get(ImportResolutionService);
  const query = () => ctx.app.get(ImportBatchQueryService);
  const acknowledgment = () => ctx.app.get(ImportAcknowledgmentService);
  const confirmation = () => ctx.app.get(ImportConfirmationService);

  async function uploadAndPrepare(file: Buffer) {
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
      plan: plan(),
    });
    return batch;
  }

  it('dentro del mismo archivo: la vista previa reporta el grupo, sin bloquear nada más', async () => {
    // Dos filas iguales en el mismo archivo (fila 11 y una segunda con el mismo contenido en 12).
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rondas');
    sheet.getCell('E3').value = 1000;
    for (const row of [11, 12]) {
      sheet.getCell(`B${row}`).value = row - 10;
      sheet.getCell(`C${row}`).value = new Date('2024-10-22T00:00:00.000Z');
      sheet.getCell(`F${row}`).value = 'Equipo A vs. Equipo B: Gana Equipo A';
      sheet.getCell(`G${row}`).value = 'Simple';
      sheet.getCell(`H${row}`).value = 25;
      sheet.getCell(`I${row}`).value = 1.75;
      sheet.getCell(`J${row}`).value = 'GANADO';
    }
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const { batch } = await upload().upload({
      projectId,
      actorUserId: owner.id,
      originalName: 'Betsafe.xlsx',
      file,
      adapter: BETSAFE_ADAPTER,
      timeZone: TIME_ZONE,
    });

    const preview = await query().preview(projectId, batch.id, TIME_ZONE);
    expect(preview.duplicates.withinFile).toEqual([
      {
        rowNumbers: [11, 12],
        existingBetIds: [],
        date: '2024-10-22',
        amount: '25.00',
        odds: '1.75',
      },
    ]);
    expect(preview.duplicates.againstHistory).toEqual([]); // sin casa confirmada todavía.
  });

  it('contra el histórico: una fila que coincide con una apuesta ya importada de la misma casa se reporta', async () => {
    const firstFile = await buildSingleBetWorkbook();
    const firstBatch = await uploadAndPrepare(firstFile);
    const imported = await confirmation().confirmBatch({
      projectId,
      batchId: firstBatch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe (lote 1)',
      timeZone: TIME_ZONE,
    });
    expect(imported.batch.status).toBe('IMPORTED');

    // Segundo archivo, misma casa, misma fecha/monto/cuota/descripción que la ya importada.
    const secondFile = await buildSingleBetWorkbook();
    const secondBatch = await uploadAndPrepare(secondFile);

    const preview = await query().preview(projectId, secondBatch.id, TIME_ZONE);
    expect(preview.duplicates.againstHistory).toHaveLength(1);
    expect(preview.duplicates.againstHistory[0]).toMatchObject({
      rowNumbers: [11],
      date: '2024-10-22',
      amount: '25.00',
      odds: '1.75',
    });
    expect(preview.duplicates.againstHistory[0]!.existingBetIds).toHaveLength(1);
  });

  it('un lote anulado no cuenta como histórico: sus apuestas ya no comparan', async () => {
    const firstFile = await buildSingleBetWorkbook();
    const firstBatch = await uploadAndPrepare(firstFile);
    await confirmation().confirmBatch({
      projectId,
      batchId: firstBatch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe (lote 1)',
      timeZone: TIME_ZONE,
    });
    await confirmation().annulBatch({
      projectId,
      batchId: firstBatch.id,
      actorUserId: owner.id,
      reason: 'Archivo equivocado',
    });

    const secondFile = await buildSingleBetWorkbook();
    const secondBatch = await uploadAndPrepare(secondFile);
    const preview = await query().preview(projectId, secondBatch.id, TIME_ZONE);
    expect(preview.duplicates.againstHistory).toEqual([]);
  });

  it('un duplicado exige reconocimiento antes de confirmar, y no bloquea para siempre', async () => {
    const firstFile = await buildSingleBetWorkbook();
    const firstBatch = await uploadAndPrepare(firstFile);
    await confirmation().confirmBatch({
      projectId,
      batchId: firstBatch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe (lote 1)',
      timeZone: TIME_ZONE,
    });

    const secondFile = await buildSingleBetWorkbook({ salt: 'segundo archivo' });
    const secondBatch = await uploadAndPrepare(secondFile);

    const readiness = await acknowledgment().canConfirmImport({
      projectId,
      batchId: secondBatch.id,
      timeZone: TIME_ZONE,
    });
    expect(readiness).toMatchObject({
      blocked: false,
      needsAcknowledgment: true,
      canConfirm: false,
    });

    await expect(
      confirmation().confirmBatch({
        projectId,
        batchId: secondBatch.id,
        actorUserId: owner.id,
        reason: 'Historial de Betsafe (lote 2, con duplicado real)',
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 409 });

    await acknowledgment().acknowledge({
      projectId,
      batchId: secondBatch.id,
      actorUserId: owner.id,
      reason: 'Duplicado revisado: es una apuesta distinta que coincide por casualidad.',
    });
    const confirmed = await confirmation().confirmBatch({
      projectId,
      batchId: secondBatch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe (lote 2, con duplicado real)',
      timeZone: TIME_ZONE,
    });
    expect(confirmed.batch.status).toBe('IMPORTED');
  });
});
