import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bets, financialMovements, type UserRow } from '../src/database/schema/index.js';
import { ImportAcknowledgmentService } from '../src/imports/import-acknowledgment.service.js';
import { ImportBetResolutionService } from '../src/imports/import-bet-resolution.service.js';
import { ImportConfirmationService } from '../src/imports/import-confirmation.service.js';
import { ImportResolutionService } from '../src/imports/import-resolution.service.js';
import type { ImportStagePlan } from '../src/imports/import-types.js';
import { ImportUploadService } from '../src/imports/import-upload.service.js';
import { BETSAFE_ADAPTER } from '../src/imports/parser/betsafe-adapter.js';
import { createTestApp, type TestApp } from './support/create-app.js';
import { insertHouse, insertProject } from './support/factories.js';

const TIME_ZONE = 'America/Lima';

/**
 * Hoja sintética de Betsafe con dos filas válidas (fila 11 ganada, fila 12 perdida) y, si
 * `withPartialRow`, una tercera fila (13) parcial: monto sin cuota ni resultado (D-X21b).
 */
async function buildBetsafeWorkbook(options: { withPartialRow?: boolean } = {}): Promise<Buffer> {
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
  if (options.withPartialRow) {
    sheet.getCell('B13').value = 3;
    sheet.getCell('F13').value = 'Equipo E vs. Equipo F: Gana Equipo E';
    sheet.getCell('H13').value = 20;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Plan de etapas que cubre las filas 11 y 12 (una sola ronda). */
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

/**
 * Bloque 9.3.5 + 9.3.6 + preparación de 9.3.7 (§113.3, §113.6, §113.7, D-X7, D-X17b, D-X19, ADR
 * 0020): resolución de stageKey/stake, reconocimientos y ensamblado de `ImportBatchWriteInput`,
 * con PostgreSQL real, encadenando los servicios ya construidos (9.3.3, 9.3.4). Ningún efecto en
 * el ledger en todo este bloque: `ImportWriterService.importBatch()` no se llama en ningún punto.
 */
describe('resolución de apuestas, reconocimientos y preparación de la confirmación (e2e, §113)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let projectId: string;
  let houseId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Ensayo' })).project.id;
    houseId = (await insertHouse(ctx.t.db, { projectId, name: 'Betsafe' })).id;
  });

  const upload = () => ctx.app.get(ImportUploadService);
  const resolution = () => ctx.app.get(ImportResolutionService);
  const betResolution = () => ctx.app.get(ImportBetResolutionService);
  const acknowledgment = () => ctx.app.get(ImportAcknowledgmentService);
  const confirmation = () => ctx.app.get(ImportConfirmationService);

  /** Flujo real hasta VALIDATED con plan guardado: upload -> resolve house -> stage plan. */
  async function prepareBatch(options: { withPartialRow?: boolean } = {}) {
    const file = await buildBetsafeWorkbook(options);
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

  it('flujo real completo: upload -> resolve house -> stage plan -> resolve bets, con stageKey/stake correctos', async () => {
    const batch = await prepareBatch();
    const resolved = await betResolution().resolveBatch({ projectId, batchId: batch.id });

    expect(resolved.stages).toEqual([
      { key: 'r1', name: 'Ronda 1', unitStake: '12.50', startsAt: null, status: 'CLOSED' },
    ]);
    expect(resolved.bets).toHaveLength(2);
    const won = resolved.bets.find((bet) => bet.rowNumber === 11)!;
    expect(won).toMatchObject({ stageKey: 'r1', amount: '25.00', stake: '2.0000', status: 'WON' });
    const lost = resolved.bets.find((bet) => bet.rowNumber === 12)!;
    expect(lost).toMatchObject({
      stageKey: 'r1',
      amount: '75.00',
      stake: '6.0000',
      status: 'LOST',
    });
    expect(resolved.inexactStakeRows).toEqual([]);
  });

  it('una fila válida sin etapa asignada bloquea la resolución (400), sin construir ninguna apuesta a medias', async () => {
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
    // El plan solo cubre la fila 11: la 12 (válida, perdida) se queda sin etapa.
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
            lastRow: 11,
          },
        ],
      },
    });

    await expect(
      betResolution().resolveBatch({ projectId, batchId: batch.id }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('sin reconocer (filas parciales presentes), la disposición a confirmar es negativa y el ensamblado se rechaza', async () => {
    const batch = await prepareBatch({ withPartialRow: true });

    const readiness = await acknowledgment().canConfirmImport({
      projectId,
      batchId: batch.id,
      timeZone: TIME_ZONE,
    });
    expect(readiness).toMatchObject({
      blocked: false,
      needsAcknowledgment: true,
      acknowledged: false,
      canConfirm: false,
    });

    await expect(
      confirmation().assembleWriteInput({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Historial de Betsafe',
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('reconocer con motivo permite continuar: la disposición pasa a positiva y el ensamblado produce un ImportBatchWriteInput completo', async () => {
    const batch = await prepareBatch({ withPartialRow: true });

    await acknowledgment().acknowledge({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      reason: 'Fila parcial revisada: sin datos suficientes en el archivo original.',
    });

    const readiness = await acknowledgment().canConfirmImport({
      projectId,
      batchId: batch.id,
      timeZone: TIME_ZONE,
    });
    expect(readiness).toMatchObject({
      needsAcknowledgment: true,
      acknowledged: true,
      canConfirm: true,
    });

    const input = await confirmation().assembleWriteInput({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe',
      timeZone: TIME_ZONE,
    });

    expect(input).toMatchObject({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe',
      stages: [{ key: 'r1', name: 'Ronda 1', unitStake: '12.50', status: 'CLOSED' }],
    });
    expect(input.bets).toHaveLength(2);
    expect(input.initialCapital).toMatchObject({
      amount: '1000.00',
      stageKey: 'r1',
      occurredAtKnown: false,
    });
  });

  it('rowsInvalid bloquea sin excepción: ni siquiera un reconocimiento permite continuar', async () => {
    // Fila inválida: resultado que no está en el vocabulario esperado (bloquea, D-X17b BLOCKING).
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rondas');
    sheet.getCell('E3').value = 1000;
    sheet.getCell('B11').value = 1;
    sheet.getCell('C11').value = new Date('2024-10-22T00:00:00.000Z');
    sheet.getCell('F11').value = 'Equipo A vs. Equipo B: Gana Equipo A';
    sheet.getCell('G11').value = 'Simple';
    sheet.getCell('H11').value = 25;
    sheet.getCell('I11').value = 1.75;
    sheet.getCell('J11').value = 'RESULTADO_DESCONOCIDO';
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
    await acknowledgment().acknowledge({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      reason: 'Se reconoce, pero esto no debería bastar: hay una fila inválida.',
    });

    const readiness = await acknowledgment().canConfirmImport({
      projectId,
      batchId: batch.id,
      timeZone: TIME_ZONE,
    });
    expect(readiness).toMatchObject({ blocked: true, canConfirm: false });

    await expect(
      confirmation().assembleWriteInput({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Historial de Betsafe',
        timeZone: TIME_ZONE,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('nada de este bloque toca el ledger: ni apuestas ni movimientos financieros', async () => {
    const batch = await prepareBatch({ withPartialRow: true });
    await acknowledgment().acknowledge({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      reason: 'Fila parcial revisada.',
    });
    await confirmation().assembleWriteInput({
      projectId,
      batchId: batch.id,
      actorUserId: owner.id,
      reason: 'Historial de Betsafe',
      timeZone: TIME_ZONE,
    });

    const createdBets = await ctx.t.db.select().from(bets).where(eq(bets.projectId, projectId));
    const createdMovements = await ctx.t.db
      .select()
      .from(financialMovements)
      .where(eq(financialMovements.projectId, projectId));
    expect(createdBets).toHaveLength(0);
    expect(createdMovements).toHaveLength(0);
  });
});
