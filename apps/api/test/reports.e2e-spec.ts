import { averageMoney, compareMoney, sumMoney, type ReportData } from '@letfer/shared';
import { count } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bets as betsTable,
  financialMovements,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';
import { assertFinancialInvariant } from './support/financial-invariant.js';

type Actor = 'owner' | 'reader' | 'stranger';

/** Respuesta binaria de supertest (el PDF) como Buffer. */
const binary = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('reportes e informes PDF (e2e, PostgreSQL real, §108.11)', () => {
  let ctx: TestApp;
  let projectId: string;
  let betano: string;
  let bwin: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const api = (actor: Actor) => ({
    get: (path: string) =>
      request(ctx.server).get(`/api/projects/${projectId}${path}`).set('Cookie', cookies[actor]),
  });
  const sel = (
    eventGroup: number,
    position: number,
    event: string,
    market: string,
    selection: string,
    visibleOdds?: string,
  ) => ({
    eventGroup,
    position,
    sport: 'Fútbol',
    event,
    market,
    selection,
    ...(visibleOdds ? { visibleOdds } : {}),
  });
  const create = (body: object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/bets`)
      .set('Cookie', cookies.owner)
      .send(body)
      .expect(201);

  beforeEach(async () => {
    await ctx.reset();
    ctx.clock.set('2026-06-20T12:00:00.000Z');
    people.owner = await ctx.createUser({
      email: 'owner@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
    });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Bets Ñandú' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({
        unitStake: '10.00',
        houses: [
          { name: 'Betano', initialAmount: '500.00' },
          { name: 'Bwin', initialAmount: '300.00' },
        ],
      })
      .expect(201);
    const houses = (await api('owner').get('/houses').expect(200)).body as {
      id: string;
      name: string;
    }[];
    betano = houses.find((h) => h.name === 'Betano')!.id;
    bwin = houses.find((h) => h.name === 'Bwin')!.id;

    const settle = (status: string, day: number, officialRealizedReturn?: string) => ({
      status,
      settledAt: `2026-06-${String(day).padStart(2, '0')}T22:00:00.000Z`,
      ...(officialRealizedReturn ? { officialRealizedReturn } : {}),
    });
    const simple = (
      houseId: string,
      day: number,
      odds: string,
      event: string,
      settlement?: object,
    ) => ({
      houseId,
      stake: '2',
      visibleTotalOdds: odds,
      totalOddsSource: 'OFFICIAL',
      placedAt: `2026-06-${String(day).padStart(2, '0')}T18:00:00.000Z`,
      selections: [sel(0, 0, event, '1X2', 'Local', odds)],
      ...(settlement ? { settlement } : {}),
    });
    await create(simple(betano, 2, '1.95', 'Real Madrid vs Villarreal', settle('WON', 2, '39.00')));
    await create(simple(bwin, 3, '2.10', 'Perú vs Uruguay', settle('LOST', 3)));
    await create(simple(betano, 4, '1.50', 'Colombia vs Chile', settle('VOID', 4, '20.00')));
    await create(simple(betano, 5, '2.00', 'Brasil vs Perú', settle('CASHOUT', 5, '15.00')));
    await create(simple(betano, 15, '1.80', 'Ecuador vs Paraguay')); // pendiente
    // Creada de un evento: 3 condiciones, una sola cuota (la del leg).
    await create({
      houseId: betano,
      stake: '1',
      visibleTotalOdds: '3.40',
      totalOddsSource: 'OFFICIAL',
      placedAt: '2026-06-06T18:00:00.000Z',
      selections: [
        sel(0, 0, 'Alianza Lima vs Sporting Cristal', 'Resultado', 'Alianza Lima', '3.40'),
        sel(0, 1, 'Alianza Lima vs Sporting Cristal', 'Ambos anotan', 'Sí'),
        sel(0, 2, 'Alianza Lima vs Sporting Cristal', 'Tarjetas', 'Más de 4.5'),
      ],
      settlement: settle('WON', 6, '34.00'),
    });
    // Múltiple de 4 del caso guía: el leg 2 es una Creada (2 condiciones, cuota 2.47).
    await create({
      houseId: betano,
      stake: '1',
      visibleTotalOdds: '8.42',
      totalOddsSource: 'CALCULATED',
      placedAt: '2026-06-07T18:00:00.000Z',
      selections: [
        sel(0, 0, 'Universitario de Deportes - FBC Melgar', 'Doble oportunidad', '1X', '2.15'),
        sel(
          1,
          0,
          'Liverpool FC - Manchester City',
          'Resultado del partido',
          'Manchester City',
          '2.47',
        ),
        sel(1, 1, 'Liverpool FC - Manchester City', 'Córners', 'Más de 2.5'),
        sel(2, 0, 'SL Benfica - Vitória Guimarães', 'Resultado del partido', 'SL Benfica', '1.21'),
        sel(3, 0, 'Inter Miami CF - D.C. United', 'Goles totales', 'Más de 4.5', '1.31'),
      ],
      settlement: settle('LOST', 7),
    });
  });

  const data = async (query = '') =>
    (await api('owner').get(`/reports/data${query}`).expect(200)).body as ReportData;

  it('el resumen y las apuestas salen del mismo alcance: conteos, monto, ganancia y totales cuadran', async () => {
    const report = await data();
    const { analysis, totals, bets } = report;
    // Una apuesta registrada = una apuesta (la Múltiple de 4 legs y la Creada cuentan una vez).
    expect(bets).toHaveLength(7);
    expect(totals.bets).toBe(analysis.counts.total);
    expect(analysis.counts).toMatchObject({
      total: 7,
      won: 2,
      lost: 2,
      pending: 1,
      void: 1,
      cashout: 1,
    });
    // La ganancia de la tabla (del ledger) suma exactamente la del análisis.
    expect(sumMoney(bets.flatMap((b) => (b.profitLoss === null ? [] : [b.profitLoss])))).toBe(
      analysis.profitLoss,
    );
    expect(totals.profitLoss).toBe(analysis.profitLoss);
    expect(totals.stakedSettled).toBe(analysis.totalStaked);
    // Pendiente: sin ganancia, su monto va aparte (comprometido).
    const pending = bets.find((b) => b.status === 'PENDING')!;
    expect(pending.profitLoss).toBeNull();
    expect(totals.stakedPending).toBe(pending.amount);
    // Retornos realizados = monto apostado de las liquidadas + ganancia neta.
    expect(totals.returns).toBe(sumMoney([analysis.totalStaked, analysis.profitLoss]));
    // Win rate: 2 ganadas de 4 decididas (anulada y Cash Out no cuentan).
    expect(analysis.winRate).toBe('50.00');
    // Curva acumulada: termina en la ganancia neta.
    expect(report.cumulative.at(-1)!.cumulative).toBe(analysis.profitLoss);
    // Informe ejecutivo: liquidadas, promedio por apuesta, tipos y extremos del mismo alcance.
    const settled = bets.filter((b) => b.profitLoss !== null);
    expect(totals.settledBets).toBe(settled.length);
    expect(totals.settledBets).toBe(analysis.counts.total - analysis.counts.pending);
    expect(totals.averageStakeSettled).toBe(averageMoney(totals.stakedSettled, totals.settledBets));
    expect(sumMoney(report.byBetType.map((r) => r.totalStaked))).toBe(analysis.totalStaked);
    expect(sumMoney(report.byBetType.map((r) => r.profitLoss))).toBe(analysis.profitLoss);
    expect(report.byBetType.reduce((n, r) => n + r.settledBets, 0)).toBe(totals.settledBets);
    const byProfit = [...settled].sort((a, b) => compareMoney(a.profitLoss!, b.profitLoss!));
    expect(report.highlights.best).toMatchObject({
      betId: byProfit.at(-1)!.id,
      profitLoss: byProfit.at(-1)!.profitLoss,
    });
    expect(report.highlights.worst).toMatchObject({
      betId: byProfit[0]!.id,
      profitLoss: byProfit[0]!.profitLoss,
    });
  });

  it('estructuras: Creada con 3 condiciones y Múltiple con Creada interna (4 legs, 5 condiciones, 2.47 una vez)', async () => {
    const { bets } = await data();
    const created = bets.find((b) => b.betType === 'CREATED')!;
    expect(created.legs).toHaveLength(1);
    expect(created.legs[0]!.conditions).toHaveLength(3);
    expect(created.legs[0]!.odds).toBe('3.400000');
    const multiple = bets.find((b) => b.betType === 'MULTIPLE')!;
    expect(multiple.legs).toHaveLength(4);
    expect(multiple.legs.flatMap((l) => l.conditions)).toHaveLength(5);
    expect(multiple.legs.map((l) => l.odds)).toEqual([
      '2.150000',
      '2.470000',
      '1.210000',
      '1.310000',
    ]);
    expect(multiple.legs[1]!.conditions).toHaveLength(2);
    // Cuota total calculada: identificada como tal, nunca como oficial.
    expect(multiple.totalOddsSource).toBe('CALCULATED');
  });

  it('filtros: casa, resultado, fechas, tipo y origen; los conteos siguen al filtro', async () => {
    const onlyBwin = await data(`?houseId=${bwin}`);
    expect(onlyBwin.bets.map((b) => b.houseName)).toEqual(['Bwin']);
    expect(onlyBwin.analysis.counts.total).toBe(1);

    const lost = await data('?status=LOST');
    expect(lost.bets.every((b) => b.status === 'LOST')).toBe(true);
    expect(lost.totals.bets).toBe(2);

    // Rango del 3 al 5 de junio (por fecha de liquidación; la pendiente, por colocación el 15).
    const from = encodeURIComponent('2026-06-03T00:00:00.000Z');
    const to = encodeURIComponent('2026-06-05T23:59:59.999Z');
    const ranged = await data(`?from=${from}&to=${to}`);
    expect(ranged.bets.map((b) => b.status).sort()).toEqual(['CASHOUT', 'LOST', 'VOID']);
    expect(ranged.analysis.counts.total).toBe(3);

    expect((await data('?betType=MULTIPLE')).bets).toHaveLength(1);
    expect((await data('?origin=MANUAL')).bets).toHaveLength(7);
    expect((await data('?origin=IMPORTED')).bets).toHaveLength(0);

    // Resumen por tipo: las mismas métricas que el análisis filtrado por ese tipo.
    const all = await data();
    const multipleAnalysis = (
      await api('owner').get('/dashboard/analysis?betType=MULTIPLE').expect(200)
    ).body as {
      roi: string | null;
      yield: string | null;
    };
    const row = all.byBetType.find((r) => r.betType === 'MULTIPLE')!;
    expect(row).toMatchObject({
      bets: 1,
      roi: multipleAnalysis.roi,
      yield: multipleAnalysis.yield,
    });
  });

  it('el PDF es válido, se descarga con un nombre saneado y no toca el ledger ni las apuestas', async () => {
    const movementsBefore = (await ctx.t.db.select({ n: count() }).from(financialMovements))[0]!.n;
    const betsBefore = (await ctx.t.db.select({ n: count() }).from(betsTable))[0]!.n;
    const from = encodeURIComponent('2026-06-01T05:00:00.000Z');
    const to = encodeURIComponent('2026-07-01T04:59:59.999Z');
    const res = await api('owner')
      .get(
        `/reports/pdf?from=${from}&to=${to}&sections=summary,charts,metrics,segments,operations,table,selections&groupBy=house&orientation=landscape`,
      )
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="LetFer_Reporte_Bets_Nandu_2026-06-01_2026-06-30.pdf"',
    );
    expect(res.headers['cache-control']).toContain('no-store');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);

    // Generar un reporte es una LECTURA: ni movimientos ni apuestas nuevas.
    expect((await ctx.t.db.select({ n: count() }).from(financialMovements))[0]!.n).toBe(
      movementsBefore,
    );
    expect((await ctx.t.db.select({ n: count() }).from(betsTable))[0]!.n).toBe(betsBefore);
    await assertFinancialInvariant(ctx, { projectId, cookie: cookies.owner });
  });

  it('un periodo sin apuestas genera un PDF válido; opciones inválidas responden 400', async () => {
    const from = encodeURIComponent('2030-01-01T00:00:00.000Z');
    const res = await api('owner')
      .get(`/reports/pdf?from=${from}`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await api('owner').get('/reports/pdf?sections=summary,inventada').expect(400);
    await api('owner').get('/reports/pdf?orientation=diagonal').expect(400);
    await api('owner').get('/reports/data?status=GANADA').expect(400);
  });

  it('permisos: un Lector del proyecto puede; un ajeno recibe 404; sin sesión, 401', async () => {
    await api('reader').get('/reports/data').expect(200);
    await api('reader').get('/reports/pdf').expect(200);
    await api('stranger').get('/reports/data').expect(404);
    await api('stranger').get('/reports/pdf').expect(404);
    await request(ctx.server).get(`/api/projects/${projectId}/reports/pdf`).expect(401);
  });
});
