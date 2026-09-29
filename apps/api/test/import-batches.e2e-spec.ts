import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeManifest } from '../src/backups/backup-files.js';
import type { UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'collab' | 'reader' | 'stranger';

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

/**
 * Fase 9.3.8 (§113, ADR 0020, docs/PLAN_FASE_9_3.md §5): endpoints HTTP completos sobre los
 * servicios ya construidos (9.3.3 a 9.3.7). PostgreSQL real; sin frontend todavía.
 */
describe('endpoints de importación (e2e, PostgreSQL real, §113, Fase 9.3.8)', () => {
  let ctx: TestApp;
  let backupDir: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;
  let projectId: string;
  let houseId: string;

  beforeAll(async () => {
    backupDir = `.data/test-import-endpoints-${randomUUID()}`;
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
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner: people.owner, name: 'Ensayo' })).project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }

    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '12.50', houses: [{ name: 'Betsafe', initialAmount: '0.00' }] })
      .expect(201);
    const houses = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as { id: string; name: string }[];
    houseId = houses.find((h) => h.name === 'Betsafe')!.id;
  });

  const base = (projId = projectId) => `/api/projects/${projId}/import-batches`;
  const uploadReq = (actor: Actor, file: Buffer, projId = projectId) =>
    request(ctx.server)
      .post(base(projId))
      .set('Cookie', cookies[actor])
      .field('origin', 'Betsafe')
      .attach('file', file, 'Betsafe.xlsx');
  const list = (actor: Actor, projId = projectId) =>
    request(ctx.server).get(base(projId)).set('Cookie', cookies[actor]);
  const get = (actor: Actor, batchId: string, projId = projectId) =>
    request(ctx.server)
      .get(`${base(projId)}/${batchId}`)
      .set('Cookie', cookies[actor]);
  const preview = (actor: Actor, batchId: string, projId = projectId) =>
    request(ctx.server)
      .get(`${base(projId)}/${batchId}/preview`)
      .query({ origin: 'Betsafe' })
      .set('Cookie', cookies[actor]);
  const confirmHouse = (actor: Actor, batchId: string, body: object, projId = projectId) =>
    request(ctx.server)
      .post(`${base(projId)}/${batchId}/house`)
      .set('Cookie', cookies[actor])
      .send(body);
  const saveStagePlan = (actor: Actor, batchId: string, body: object, projId = projectId) =>
    request(ctx.server)
      .post(`${base(projId)}/${batchId}/stage-plan`)
      .set('Cookie', cookies[actor])
      .send(body);
  const acknowledge = (actor: Actor, batchId: string, body: object, projId = projectId) =>
    request(ctx.server)
      .post(`${base(projId)}/${batchId}/acknowledge`)
      .set('Cookie', cookies[actor])
      .send(body);
  const confirm = (actor: Actor, batchId: string, body: object, projId = projectId) =>
    request(ctx.server)
      .post(`${base(projId)}/${batchId}/confirm`)
      .set('Cookie', cookies[actor])
      .send(body);
  const annul = (actor: Actor, batchId: string, body: object, projId = projectId) =>
    request(ctx.server)
      .post(`${base(projId)}/${batchId}/annul`)
      .set('Cookie', cookies[actor])
      .send(body);
  const file = (actor: Actor, batchId: string, projId = projectId) =>
    request(ctx.server)
      .get(`${base(projId)}/${batchId}/file`)
      .set('Cookie', cookies[actor]);

  const stagePlanBody = () => ({
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

  describe('permisos', () => {
    it('el Administrador de Proyecto puede subir y listar', async () => {
      const workbook = await buildBetsafeWorkbook();
      const uploaded = await uploadReq('owner', workbook).expect(201);
      expect(uploaded.body).toMatchObject({ status: 'UPLOADED' });

      const listed = await list('owner').expect(200);
      expect((listed.body as { id: string }[]).map((b) => b.id)).toContain(
        (uploaded.body as { id: string }).id,
      );
    });

    it('Colaborador y Lector reciben 403 (no tienen imports.view ni import.run)', async () => {
      const workbook = await buildBetsafeWorkbook();
      await uploadReq('collab', workbook).expect(403);
      await uploadReq('reader', workbook).expect(403);
      await list('collab').expect(403);
      await list('reader').expect(403);
    });

    it('un extraño sin membresía recibe 404 (no revela que el proyecto existe)', async () => {
      const workbook = await buildBetsafeWorkbook();
      await uploadReq('stranger', workbook).expect(404);
      await list('stranger').expect(404);
    });
  });

  describe('flujo completo', () => {
    it('upload -> house -> preview -> stage-plan -> acknowledge -> confirm -> IMPORTED', async () => {
      await writeManifest(backupDir, [
        {
          id: randomUUID(),
          takenAt: ctx.clock.now().toISOString(),
          triggeredBy: 'MANUAL',
          fileName: 'seed.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      const workbook = await buildBetsafeWorkbook();
      const uploaded = (await uploadReq('owner', workbook).expect(201)).body as {
        id: string;
        status: string;
      };
      const batchId = uploaded.id;

      const previewed = await preview('owner', batchId).expect(200);
      expect(previewed.body).toMatchObject({
        origin: 'Betsafe',
        summary: { totalRows: 2, valid: 2 },
      });

      const validated = await confirmHouse('owner', batchId, { houseId }).expect(200);
      expect(validated.body).toMatchObject({ status: 'VALIDATED', houseId });

      const withPlan = await saveStagePlan('owner', batchId, stagePlanBody()).expect(200);
      expect(withPlan.body).toMatchObject({ status: 'VALIDATED' });

      // Sin filas parciales en este archivo: el reconocimiento no es obligatorio, pero se prueba
      // que el endpoint funciona igual (D-X17b no exige que exista un motivo real que reconocer).
      await acknowledge('owner', batchId, { reason: 'Revisado, todo en orden.' }).expect(200);

      const confirmed = await confirm('owner', batchId, {
        reason: 'Historial de Betsafe',
        origin: 'Betsafe',
      }).expect(200);
      expect(confirmed.body).toMatchObject({ batch: { status: 'IMPORTED' } });

      const detail = await get('owner', batchId).expect(200);
      expect(detail.body).toMatchObject({ status: 'IMPORTED', houseId });

      const downloaded = await file('owner', batchId).expect(200);
      expect(downloaded.headers['content-disposition']).toContain('Betsafe.xlsx');
    });

    it('IMPORTED -> annul -> ANNULLED', async () => {
      await writeManifest(backupDir, [
        {
          id: randomUUID(),
          takenAt: ctx.clock.now().toISOString(),
          triggeredBy: 'MANUAL',
          fileName: 'seed.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      const workbook = await buildBetsafeWorkbook();
      const uploaded = (await uploadReq('owner', workbook).expect(201)).body as { id: string };
      const batchId = uploaded.id;
      await confirmHouse('owner', batchId, { houseId }).expect(200);
      await saveStagePlan('owner', batchId, stagePlanBody()).expect(200);
      await confirm('owner', batchId, { reason: 'Historial de Betsafe', origin: 'Betsafe' }).expect(
        200,
      );

      const annulled = await annul('owner', batchId, { reason: 'Archivo equivocado' }).expect(200);
      expect(annulled.body).toMatchObject({ batch: { status: 'ANNULLED' } });

      const detail = await get('owner', batchId).expect(200);
      expect(detail.body).toMatchObject({
        status: 'ANNULLED',
        annulmentReason: 'Archivo equivocado',
      });
    });
  });

  describe('seguridad (reautenticación reciente, D6)', () => {
    async function readyBatch(): Promise<string> {
      await writeManifest(backupDir, [
        {
          id: randomUUID(),
          takenAt: ctx.clock.now().toISOString(),
          triggeredBy: 'MANUAL',
          fileName: 'seed.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      const workbook = await buildBetsafeWorkbook();
      const uploaded = (await uploadReq('owner', workbook).expect(201)).body as { id: string };
      await confirmHouse('owner', uploaded.id, { houseId }).expect(200);
      await saveStagePlan('owner', uploaded.id, stagePlanBody()).expect(200);
      return uploaded.id;
    }

    it('confirm sin reautenticación reciente falla (403)', async () => {
      const batchId = await readyBatch();
      ctx.clock.advanceSeconds(6 * 60); // fuera del margen de reautenticación (5 min)
      await confirm('owner', batchId, { reason: 'Historial de Betsafe', origin: 'Betsafe' }).expect(
        403,
      );
    });

    it('annul sin reautenticación reciente falla (403)', async () => {
      const batchId = await readyBatch();
      await confirm('owner', batchId, { reason: 'Historial de Betsafe', origin: 'Betsafe' }).expect(
        200,
      );
      ctx.clock.advanceSeconds(6 * 60);
      await annul('owner', batchId, { reason: 'Archivo equivocado' }).expect(403);
    });
  });

  describe('errores', () => {
    it('lote inexistente devuelve 404', async () => {
      await get('owner', randomUUID()).expect(404);
      await confirmHouse('owner', randomUUID(), { houseId }).expect(404);
    });

    it('estado incorrecto: confirmar la casa de un lote ya IMPORTED se rechaza (409)', async () => {
      await writeManifest(backupDir, [
        {
          id: randomUUID(),
          takenAt: ctx.clock.now().toISOString(),
          triggeredBy: 'MANUAL',
          fileName: 'seed.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      const workbook = await buildBetsafeWorkbook();
      const uploaded = (await uploadReq('owner', workbook).expect(201)).body as { id: string };
      await confirmHouse('owner', uploaded.id, { houseId }).expect(200);
      await saveStagePlan('owner', uploaded.id, stagePlanBody()).expect(200);
      await confirm('owner', uploaded.id, {
        reason: 'Historial de Betsafe',
        origin: 'Betsafe',
      }).expect(200);

      await confirmHouse('owner', uploaded.id, { houseId }).expect(409);
    });

    it('un archivo que no es un .xlsx válido devuelve 400', async () => {
      await uploadReq('owner', Buffer.from('esto no es un xlsx')).expect(400);
    });

    it('permiso insuficiente: Colaborador no puede confirmar la casa (403)', async () => {
      const workbook = await buildBetsafeWorkbook();
      const uploaded = (await uploadReq('owner', workbook).expect(201)).body as { id: string };
      await confirmHouse('collab', uploaded.id, { houseId }).expect(403);
    });
  });
});
