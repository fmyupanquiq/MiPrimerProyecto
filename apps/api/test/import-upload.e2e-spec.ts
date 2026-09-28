import ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  importBatches,
  importRows,
  type UserRow,
} from '../src/database/schema/index.js';
import { BETSAFE_ADAPTER } from '../src/imports/parser/betsafe-adapter.js';
import { ImportUploadService } from '../src/imports/import-upload.service.js';
import type { ImportOriginAdapter } from '../src/imports/parser/import-normalization.js';
import { createTestApp, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';

const TIME_ZONE = 'America/Lima';

/** Hoja con la forma confirmada de Betsafe (§113, 9.2.0); datos sintéticos, no el archivo de nadie. */
async function buildBetsafeWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rondas');
  sheet.getCell('E3').value = 1000;
  sheet.getCell('B8').value = 'RONDA 1';
  const row = (
    n: number,
    values: {
      description: string;
      amount: number;
      odds: number;
      result: string;
      totalReturn: number;
      profit: number;
    },
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
    sheet.getCell(`K${r}`).value = values.totalReturn;
    sheet.getCell(`L${r}`).value = values.profit;
  };
  row(1, {
    description: 'Equipo A vs. Equipo B:\nGana Equipo A',
    amount: 62.5,
    odds: 1.75,
    result: 'GANADO',
    totalReturn: 109.375,
    profit: 46.875,
  });
  row(2, {
    description: 'Equipo C vs. Equipo D:\nGana Equipo C',
    amount: 75,
    odds: 1.57,
    result: 'PERDIDO',
    totalReturn: -75,
    profit: -75,
  });
  // Fila parcial (D-X21b): tiene monto pero le falta la cuota y el resultado.
  sheet.getCell('B13').value = 3;
  sheet.getCell('C13').value = new Date('2024-10-23T00:00:00.000Z');
  sheet.getCell('F13').value = 'Equipo E vs. Equipo F: Gana Equipo E';
  sheet.getCell('H13').value = 20;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Fase 9.3.3 (§113, ADR 0020, docs/PLAN_FASE_9_3.md §3): subir un archivo crea el lote `UPLOADED`
 * y persiste su staging (`import_rows`), sin resolver casa, etapas ni escribir nada al ledger.
 */
describe('subida y persistencia de staging de importación (e2e, PostgreSQL real, §113)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Ensayo' })).project.id;
  });

  const service = () => ctx.app.get(ImportUploadService);

  it('crea el lote UPLOADED y persiste una fila de staging por cada fila del archivo', async () => {
    const file = await buildBetsafeWorkbook();
    const { batch, preview } = await service().upload({
      projectId,
      actorUserId: owner.id,
      originalName: 'Betsafe.xlsx',
      file,
      adapter: BETSAFE_ADAPTER,
      timeZone: TIME_ZONE,
    });

    expect(batch).not.toHaveProperty('sourceFile');
    expect(batch).toMatchObject({
      projectId,
      status: 'UPLOADED',
      houseId: null,
      originalName: 'Betsafe.xlsx',
      rowsTotal: 3,
      rowsValid: 2,
      rowsPartial: 1,
      rowsTemplate: 0,
      rowsEmpty: 0,
      rowsInvalid: 0,
    });
    expect(preview.summary).toMatchObject({ totalRows: 3, valid: 2, partial: 1 });

    const rows = await ctx.t.db
      .select()
      .from(importRows)
      .where(eq(importRows.importBatchId, batch.id))
      .orderBy(importRows.rowNumber);
    expect(rows).toHaveLength(3);

    // Fila 11 (VALID, ganada; primera fila de datos de Betsafe): staging completo, con la apuesta
    // preliminar y su semáforo financiero.
    expect(rows[0]).toMatchObject({
      rowNumber: 11,
      status: 'VALID',
      trafficLight: 'GREEN',
      createdBetId: null,
    });
    expect(rows[0]!.rawValues).toMatchObject({ H: 62.5, I: 1.75, J: 'GANADO' });
    expect(rows[0]!.normalized).toMatchObject({
      amount: '62.50',
      visibleTotalOdds: '1.75',
      status: 'WON',
      placedTimeKnown: false,
    });
    expect(rows[0]!.findings).toEqual([]);

    // Fila 13 (PARTIAL): sin apuesta preliminar ni semáforo financiero, pero con sus hallazgos.
    expect(rows[2]).toMatchObject({ rowNumber: 13, status: 'PARTIAL', trafficLight: null });
    expect(rows[2]!.normalized).toBeNull();
    expect(rows[2]!.findings).not.toHaveLength(0);
  });

  it('registra el evento import.batch_uploaded en la auditoría', async () => {
    const file = await buildBetsafeWorkbook();
    const { batch } = await service().upload({
      projectId,
      actorUserId: owner.id,
      originalName: 'Betsafe.xlsx',
      file,
      adapter: BETSAFE_ADAPTER,
      timeZone: TIME_ZONE,
    });

    const [event] = await ctx.t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'import_batch'), eq(auditLogs.entityId, batch.id)));
    expect(event).toMatchObject({
      action: 'import.batch_uploaded',
      actorUserId: owner.id,
      projectId,
    });
  });

  it('con un origen sin financialContrast configurado, el semáforo financiero queda NULL en toda fila', async () => {
    const fakeAdapter: ImportOriginAdapter = {
      name: 'Origen de prueba',
      sheetName: 'Bets',
      template: {
        name: 'Origen de prueba',
        firstDataRow: 2,
        columns: { date: 'A', description: 'B', amount: 'C', odds: 'D', result: 'E' },
        resultVocabulary: { WIN: 'WON', LOSE: 'LOST' },
        stageLabel: { column: 'A', pattern: /^SEASON/i },
      },
      parseSelections: (description, sport) => [
        {
          eventGroup: 0,
          position: 0,
          sport,
          event: description,
          market: null,
          selection: description,
          visibleOdds: null,
        },
      ],
      declaredTypeVocabulary: {},
    };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bets');
    sheet.getCell('A2').value = new Date('2026-01-10T00:00:00.000Z');
    sheet.getCell('B2').value = 'Alpha wins';
    sheet.getCell('C2').value = 10;
    sheet.getCell('D2').value = 2;
    sheet.getCell('E2').value = 'WIN';
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const { batch } = await service().upload({
      projectId,
      actorUserId: owner.id,
      originalName: 'origen-de-prueba.xlsx',
      file,
      adapter: fakeAdapter,
      timeZone: 'UTC',
    });

    const rows = await ctx.t.db
      .select()
      .from(importRows)
      .where(eq(importRows.importBatchId, batch.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'VALID', trafficLight: null });
  });

  it('un archivo mayor a 10 MB se rechaza (400) antes de tocar la base de datos', async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(
      service().upload({
        projectId,
        actorUserId: owner.id,
        originalName: 'demasiado-grande.xlsx',
        file: oversized,
        adapter: BETSAFE_ADAPTER,
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const [count] = await ctx.t.db.select().from(importBatches);
    expect(count).toBeUndefined();
  });

  it('un archivo que no es un .xlsx se rechaza (400) sin dejar ningún lote a medias', async () => {
    await expect(
      service().upload({
        projectId,
        actorUserId: owner.id,
        originalName: 'no-es-un-excel.xlsx',
        file: Buffer.from('esto no es un xlsx'),
        adapter: BETSAFE_ADAPTER,
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const rowsInProject = await ctx.t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.projectId, projectId));
    expect(rowsInProject).toHaveLength(0);
  });
});
