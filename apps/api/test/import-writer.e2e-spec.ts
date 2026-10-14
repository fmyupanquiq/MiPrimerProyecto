import type { TrashItem, UnconfirmedReturnItem } from '@letfer/shared';
import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import {
  auditLogs,
  betCorrections,
  betSelections,
  bets,
  financialMovements,
  importBatches,
  importRows,
  stages,
  type UserRow,
} from '../src/database/schema/index.js';
import { ImportWriterService } from '../src/imports/import-writer.service.js';
import type { ImportBatchWriteInput, NormalizedImportBet } from '../src/imports/import-types.js';
import {
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

const at = (iso: string) => new Date(iso);
const DAY = '2024-10-22T12:00:00.000Z'; // fecha sin hora: 12:00 en la zona del proyecto (D-X23)
const CAPITAL_AT = '2024-10-22T00:00:00.000Z'; // 00:00 del mismo día de la primera apuesta (D-X23)

const single = (event: string, odds: string | null = '1.75') => [
  { eventGroup: 0, position: 0, event, selection: `${event}: gana`, visibleOdds: odds },
];

/** Cuatro apuestas del estilo del Excel de Betsafe: dos ganadas, una perdida y una pendiente. */
const sampleBets = (): NormalizedImportBet[] => [
  {
    rowNumber: 1,
    stageKey: 'r1',
    stake: '5',
    amount: '62.50',
    visibleTotalOdds: '1.75', // 62.5 × 1.75 = 109.375: empate de medio céntimo
    status: 'WON',
    placedAt: at(DAY),
    placedTimeKnown: false,
    settledAt: at(DAY),
    settledTimeKnown: false,
    selections: single('Real Madrid vs. Barcelona'),
  },
  {
    rowNumber: 2,
    stageKey: 'r1',
    stake: '2',
    amount: '25.00',
    visibleTotalOdds: '2.10',
    status: 'LOST',
    placedAt: at(DAY),
    placedTimeKnown: false,
    settledAt: at(DAY),
    settledTimeKnown: false,
    selections: single('Sevilla vs. Betis', '2.10'),
  },
  {
    rowNumber: 3,
    stageKey: 'r1',
    stake: '1',
    amount: '12.50',
    visibleTotalOdds: '1.510016', // múltiple: solo la cuota total, sin cuotas individuales (D-X15)
    status: 'WON',
    placedAt: at(DAY),
    placedTimeKnown: false,
    settledAt: at(DAY),
    settledTimeKnown: false,
    selections: [
      { eventGroup: 0, position: 0, event: 'A vs. B', selection: 'A gana', visibleOdds: null },
      { eventGroup: 1, position: 0, event: 'C vs. D', selection: 'C gana', visibleOdds: null },
    ],
  },
  {
    rowNumber: 4,
    stageKey: 'r1',
    stake: '4',
    amount: '50.00',
    visibleTotalOdds: '1.90',
    status: 'PENDING',
    placedAt: at(DAY),
    placedTimeKnown: false,
    settledAt: null,
    settledTimeKnown: true,
    selections: single('Valencia vs. Getafe', null),
  },
];

/**
 * Fase 9.1.5 (§113, ADR 0020, D-X25 a D-X29): el escritor de importación y la anulación de lotes, con
 * datos ya normalizados (sin lector de archivos ni endpoints). Todo con PostgreSQL real.
 */
describe('escritor de importación histórica (e2e, PostgreSQL real, §113)', () => {
  let ctx: TestApp;
  let owner: UserRow;
  let cookie: string;
  let projectId: string;
  let houseId: string;
  let otherHouseId: string;
  let salt = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-09-26T12:00:00.000Z');
    owner = await ctx.createUser({ email: 'owner@example.com' });
    projectId = (await insertProject(ctx.t.db, { owner, name: 'Ensayo' })).project.id;
    cookie = sessionCookie(await login(ctx.server, owner.email).expect(200))!;
    // D-X22: proyecto de ensayo con las casas en cero (el capital entra por la vía histórica).
    await request(ctx.server)
      .post(api('/setup'))
      .set('Cookie', cookie)
      .send({
        unitStake: '12.50',
        houses: [
          { name: 'Betsafe', initialAmount: '0.00' },
          { name: 'Betano', initialAmount: '0.00' },
        ],
      })
      .expect(201);
    const houses = await get<{ id: string; name: string }[]>('/houses');
    houseId = houses.find((h) => h.name === 'Betsafe')!.id;
    otherHouseId = houses.find((h) => h.name === 'Betano')!.id;
  });

  const api = (path: string) => `/api/projects/${projectId}${path}`;
  const get = <T>(path: string) =>
    request(ctx.server)
      .get(api(path))
      .set('Cookie', cookie)
      .expect(200)
      .then((response) => response.body as T);
  const writer = () => ctx.app.get(ImportWriterService);
  const invariant = () => assertFinancialInvariant(ctx, { projectId, cookie });

  /** Lote validado, con su casa y filas de staging (las apuestas de `sampleBets` y una de plantilla). */
  async function validatedBatch(options: { file?: string; house?: string; rows?: boolean } = {}) {
    salt += 1;
    const bytes = Buffer.from(options.file ?? `Betsafe.xlsx #${salt}`);
    const [uploaded] = await ctx.t.db
      .insert(importBatches)
      .values({
        projectId,
        origin: 'Betsafe',
        originalName: 'Betsafe.xlsx',
        sourceFile: bytes,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceSizeBytes: bytes.length,
        createdBy: owner.id,
      })
      .returning();
    if (options.rows !== false) {
      await ctx.t.db.insert(importRows).values([
        ...[1, 2, 3, 4].map((rowNumber) => ({
          importBatchId: uploaded!.id,
          rowNumber,
          rawValues: { N: String(rowNumber) },
          status: 'VALID' as const,
          trafficLight: 'GREEN' as const,
        })),
        {
          importBatchId: uploaded!.id,
          rowNumber: 5,
          rawValues: { N: '5' },
          status: 'TEMPLATE' as const,
        },
      ]);
    }
    const [validated] = await ctx.t.db
      .update(importBatches)
      .set({
        status: 'VALIDATED',
        houseId: options.house ?? houseId,
        validatedAt: new Date('2026-09-26T11:00:00.000Z'),
        validatedBy: owner.id,
        rowsTotal: 5,
        rowsValid: 4,
        rowsTemplate: 1,
      })
      .where(eq(importBatches.id, uploaded!.id))
      .returning();
    return validated!;
  }

  const input = (
    batchId: string,
    overrides: Partial<ImportBatchWriteInput> = {},
  ): ImportBatchWriteInput => ({
    projectId,
    batchId,
    actorUserId: owner.id,
    reason: 'Historial de Betsafe',
    stages: [
      {
        key: 'r1',
        name: 'Ronda 1',
        unitStake: '12.50',
        startsAt: at('2024-10-22T00:00:00.000Z'),
        status: 'CLOSED',
      },
    ],
    initialCapital: {
      amount: '1000.00',
      occurredAt: at(CAPITAL_AT),
      occurredAtKnown: false,
      stageKey: 'r1',
    },
    bets: sampleBets(),
    ...overrides,
  });

  /** Estado observable: filas del ledger, apuestas, etapas y auditoría de importación. */
  const state = async () => ({
    ledger: (await ctx.t.db.select().from(financialMovements)).length,
    bets: (await ctx.t.db.select().from(bets)).length,
    stages: (await ctx.t.db.select().from(stages)).length,
    selections: (await ctx.t.db.select().from(betSelections)).length,
    corrections: (await ctx.t.db.select().from(betCorrections)).length,
    events: (await ctx.t.db.select().from(auditLogs).where(like(auditLogs.action, 'import.%')))
      .length,
  });
  const batchStatus = async (id: string) =>
    (await ctx.t.db.select().from(importBatches).where(eq(importBatches.id, id)))[0]!.status;
  const houseBalance = async (id: string) =>
    (
      await get<{ id: string; balance: string; committed: string; available: string }[]>('/houses')
    ).find((h) => h.id === id)!;

  describe('importar un lote', () => {
    it('escribe etapas, capital histórico y apuestas con el ledger, y deja el lote importado', async () => {
      const batch = await validatedBatch();
      const result = await writer().importBatch(input(batch.id));

      // Lote importado con informe.
      expect(result.batch).toMatchObject({
        status: 'IMPORTED',
        importedBy: owner.id,
        importReason: 'Historial de Betsafe',
        isRehearsal: false,
      });
      expect(result.report).toMatchObject({
        houseId,
        stages: 1,
        initialCapital: '1000.00',
        bets: { total: 4, won: 2, lost: 1, pending: 1 },
        ledgerRows: 6, // capital + (colocación y liquidación) + colocación + (2) + 0 de la pendiente
        profitLoss: '28.26', // 46.88 − 25.00 + 6.38
        balanceBefore: '0.00',
        balanceAfter: '1028.26',
        warnings: [],
      });
      expect(result.batch.report).toEqual(result.report);
      expect(await batchStatus(batch.id)).toBe('IMPORTED');

      // Etapas del lote: cerradas, con inicio y lote; la del setup no se toca.
      const allStages = await ctx.t.db.select().from(stages);
      const imported = allStages.find((s) => s.batchId === batch.id)!;
      expect(imported).toMatchObject({
        name: 'Ronda 1',
        status: 'CLOSED',
        unitStake: '12.50',
        startsAt: at('2024-10-22T00:00:00.000Z'),
      });
      expect(allStages.find((s) => s.batchId === null)).toMatchObject({
        name: 'Etapa 1',
        status: 'ACTIVE',
        startsAt: null,
      });

      // Capital inicial histórico: fecha explícita, desconocida, con el lote; no la hora del servidor.
      const [capital] = await ctx.t.db
        .select()
        .from(financialMovements)
        .where(eq(financialMovements.id, result.initialCapitalMovementId!));
      expect(capital).toMatchObject({
        type: 'INITIAL_CAPITAL',
        direction: 'CREDIT',
        amount: '1000.00',
        houseId,
        stageId: imported.id,
        batchId: batch.id,
        occurredAt: at(CAPITAL_AT),
        occurredAtKnown: false,
      });

      // Apuestas: con el lote, monto oficial sin confirmar, ganadas provisionales y cuotas nulas.
      const rows = await ctx.t.db.select().from(bets).where(eq(bets.batchId, batch.id));
      expect(rows).toHaveLength(4);
      const byOdds = (odds: string) => rows.find((b) => b.visibleTotalOdds === odds)!;
      // Las cuotas de una hoja de cálculo no se pueden verificar: origen desconocido, nunca oficial.
      expect(rows.map((b) => b.totalOddsSource)).toEqual([
        'UNKNOWN',
        'UNKNOWN',
        'UNKNOWN',
        'UNKNOWN',
      ]);
      expect(byOdds('1.750000')).toMatchObject({
        status: 'WON',
        officialAmount: '62.50',
        amountConfirmed: false,
        officialRealizedReturn: null,
        calculatedRealizedReturn: '109.38', // ROUND_HALF_UP del empate de medio céntimo (D-B8 pendiente)
        placedAt: at(DAY),
        settledAt: at(DAY),
        placedTimeKnown: false,
        settledTimeKnown: false,
        stageId: imported.id,
        createdBy: owner.id,
        betType: 'SIMPLE',
      });
      expect(byOdds('1.510016')).toMatchObject({
        status: 'WON',
        calculatedRealizedReturn: '18.88',
        betType: 'MULTIPLE',
      });
      expect(byOdds('2.100000')).toMatchObject({ status: 'LOST', calculatedRealizedReturn: null });
      expect(byOdds('1.900000')).toMatchObject({ status: 'PENDING', settledAt: null });

      // Selecciones sin cuota individual en el múltiple y en la pendiente.
      const selections = await ctx.t.db.select().from(betSelections);
      expect(selections).toHaveLength(5);
      expect(selections.filter((s) => s.visibleOdds === null)).toHaveLength(3);

      // Ledger: solo lo que corresponde, todo con el lote y con las fechas históricas.
      const ledger = await ctx.t.db.select().from(financialMovements);
      expect(ledger).toHaveLength(6);
      expect(ledger.every((row) => row.batchId === batch.id)).toBe(true);
      expect(
        ledger
          .filter((row) => row.type === 'BET_PLACEMENT')
          .every((r) => r.occurredAt.getTime() === at(DAY).getTime()),
      ).toBe(true);
      expect(
        ledger
          .filter((row) => row.type === 'BET_SETTLEMENT')
          .map((r) => r.amount)
          .sort(),
      ).toEqual(['109.38', '18.88']);

      // Saldo y comprometido; las filas de staging enlazan sus apuestas.
      expect(await houseBalance(houseId)).toMatchObject({
        balance: '1028.26',
        committed: '50.00',
        available: '978.26',
      });
      const staged = await ctx.t.db
        .select()
        .from(importRows)
        .where(eq(importRows.importBatchId, batch.id));
      expect(staged.filter((row) => row.createdBetId !== null)).toHaveLength(4);
      expect(staged.find((row) => row.status === 'TEMPLATE')!.createdBetId).toBeNull();

      // Las ganadas aparecen como retornos por confirmar, con su lote.
      const unconfirmed = await get<UnconfirmedReturnItem[]>('/bets/unconfirmed-returns');
      expect(unconfirmed).toHaveLength(2);
      expect(unconfirmed.every((item) => item.batchId === batch.id)).toBe(true);

      // Invariante financiera y verificación de integridad.
      await invariant();
    });

    it('audita el lote una sola vez, con la huella completa y los contadores', async () => {
      const batch = await validatedBatch();
      await writer().importBatch(input(batch.id, { isRehearsal: true }));
      const events = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(like(auditLogs.action, 'import.%'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'import.batch_imported',
        entityId: batch.id,
        projectId,
        actorUserId: owner.id,
        oldValues: { status: 'VALIDATED' },
        newValues: { status: 'IMPORTED' },
        metadata: {
          batchId: batch.id,
          sha256: batch.sourceSha256,
          houseId,
          reason: 'Historial de Betsafe',
          rehearsal: true,
          rows: { total: 5, valid: 4, template: 1 },
        },
      });
      // Sin eventos por apuesta ni por fila.
      expect(
        await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.entityType, 'bet')),
      ).toEqual([]);
    });

    it('un lote sin capital ni apuestas se importa vacío', async () => {
      const batch = await validatedBatch({ rows: false });
      const result = await writer().importBatch(
        input(batch.id, { stages: [], initialCapital: null, bets: [] }),
      );
      expect(result.report).toMatchObject({ ledgerRows: 0, balanceAfter: '0.00' });
      await invariant();
    });

    it('avisa (sin bloquear) cuando en el peor orden de un mismo instante el saldo sería negativo', async () => {
      const batch = await validatedBatch({ rows: false });
      const bet = (rowNumber: number, amount: string, status: 'WON' | 'LOST', odds: string) =>
        ({
          ...sampleBets()[0]!,
          rowNumber: undefined,
          stake: '1',
          amount,
          visibleTotalOdds: odds,
          status,
        }) satisfies NormalizedImportBet;
      // Capital 10; en el mismo instante se pierden 10 y se gana una de 5 a cuota 3 (+10 neto).
      const result = await writer().importBatch(
        input(batch.id, {
          initialCapital: {
            amount: '10.00',
            occurredAt: at(CAPITAL_AT),
            occurredAtKnown: false,
            stageKey: 'r1',
          },
          bets: [bet(1, '10.00', 'LOST', '2.00'), bet(2, '5.00', 'WON', '3.00')],
        }),
      );
      expect(result.report.warnings).toHaveLength(1);
      expect(result.report.warnings[0]).toMatchObject({
        code: 'WORST_ORDER_NEGATIVE_BALANCE',
        houseId,
        occurredAt: DAY,
      });
      expect(result.report.balanceAfter).toBe('10.00'); // 10 − 10 + (15 − 5)
      await invariant();
    });
  });

  describe('si algo falla, se revierte todo', () => {
    it('datos no válidos: 400, sin escribir nada y el lote sigue validado', async () => {
      const batch = await validatedBatch();
      const before = await state();
      const broken = sampleBets();
      broken[1]!.visibleTotalOdds = '0';
      broken[2]!.stageKey = 'inexistente';
      const error = await writer()
        .importBatch(input(batch.id, { bets: broken }))
        .catch(
          (e: unknown) =>
            e as { getStatus: () => number; getResponse: () => { details: { issues: string[] } } },
        );
      expect((error as { getStatus: () => number }).getStatus()).toBe(400);
      expect(
        (error as { getResponse: () => { details: { issues: string[] } } }).getResponse().details
          .issues.length,
      ).toBeGreaterThanOrEqual(2);
      expect(await state()).toEqual(before);
      expect(await batchStatus(batch.id)).toBe('VALIDATED');
    });

    it('una secuencia imposible (saldo negativo en la línea de tiempo): 409 y nada queda a medias', async () => {
      const batch = await validatedBatch();
      const before = await state();
      // Capital de 10: la primera apuesta (62.50) no cabe.
      await expect(
        writer().importBatch(
          input(batch.id, {
            initialCapital: {
              amount: '10.00',
              occurredAt: at(CAPITAL_AT),
              occurredAtKnown: false,
              stageKey: 'r1',
            },
          }),
        ),
      ).rejects.toMatchObject({ status: 409, response: { code: 'CORRECTION_CONFLICT' } });
      expect(await state()).toEqual(before);
      expect(await batchStatus(batch.id)).toBe('VALIDATED');
      expect(
        await ctx.t.db.select().from(importRows).where(eq(importRows.importBatchId, batch.id)),
      ).toHaveLength(5);
    });

    it('una pendiente que dejaría el disponible en negativo se rechaza', async () => {
      const batch = await validatedBatch({ rows: false });
      const before = await state();
      await expect(
        writer().importBatch(
          input(batch.id, {
            initialCapital: {
              amount: '100.00',
              occurredAt: at(CAPITAL_AT),
              occurredAtKnown: false,
              stageKey: 'r1',
            },
            bets: [{ ...sampleBets()[3]!, rowNumber: undefined, amount: '150.00' }],
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await state()).toEqual(before);
    });

    it('si falla la auditoría, el lote no se importa y no queda nada', async () => {
      const batch = await validatedBatch();
      const before = await state();
      const spy = vi
        .spyOn(ctx.app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('fallo simulado de auditoría'));
      await expect(writer().importBatch(input(batch.id))).rejects.toThrow(
        'fallo simulado de auditoría',
      );
      spy.mockRestore();
      expect(await state()).toEqual(before);
      expect(await batchStatus(batch.id)).toBe('VALIDATED');
      // Y se puede reintentar con normalidad.
      await writer().importBatch(input(batch.id));
      expect(await batchStatus(batch.id)).toBe('IMPORTED');
      await invariant();
    });

    it('una fila de staging inexistente o no válida se rechaza', async () => {
      const batch = await validatedBatch();
      const before = await state();
      const withGhostRow = sampleBets();
      withGhostRow[0]!.rowNumber = 99;
      await expect(
        writer().importBatch(input(batch.id, { bets: withGhostRow })),
      ).rejects.toMatchObject({ status: 400 });
      expect(await state()).toEqual(before);
    });
  });

  describe('proyecto apto y estado del lote', () => {
    it('solo se importa un lote validado del proyecto', async () => {
      const [uploaded] = await ctx.t.db
        .insert(importBatches)
        .values({
          projectId,
          origin: 'Betsafe',
          originalName: 'Betsafe.xlsx',
          sourceFile: Buffer.from('x'),
          sourceSha256: createHash('sha256').update('x').digest('hex'),
          sourceSizeBytes: 1,
          createdBy: owner.id,
        })
        .returning();
      await expect(writer().importBatch(input(uploaded!.id))).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        writer().importBatch(input('01a0ddc6-a0f8-7149-8ef2-2f5f1aea5fb4')),
      ).rejects.toMatchObject({ status: 404 });
      // Un lote de otro proyecto no se ve desde este.
      const other = (await insertProject(ctx.t.db, { owner })).project.id;
      await expect(
        writer().importBatch(input(uploaded!.id, { projectId: other })),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('no se importa en una casa con movimientos ajenos a un lote; otra casa sin actividad sí', async () => {
      await request(ctx.server)
        .post(api('/movements/deposits'))
        .set('Cookie', cookie)
        .send({ houseId, amount: '100.00' })
        .expect(201);
      const batch = await validatedBatch();
      const before = await state();
      await expect(writer().importBatch(input(batch.id))).rejects.toMatchObject({ status: 409 });
      expect(await state()).toEqual(before);
      // La otra casa, sin actividad, sí es apta.
      const fit = await validatedBatch({ house: otherHouseId });
      await expect(writer().importBatch(input(fit.id))).resolves.toBeDefined();
    });

    it('una etapa activa del lote exige que el proyecto no tenga ya una', async () => {
      const batch = await validatedBatch();
      await expect(
        writer().importBatch(
          input(batch.id, {
            stages: [
              { key: 'r1', name: 'Ronda 1', unitStake: '12.50', startsAt: null, status: 'ACTIVE' },
            ],
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('idempotencia', () => {
    it('el mismo lote no se importa dos veces', async () => {
      const batch = await validatedBatch();
      await writer().importBatch(input(batch.id));
      const after = await state();
      await expect(writer().importBatch(input(batch.id))).rejects.toMatchObject({ status: 409 });
      expect(await state()).toEqual(after);
      await invariant();
    });

    it('el mismo archivo no se importa en otro lote mientras el primero siga vigente, y sí tras anularlo', async () => {
      const first = await validatedBatch({ file: 'mismo archivo' });
      await writer().importBatch(input(first.id));
      const second = await validatedBatch({ file: 'mismo archivo', rows: false });
      const after = await state();
      await expect(writer().importBatch(input(second.id, { bets: [] }))).rejects.toMatchObject({
        status: 409,
      });
      expect(await state()).toEqual(after);

      await writer().annulBatch({
        projectId,
        batchId: first.id,
        actorUserId: owner.id,
        reason: 'Prueba',
      });
      await expect(
        writer().importBatch(input(second.id, { bets: [], initialCapital: null })),
      ).resolves.toBeDefined();
      await invariant();
    });
  });

  describe('anular un lote', () => {
    it('devuelve el sistema a su estado anterior sin borrar nada y cumple la invariante', async () => {
      const before = await state();
      const balancesBefore = await get<unknown>('/dashboard/status');
      const batch = await validatedBatch();
      const result = await writer().importBatch(input(batch.id));
      const imported = await state();
      await invariant();

      const annulled = await writer().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Archivo equivocado',
      });

      // Lote anulado, con su motivo y su archivo original intactos.
      expect(annulled.batch).toMatchObject({
        status: 'ANNULLED',
        annulledBy: owner.id,
        annulmentReason: 'Archivo equivocado',
        importReason: 'Historial de Betsafe',
      });
      const [stored] = await ctx.t.db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(stored!.sourceFile.equals(Buffer.from(`Betsafe.xlsx #${salt}`))).toBe(true);

      // Apuestas: eliminadas lógicamente con el motivo fijo; no se borró ninguna.
      const rows = await ctx.t.db.select().from(bets).where(eq(bets.batchId, batch.id));
      expect(rows).toHaveLength(4);
      for (const bet of rows) {
        expect(bet).toMatchObject({ deletionReason: 'Lote anulado', deletedBy: owner.id });
        expect(bet.deletedAt).not.toBeNull();
      }
      expect(annulled.annulledBetIds.sort()).toEqual(result.betIds.sort());

      // Ledger: nada se borró, se añadieron reversiones (motivo fijo, con el lote) y el saldo vuelve a cero.
      const ledger = await ctx.t.db.select().from(financialMovements);
      expect(ledger.length).toBe(imported.ledger * 2);
      const reversals = ledger.filter((row) => row.type === 'REVERSAL');
      expect(reversals).toHaveLength(imported.ledger);
      expect(reversals.every((r) => r.reason === 'Lote anulado' && r.batchId === batch.id)).toBe(
        true,
      );
      // La reversión del capital histórico conserva que su fecha es un instante técnico, no una
      // fecha nueva y conocida (D-X29): revertir no debe volver "conocida" una fecha que no lo era.
      const capitalReversal = reversals.find(
        (r) => r.type === 'REVERSAL' && r.amount === '1000.00',
      );
      expect(capitalReversal).toMatchObject({ occurredAtKnown: false });
      expect(reversals.filter((r) => r.occurredAtKnown === false)).toHaveLength(1);
      expect(await houseBalance(houseId)).toMatchObject({
        balance: '0.00',
        committed: '0.00',
        available: '0.00',
      });

      // Correcciones de las tres liquidadas (ancla de sus reversiones) y ninguna para la pendiente.
      const corrections = await ctx.t.db.select().from(betCorrections);
      expect(corrections).toHaveLength(3);
      expect(
        corrections.every((c) => c.kind === 'TRASH_REVERSAL' && c.reason === 'Lote anulado'),
      ).toBe(true);

      // Etapas del lote anuladas; la del setup, intacta.
      const allStages = await ctx.t.db.select().from(stages);
      expect(allStages.find((s) => s.batchId === batch.id)).toMatchObject({
        status: 'TRASHED',
        deletionReason: 'Lote anulado',
      });
      expect(allStages.find((s) => s.batchId === null)).toMatchObject({
        status: 'ACTIVE',
        deletedAt: null,
      });
      expect(annulled.annulledStageIds).toHaveLength(1);

      // Lo mismo que antes, salvo el histórico que se conserva.
      expect(await get<unknown>('/dashboard/status')).toEqual(balancesBefore);
      expect(await state()).toMatchObject({
        stages: before.stages + 1,
        bets: imported.bets,
        ledger: imported.ledger * 2,
      });
      const analysis = await get<{
        capitalInvested: string;
        profitLoss: string;
        totalStaked: string;
      }>('/dashboard/analysis');
      expect(analysis).toMatchObject({
        capitalInvested: '0.00',
        profitLoss: '0.00',
        totalStaked: '0.00',
      });
      expect(await get<UnconfirmedReturnItem[]>('/bets/unconfirmed-returns')).toEqual([]);
      // La papelera solo muestra la etapa anulada; las apuestas del lote no se listan.
      const trash = await get<TrashItem[]>('/trash');
      expect(trash.filter((item) => item.kind === 'BET')).toEqual([]);
      expect(trash.filter((item) => item.kind === 'STAGE')).toHaveLength(1);
      await invariant();
    });

    it('audita la anulación y una apuesta anulada no se puede restaurar', async () => {
      const batch = await validatedBatch();
      await writer().importBatch(input(batch.id));
      await writer().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Archivo equivocado',
      });

      const events = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(like(auditLogs.action, 'import.%'));
      expect(events.map((e) => e.action).sort()).toEqual([
        'import.batch_annulled',
        'import.batch_imported',
      ]);
      expect(events.find((e) => e.action === 'import.batch_annulled')).toMatchObject({
        actorUserId: owner.id,
        oldValues: { status: 'IMPORTED' },
        newValues: { status: 'ANNULLED' },
        metadata: { reason: 'Archivo equivocado', sha256: batch.sourceSha256, houseId },
      });

      const annulledBets = await ctx.t.db.select().from(bets).where(eq(bets.batchId, batch.id));
      const pending = annulledBets.find((bet) => bet.status === 'PENDING')!;
      const settled = annulledBets.find((bet) => bet.status === 'WON')!;
      await request(ctx.server)
        .post(api(`/bets/${pending.id}/restore`))
        .set('Cookie', cookie)
        .send({})
        .expect(409);
      await request(ctx.server)
        .post('/api/auth/reauth')
        .set('Cookie', cookie)
        .send({ password: TEST_PASSWORD })
        .expect(200);
      const rowsBefore = (await ctx.t.db.select().from(financialMovements)).length;
      await request(ctx.server)
        .post(api(`/bets/${settled.id}/restore`))
        .set('Cookie', cookie)
        .send({ reason: 'Intento de restauración' })
        .expect(409);
      expect((await ctx.t.db.select().from(financialMovements)).length).toBe(rowsBefore);
      await invariant();
    });

    it('la doble anulación no genera efectos duplicados', async () => {
      const batch = await validatedBatch();
      await writer().importBatch(input(batch.id));
      await writer().annulBatch({
        projectId,
        batchId: batch.id,
        actorUserId: owner.id,
        reason: 'Primera',
      });
      const after = await state();
      await expect(
        writer().annulBatch({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          reason: 'Segunda',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await state()).toEqual(after);
      const [stored] = await ctx.t.db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, batch.id));
      expect(stored!.annulmentReason).toBe('Primera');
      await invariant();
    });

    it('solo se anula un lote importado y con motivo', async () => {
      const batch = await validatedBatch();
      await expect(
        writer().annulBatch({ projectId, batchId: batch.id, actorUserId: owner.id, reason: 'x' }),
      ).rejects.toMatchObject({ status: 409 });
      await writer().importBatch(input(batch.id));
      await expect(
        writer().annulBatch({ projectId, batchId: batch.id, actorUserId: owner.id, reason: '   ' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await batchStatus(batch.id)).toBe('IMPORTED');
    });

    it('se rechaza (409) si revertir el lote dejaría una casa en negativo por operaciones posteriores', async () => {
      const batch = await validatedBatch();
      await writer().importBatch(input(batch.id));
      // Una transferencia posterior usa capital importado.
      await request(ctx.server)
        .post(api('/movements/transfers'))
        .set('Cookie', cookie)
        .send({ fromHouseId: houseId, toHouseId: otherHouseId, amount: '900.00' })
        .expect(201);
      const after = await state();
      await expect(
        writer().annulBatch({
          projectId,
          batchId: batch.id,
          actorUserId: owner.id,
          reason: 'Anular',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await state()).toEqual(after);
      expect(await batchStatus(batch.id)).toBe('IMPORTED');
    });
  });
});
