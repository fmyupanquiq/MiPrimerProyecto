import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  addMoney,
  percentageOf,
  subtractMoney,
  sumMoney,
  ZERO_MONEY,
  type BetStatus,
  type BetType,
  type DashboardBreakdownItem,
  type ReportBet,
  type ReportData,
} from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { buildInsights } from './pdf/insights.js';
import { renderReportPdf, type ReportPdfInput } from './report-pdf.js';
import { highlightsOf } from './reports.service.js';

/*
 * Informe ejecutivo con datos SINTÉTICOS y COHERENTES: los totales, segmentos, conteos y la curva se
 * derivan de las propias apuestas generadas (aquí, en la prueba; en producción los da el análisis).
 * Con `fonts: 'standard'` y sin compresión el texto se puede inspeccionar. Con
 * `REPORT_PDF_OUT=<carpeta>` guarda los PDF (Inter, comprimidos) para la QA visual.
 */

let counter = 0;
type LegSpec = {
  event: string;
  sport: string | null;
  odds: string | null;
  conditions: [string | null, string][];
};
const leg = (
  event: string,
  odds: string | null,
  conditions: [string | null, string][],
  sport: string | null = 'Fútbol',
): LegSpec => ({ event, sport, odds, conditions });

function bet(o: Partial<ReportBet> & { legSpecs?: LegSpec[] } = {}): ReportBet {
  counter++;
  const { legSpecs, ...rest } = o;
  return {
    id: `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    placedAt: new Date(Date.UTC(2026, 9, 1, 18) + counter * 3_600_000 * 6).toISOString(),
    placedTimeKnown: true,
    settledAt: null,
    houseName: 'Betano',
    stageName: 'Etapa 1',
    betType: 'SIMPLE',
    status: 'WON',
    origin: 'MANUAL',
    stake: '1.0000',
    amount: '25.00',
    visibleTotalOdds: '1.850000',
    totalOddsSource: 'OFFICIAL',
    profitLoss: '21.25',
    provisional: false,
    ticketCount: 0,
    ...rest,
    legs: (
      legSpecs ?? [leg('Real Madrid vs Villarreal', '1.850000', [['1X2', 'Real Madrid']])]
    ).map((l) => ({
      event: l.event,
      sport: l.sport,
      odds: l.odds,
      conditions: l.conditions.map(([market, selection]) => ({ market, selection })),
    })),
  };
}

/** La Múltiple de 4 del caso guía: el leg 2 es una Creada con dos condiciones y cuota 2.47. */
const multipleWithCreated = (status: BetStatus = 'LOST') =>
  bet({
    betType: 'MULTIPLE',
    status,
    amount: '10.00',
    profitLoss: status === 'LOST' ? '-10.00' : status === 'WON' ? '74.20' : null,
    visibleTotalOdds: '8.420000',
    totalOddsSource: 'CALCULATED',
    legSpecs: [
      leg('Universitario de Deportes - FBC Melgar', '2.150000', [['Doble oportunidad', '1X']]),
      leg('Liverpool FC - Manchester City', '2.470000', [
        ['Resultado del partido', 'Manchester City'],
        ['Manchester City Más/Menos Córners', 'Más de 2.5'],
      ]),
      leg('SL Benfica - Vitória Guimarães', '1.210000', [['Resultado del partido', 'SL Benfica']]),
      leg('Inter Miami CF - D.C. United', '1.310000', [['Goles totales Más/Menos', 'Más de 4.5']]),
    ],
  });

const keyOfSport = (b: ReportBet) => {
  const sports = new Set(b.legs.map((l) => l.sport ?? 'Sin especificar'));
  return sports.size === 1 ? [...sports][0]! : 'Mixto';
};

function breakdown(settled: ReportBet[], key: (b: ReportBet) => string): DashboardBreakdownItem[] {
  const groups = new Map<string, ReportBet[]>();
  for (const b of settled) groups.set(key(b), [...(groups.get(key(b)) ?? []), b]);
  return [...groups.entries()]
    .map(([k, list]) => {
      const staked = sumMoney(list.map((b) => b.amount));
      const pl = sumMoney(list.map((b) => b.profitLoss!));
      return {
        key: k,
        count: list.length,
        totalStaked: staked,
        profitLoss: pl,
        yield: percentageOf(pl, staked),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** `ReportData` coherente a partir de las apuestas (cálculo de PRUEBA, no del producto). */
function data(bets: ReportBet[], capitalInvested = '1000.00'): ReportData {
  const settled = bets
    .filter((b) => b.status !== 'PENDING')
    .map((b, i) => ({
      ...b,
      settledAt:
        b.settledAt ?? new Date(new Date(b.placedAt).getTime() + 3 * 3_600_000 + i).toISOString(),
    }));
  const count = (s: BetStatus) => bets.filter((b) => b.status === s).length;
  const won = count('WON');
  const lost = count('LOST');
  const totalStaked = sumMoney(settled.map((b) => b.amount));
  const profitLoss = sumMoney(settled.map((b) => b.profitLoss!));
  const odds = settled.map((b) => Number(b.visibleTotalOdds));
  let running = ZERO_MONEY;
  const cumulative = [...settled]
    .sort((a, b) => a.settledAt.localeCompare(b.settledAt))
    .map((b, i) => {
      running = addMoney(running, b.profitLoss!);
      return { index: i + 1, settledAt: b.settledAt, cumulative: running };
    });
  const types: BetType[] = ['SIMPLE', 'CREATED', 'MULTIPLE'];
  const pending = bets.filter((b) => b.status === 'PENDING');
  return {
    generatedAt: '2026-10-16T15:24:00.000Z',
    analysis: {
      profitLoss,
      yield: percentageOf(profitLoss, totalStaked),
      roi: percentageOf(profitLoss, capitalInvested),
      totalStaked,
      winRate: won + lost > 0 ? percentageOf(String(won), String(won + lost)) : null,
      averageOdds: odds.length ? (odds.reduce((a, b) => a + b, 0) / odds.length).toFixed(6) : null,
      unconfirmedReturns: { count: 0, profitLoss: ZERO_MONEY },
      capitalInvested,
      deposits: ZERO_MONEY,
      withdrawals: ZERO_MONEY,
      extraordinary: ZERO_MONEY,
      counts: {
        total: bets.length,
        won,
        lost,
        pending: pending.length,
        void: count('VOID'),
        cashout: count('CASHOUT'),
      },
      byHouse: breakdown(settled, (b) => b.houseName),
      byStage: [],
      bySport: breakdown(settled, keyOfSport),
      byMarket: [],
      byPeriod: breakdown(settled, (b) => b.settledAt!.slice(0, 7)),
    },
    totals: {
      bets: bets.length,
      settledBets: settled.length,
      averageStakeSettled: settled.length
        ? (Number(totalStaked) / settled.length).toFixed(2)
        : null,
      stakedSettled: totalStaked,
      stakedPending: sumMoney(pending.map((b) => b.amount)),
      returns: addMoney(totalStaked, profitLoss),
      profitLoss,
    },
    byBetType: types
      .map((betType) => {
        const all = bets.filter((b) => b.betType === betType);
        const s = settled.filter((b) => b.betType === betType);
        const staked = sumMoney(s.map((b) => b.amount));
        const pl = sumMoney(s.map((b) => b.profitLoss!));
        const w = s.filter((b) => b.status === 'WON').length;
        const l = s.filter((b) => b.status === 'LOST').length;
        return {
          betType,
          bets: all.length,
          settledBets: s.length,
          totalStaked: staked,
          profitLoss: pl,
          winRate: w + l > 0 ? percentageOf(String(w), String(w + l)) : null,
          roi: percentageOf(pl, capitalInvested),
          yield: percentageOf(pl, staked),
        };
      })
      .filter((r) => r.bets > 0),
    cumulative,
    highlights: highlightsOf(settled),
    bets: bets.map((b) => settled.find((s) => s.id === b.id) ?? b),
  };
}

const input = (
  bets: ReportBet[],
  extra: Partial<ReportPdfInput> = {},
  capital?: string,
): ReportPdfInput => ({
  data: data(bets, capital),
  projectName: 'Bets',
  currency: 'PEN',
  timeZone: 'America/Lima',
  generatedBy: 'Ana Pérez',
  filters: { from: '2026-10-01T05:00:00.000Z', to: '2026-11-01T04:59:59.999Z' },
  periodLabel: '01/10/2026 - 31/10/2026',
  sections: ['summary', 'charts', 'metrics', 'segments', 'operations', 'table', 'selections'],
  groupBy: 'none',
  sortBy: 'date',
  direction: 'asc',
  orientation: 'portrait',
  paper: 'A4',
  ticketImages: null,
  ticketsAllowed: true,
  compress: false,
  fonts: 'standard',
  ...extra,
});

const WIN_ANSI = new TextDecoder('windows-1252');
/** Texto aproximado del PDF sin comprimir y con fuentes estándar (WinAnsi). */
function textOf(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  return [...raw.matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map((m) =>
      [...m[1]!.matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((h) => WIN_ANSI.decode(Buffer.from(h[1]!, 'hex')))
        .join(''),
    )
    .join('\n');
}
const flat = (pdf: Buffer) => textOf(pdf).replace(/\n/g, ' ');
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const detailRanges = (text: string, total: number) =>
  [...text.matchAll(new RegExp(`Detalle de apuestas \\((\\d+) – (\\d+) de ${total}\\)`, 'g'))].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );

/** Guarda la versión «real» (Inter, comprimida) para la QA visual, si se pide. */
async function save(name: string, base: ReportPdfInput) {
  const out = process.env['REPORT_PDF_OUT'];
  if (!out) return;
  writeFileSync(
    path.join(out, name),
    await renderReportPdf({ ...base, fonts: 'inter', compress: true }),
  );
}

const HOUSES = ['Betano', 'Bet365', '1xBet', 'Te Apuesto', 'Doradobet'];
const SPORTS = ['Fútbol', 'Fútbol', 'Fútbol', 'Tenis', 'Básquet'];
/** `n` apuestas variadas; `bias` > 0 inclina hacia ganancias, < 0 hacia pérdidas. */
function many(n: number, bias = 0): ReportBet[] {
  const out: ReportBet[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 23 === 7) {
      out.push(multipleWithCreated(i % 2 ? 'LOST' : 'WON'));
      continue;
    }
    const roll = (i * 37 + 11) % 100;
    const status: BetStatus =
      roll < 8
        ? 'PENDING'
        : roll < 12
          ? 'VOID'
          : roll < 15
            ? 'CASHOUT'
            : roll < 55 + bias * 25
              ? 'WON'
              : 'LOST';
    const amount = ['25.00', '30.00', '40.00', '50.00', '20.00'][i % 5]!;
    const odds = ['1.85', '1.95', '2.10', '1.72', '2.40', '3.10'][i % 6]!;
    const profit =
      status === 'PENDING'
        ? null
        : status === 'WON'
          ? subtractMoney((Number(amount) * Number(odds)).toFixed(2), amount)
          : status === 'LOST'
            ? `-${amount}`
            : status === 'VOID'
              ? ZERO_MONEY
              : '5.00';
    const sport = SPORTS[i % 5]!;
    const created = i % 9 === 4;
    out.push(
      bet({
        status,
        amount,
        visibleTotalOdds: `${odds}0000`,
        profitLoss: profit,
        houseName: HOUSES[i % 5]!,
        betType: created ? 'CREATED' : 'SIMPLE',
        legSpecs: created
          ? [
              leg(
                `Alianza Lima vs Sporting Cristal ${i}`,
                `${odds}0000`,
                [
                  ['Resultado', 'Alianza Lima'],
                  ['Ambos anotan', 'Sí'],
                  ['Tarjetas', 'Más de 4.5'],
                ],
                sport,
              ),
            ]
          : [
              leg(
                i % 17 === 0
                  ? 'Club Atlético Independiente de Avellaneda vs Club Atlético Boca Juniors (Copa Sudamericana)'
                  : `Equipo ${i + 1} vs Rival ${i + 1}`,
                `${odds}0000`,
                [
                  [
                    i % 13 === 0
                      ? 'Total de goles asiático en el segundo tiempo (incluye prórroga)'
                      : 'Más/Menos goles',
                    'Más de 2.5',
                  ],
                ],
                sport,
              ),
            ],
      }),
    );
  }
  return out;
}

describe('informe ejecutivo PDF (§108.11)', () => {
  it('100 apuestas: PDF válido, portada, cinco bloques, TODAS las apuestas y paginación real', async () => {
    const base = input(many(100, 1));
    await save('ejecutivo-100-ganancias.pdf', base);
    const pdf = await renderReportPdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = flat(pdf);
    for (const t of [
      'Reporte ejecutivo de rendimiento',
      'Resumen financiero y operativo de 100 apuestas',
      'Tus apuestas, un número más.',
      'Periodo rentable',
      'Lectura rápida',
      'Análisis financiero y estadístico',
      'Evolución de la ganancia neta',
      'Indicadores interpretados',
      'Análisis por segmentos',
      'Rendimiento por casa de apuestas',
      'Rendimiento por tipo de apuesta',
      'Rendimiento por deporte',
      'Control operativo / Gestión del negocio',
      'Riesgos y observaciones',
      'Mayor ganancia',
      'Mayor pérdida',
      'Totales del periodo',
    ]) {
      expect(text, t).toContain(t);
    }
    // Todas las apuestas, de 1 a 100 sin huecos entre páginas.
    const ranges = detailRanges(text, 100);
    expect(ranges[0]![0]).toBe(1);
    expect(ranges.at(-1)![1]).toBe(100);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1);
    const pages = pageCount(pdf);
    for (let p = 1; p <= pages; p++) expect(text).toContain(`Pág. ${p} de ${pages}`);
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('ROI y Yield con dos decimales y signo; Yield por segmento y ROI global explicados', async () => {
    const base = input(many(30, 1), { sections: ['summary', 'metrics', 'segments'] });
    const { roi, yield: y, capitalInvested } = base.data.analysis;
    const text = flat(await renderReportPdf(base));
    expect(roi).toMatch(/^\d+\.\d{2}$/);
    expect(text).toContain(`+${roi} %`);
    expect(text).toContain(`+${y} %`);
    expect(text).toContain(`Se generó una ganancia neta de`);
    expect(text).toContain(`con un Yield de +${y} % y un ROI de +${roi} %`);
    expect(text.replace(/\s+/g, ' ')).toContain(
      `El ROI es un indicador global: +${roi} % en el periodo (ganancia neta ÷ capital invertido de S/ ${Number(capitalInvested).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
    );
    for (const row of base.data.analysis.byHouse)
      expect(text).toContain(`${row.yield!.startsWith('-') ? '' : '+'}${row.yield} %`);
    // Ningún ROI ni Yield con un solo decimal.
    expect(text).not.toMatch(/(ROI|Yield) de [+-]?\d+\.\d %/);
  });

  it('periodo con pérdidas: conclusión «Periodo con pérdidas» y nunca «rentable»', async () => {
    const base = input(many(40, -1.2));
    await save('ejecutivo-40-perdidas.pdf', base);
    const text = flat(await renderReportPdf(base));
    expect(base.data.analysis.profitLoss.startsWith('-')).toBe(true);
    expect(text).toContain('Periodo con pérdidas');
    expect(text).not.toContain('Periodo rentable');
  });

  it('sin apuestas: documento válido, «Resultado no determinado», sin NaN ni curvas inventadas', async () => {
    const base = input([]);
    await save('ejecutivo-0-apuestas.pdf', base);
    const text = flat(await renderReportPdf(base));
    expect(text).toContain('Resultado no determinado');
    expect(text).toContain('No hay apuestas en este periodo con los filtros aplicados.');
    expect(text).toContain('Aún no hay apuestas liquidadas');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('solo pendientes: distingue lo comprometido y no declara ganancia ni pérdida', async () => {
    const base = input([
      bet({ status: 'PENDING', profitLoss: null }),
      bet({ status: 'PENDING', profitLoss: null, amount: '40.00' }),
    ]);
    await save('ejecutivo-pendientes.pdf', base);
    const text = flat(await renderReportPdf(base));
    expect(text).toContain('Resultado no determinado');
    expect(text).toContain('S/ 65.00 siguen comprometidos en 2 apuestas pendientes');
    expect(text).toContain('Comprometido');
  });

  it('Múltiple con Creada interna: una sola apuesta, 4 legs, 5 condiciones y la cuota 2.47 una vez', async () => {
    const raw = textOf(await renderReportPdf(input([multipleWithCreated()])));
    expect(raw.match(/^2\.47$/gm)).toHaveLength(1);
    const text = raw.replace(/\n/g, ' ');
    for (const e of [
      '1. Universitario de Deportes - FBC Melgar',
      '2. Liverpool FC - Manchester City',
      '3. SL Benfica - Vitória Guimarães',
      '4. Inter Miami CF - D.C. United',
    ]) {
      expect(text).toContain(e);
    }
    expect(text.replace(/\s+/g, ' ')).toContain('Más de 2.5 (Manchester City Más/Menos Córners)');
    expect(text).toContain('Detalle de apuestas (1 – 1 de 1)');
    expect(text).toContain('Múltiple de 4 selecciones');
    expect(text).toContain('calc.');
  });

  it('las observaciones salen de reglas: concentración, exposición y muestra limitada', () => {
    const insights = buildInsights(
      data([
        bet({ houseName: 'Betano', amount: '80.00', profitLoss: '20.00' }),
        bet({ houseName: 'Betano', amount: '60.00', profitLoss: '-60.00', status: 'LOST' }),
        bet({ houseName: 'Bwin', amount: '10.00', profitLoss: '-10.00', status: 'LOST' }),
        bet({ status: 'PENDING', profitLoss: null, amount: '30.00' }),
      ]),
    );
    expect(insights.risks.some((r) => r.includes('Betano reúne el 93.3 %'))).toBe(true);
    expect(
      insights.risks.some((r) => r.includes('S/ 30.00 comprometidos en 1 apuesta pendiente')),
    ).toBe(true);
    expect(insights.risks.some((r) => r.startsWith('Muestra limitada'))).toBe(true);
    expect(insights.conclusion.state).toBe('loss');
    expect(insights.quick).toHaveLength(3);
    // Nunca recomiendan ni predicen.
    for (const r of [...insights.risks, ...insights.quick]) {
      expect(r).not.toMatch(/recomienda|deberías|seguirá|garantiza/i);
    }
    const even = buildInsights(data([bet({ status: 'VOID', profitLoss: '0.00' })]));
    expect(even.conclusion.state).toBe('even');
    expect(buildInsights(data(many(30, 1))).conclusion.state).toBe('profit');
  });

  it('500 apuestas, apaisado y carta: paginación completa (de 1 a 500)', async () => {
    const base = input(many(500), {
      orientation: 'landscape',
      paper: 'LETTER',
      sections: ['summary', 'table'],
    });
    await save('ejecutivo-500-apaisado.pdf', base);
    const pdf = await renderReportPdf(base);
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 792 612]');
    const ranges = detailRanges(flat(pdf), 500);
    expect(ranges[0]![0]).toBe(1);
    expect(ranges.at(-1)![1]).toBe(500);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1);
  });

  it('una apuesta con muchos legs, más larga que una página, continúa con «(continuación)»', async () => {
    const legs = Array.from({ length: 40 }, (_, i) =>
      leg(`Partido número ${i + 1} con un nombre bastante largo para ocupar espacio`, '1.100000', [
        ['Resultado', `Local ${i + 1}`],
        ['Ambos anotan', 'Sí'],
      ]),
    );
    const base = input(
      [
        bet({
          betType: 'MULTIPLE',
          legSpecs: legs,
          visibleTotalOdds: '45.000000',
          profitLoss: '-25.00',
          status: 'LOST',
        }),
      ],
      { sections: ['table', 'selections'] },
    );
    await save('ejecutivo-multiple-40-legs.pdf', base);
    const text = flat(await renderReportPdf(base));
    expect(text).toContain('N.º 1 (continuación)');
    expect(text).toContain('40. Partido número 40');
  });

  it('muchas categorías: «Otros» agrupa el resto y la fila Total no cambia', async () => {
    const bets = Array.from({ length: 24 }, (_, i) =>
      bet({
        houseName: `Casa número ${i + 1} con nombre largo`,
        amount: `${10 + i}.00`,
        profitLoss: i % 3 === 0 ? `-${10 + i}.00` : '5.50',
        status: i % 3 === 0 ? 'LOST' : 'WON',
        legSpecs: [
          leg(
            `Partido ${i}`,
            '1.500000',
            [['1X2', 'Local']],
            [
              'Fútbol',
              'Tenis',
              'Vóley',
              'Golf',
              'Rugby',
              'Críquet',
              'Hockey',
              'Boxeo',
              'MMA',
              'Dardos',
            ][i % 10],
          ),
        ],
      }),
    );
    const base = input(bets, { sections: ['segments'] });
    await save('ejecutivo-muchas-categorias.pdf', base);
    const text = flat(await renderReportPdf(base));
    expect(text).toContain('Otros (17)');
    expect(text).toContain('Otros (3)');
    const total = base.data.totals.profitLoss;
    expect(text).toContain(`${total.startsWith('-') ? '-' : '+'}S/ ${total.replace('-', '')}`);
  });

  it('agrupado por casa y solo las secciones pedidas; tickets sin permiso lo explica', async () => {
    const grouped = flat(
      await renderReportPdf(input(many(30), { groupBy: 'house', sections: ['table'] })),
    );
    expect(grouped).toMatch(/Betano — \d+ apuestas/);
    expect(grouped).not.toContain('Análisis por segmentos');
    const tickets = flat(
      await renderReportPdf(
        input([bet()], { sections: ['summary', 'tickets'], ticketsAllowed: false }),
      ),
    );
    expect(tickets).toContain('Tu rol no permite ver los tickets');
    expect(tickets).not.toContain('Detalle de apuestas');
  });

  it('las cifras no dependen de la orientación ni del papel', async () => {
    const bets = many(25);
    const a = flat(
      await renderReportPdf(input(bets, { sections: ['summary', 'segments', 'operations'] })),
    );
    const b = flat(
      await renderReportPdf(
        input(bets, {
          sections: ['summary', 'segments', 'operations'],
          orientation: 'landscape',
          paper: 'LETTER',
        }),
      ),
    );
    // Cifras monetarias y porcentajes con signo (la franja «Composición» de la portada solo aparece
    // si cabe, y sus porcentajes de conteo no llevan signo).
    const figures = (t: string) => (t.match(/[+-]?S\/ [\d,]+\.\d{2}|[+-]\d+\.\d %/g) ?? []).sort();
    expect(figures(a).length).toBeGreaterThan(10);
    expect(figures(a)).toEqual(figures(b));
  });

  it('incrusta Inter (texto seleccionable, sin descargar fuentes) y las imágenes de tickets', async () => {
    const PNG_1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const withTicket = bet({ ticketCount: 1 });
    const pdf = await renderReportPdf(
      input([withTicket], {
        fonts: 'inter',
        sections: ['summary', 'tickets'],
        ticketImages: [{ betId: withTicket.id, buffer: PNG_1x1 }],
      }),
    );
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/FontFile2|\/FontFile3/);
    expect(raw).toContain('/ToUnicode');
    expect(raw).toContain('/Subtype /Image');
  });
});
