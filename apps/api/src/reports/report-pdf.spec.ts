import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReportBet, ReportData } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { renderReportPdf, type ReportPdfInput } from './report-pdf.js';

/*
 * Plantilla del PDF con datos SINTÉTICOS. Se genera sin compresión para poder leer el texto. Con
 * `REPORT_PDF_OUT=<carpeta>` además guarda los PDF (solo para la QA visual local).
 */

let counter = 0;
const leg = (event: string, odds: string | null, conditions: [string | null, string][]) => ({
  event,
  sport: 'Fútbol',
  odds,
  conditions: conditions.map(([market, selection]) => ({ market, selection })),
});

function bet(overrides: Partial<ReportBet> = {}): ReportBet {
  counter++;
  return {
    id: `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    placedAt: new Date(Date.UTC(2026, 9, 1, 20, 0) + counter * 3_600_000 * 7).toISOString(),
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
    legs: [leg('Real Madrid vs Villarreal', '1.850000', [['1X2', 'Real Madrid']])],
    ticketCount: 0,
    ...overrides,
  };
}

/** La Múltiple de 4 del caso guía: el leg 2 es una Creada con dos condiciones y cuota 2.47. */
const multipleWithCreated = () =>
  bet({
    betType: 'MULTIPLE',
    status: 'LOST',
    amount: '10.00',
    profitLoss: '-10.00',
    visibleTotalOdds: '8.420000',
    totalOddsSource: 'CALCULATED',
    legs: [
      leg('Universitario de Deportes - FBC Melgar', '2.150000', [['Doble oportunidad', '1X']]),
      leg('Liverpool FC - Manchester City', '2.470000', [
        ['Resultado del partido', 'Manchester City'],
        ['Manchester City Más/Menos Córners', 'Más de 2.5'],
      ]),
      leg('SL Benfica - Vitória Guimarães', '1.210000', [['Resultado del partido', 'SL Benfica']]),
      leg('Inter Miami CF - D.C. United', '1.310000', [['Goles totales Más/Menos', 'Más de 4.5']]),
    ],
  });

function data(bets: ReportBet[]): ReportData {
  const settled = bets.filter((b) => b.status !== 'PENDING');
  const won = bets.filter((b) => b.status === 'WON').length;
  const lost = bets.filter((b) => b.status === 'LOST').length;
  // Cifras fijas de ejemplo (en producción llegan del análisis; aquí no se prueba el cálculo).
  return {
    generatedAt: '2026-10-15T15:24:00.000Z',
    analysis: {
      profitLoss: '-104.56',
      yield: '-14.13',
      roi: '-10.46',
      totalStaked: '740.00',
      winRate: won + lost > 0 ? '37.00' : null,
      averageOdds: settled.length > 0 ? '1.920000' : null,
      unconfirmedReturns: { count: 0, profitLoss: '0.00' },
      capitalInvested: '1000.00',
      deposits: '0.00',
      withdrawals: '0.00',
      extraordinary: '0.00',
      counts: {
        total: bets.length,
        won,
        lost,
        pending: bets.filter((b) => b.status === 'PENDING').length,
        void: bets.filter((b) => b.status === 'VOID').length,
        cashout: bets.filter((b) => b.status === 'CASHOUT').length,
      },
      byHouse: [
        { key: 'Betano', profitLoss: '-40.00', yield: '-10.00', totalStaked: '285.00', count: 32 },
        { key: '1xBet', profitLoss: '10.00', yield: '5.00', totalStaked: '148.00', count: 18 },
      ],
      byStage: [],
      bySport: [],
      byMarket: [],
      byPeriod: [],
    },
    totals: {
      bets: bets.length,
      stakedSettled: '740.00',
      stakedPending: '50.00',
      returns: '635.44',
      profitLoss: '-104.56',
    },
    byBetType: [
      { betType: 'SIMPLE', bets: 68, winRate: '38.20', roi: '-12.40', yield: '-9.10' },
      { betType: 'MULTIPLE', bets: 18, winRate: '33.30', roi: '-18.60', yield: '-15.20' },
    ],
    cumulative: settled.map((_, i) => ({
      index: i + 1,
      settledAt: '2026-10-02T00:00:00.000Z',
      cumulative: (Math.sin(i / 6) * 60 - i * 1.1).toFixed(2),
    })),
    bets,
  };
}

const input = (bets: ReportBet[], extra: Partial<ReportPdfInput> = {}): ReportPdfInput => ({
  data: data(bets),
  projectName: 'Bets',
  currency: 'PEN',
  timeZone: 'America/Lima',
  generatedBy: 'Ana Pérez',
  filters: { from: '2026-10-01T05:00:00.000Z', to: '2026-11-01T04:59:59.999Z' },
  periodLabel: '01/10/2026 - 31/10/2026',
  sections: ['summary', 'metrics', 'table', 'selections', 'charts'],
  groupBy: 'none',
  sortBy: 'date',
  direction: 'asc',
  orientation: 'portrait',
  paper: 'A4',
  ticketImages: null,
  ticketsAllowed: true,
  compress: false,
  ...extra,
});

const WIN_ANSI = new TextDecoder('windows-1252');

/** Texto aproximado del PDF sin comprimir: las cadenas hex de los operadores de texto (WinAnsi). */
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
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

function save(name: string, pdf: Buffer) {
  const out = process.env['REPORT_PDF_OUT'];
  if (out) writeFileSync(path.join(out, name), pdf);
}

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    i % 17 === 5
      ? multipleWithCreated()
      : bet({
          status: (['WON', 'LOST', 'LOST', 'PENDING', 'VOID', 'CASHOUT', 'WON'] as const)[i % 7],
          profitLoss: i % 7 === 3 ? null : i % 7 === 1 || i % 7 === 2 ? '-25.00' : '21.25',
          houseName: ['Betano', '1xBet', 'Te Apuesto', 'Bet365'][i % 4]!,
          legs: [
            leg(
              i % 11 === 0
                ? 'Club Atlético Independiente de Avellaneda vs Club Atlético Boca Juniors (Copa Sudamericana)'
                : `Equipo ${i + 1} vs Rival ${i + 1}`,
              '1.850000',
              [['Más/Menos goles', 'Más de 2.5']],
            ),
          ],
        }),
  );

describe('PDF del reporte (§108.11)', () => {
  it('es un PDF válido, con texto seleccionable y caracteres españoles', async () => {
    const pdf = await renderReportPdf(input([bet(), multipleWithCreated()]));
    save('reporte-2-apuestas.pdf', pdf);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    const text = textOf(pdf);
    for (const t of [
      'Reporte de apuestas',
      'Resumen general',
      'Análisis y estadísticas',
      'Página',
      'Múltiple',
      'S/ 740.00',
      '-S/ 104.56',
      'Ana Pérez',
    ]) {
      expect(text, t).toContain(t);
    }
  });

  it('Múltiple con Creada interna: un renglón, cuatro legs, cinco condiciones y la cuota 2.47 una sola vez', async () => {
    const pdf = await renderReportPdf(input([multipleWithCreated()]));
    const text = textOf(pdf);
    expect(text.match(/@ 2\.47/g)).toHaveLength(1);
    // Nombres completos (en varias líneas si hace falta), nunca recortados.
    const flat = text.replace(/\n/g, ' ');
    for (const e of [
      '1. Universitario de Deportes - FBC Melgar',
      '2. Liverpool FC - Manchester City',
      '3. SL Benfica - Vitória Guimarães',
      '4. Inter Miami CF - D.C. United',
    ]) {
      expect(flat).toContain(e);
    }
    expect(flat).toContain('Más de 2.5 (Manchester City Más/Menos Córners)');
    // Una apuesta: el detalle va de 1 a 1.
    expect(text).toContain('Detalle de apuestas (1 – 1 de 1)');
    // Cuota total calculada: rotulada como tal.
    expect(text).toContain('calc.');
  });

  it('sin apuestas: documento válido que lo dice, sin NaN ni undefined', async () => {
    const pdf = await renderReportPdf(input([]));
    save('reporte-0-apuestas.pdf', pdf);
    const text = textOf(pdf);
    expect(text).toContain('No hay apuestas en este periodo con los filtros aplicados.');
    expect(text).not.toMatch(/NaN|undefined/);
    expect(pageCount(pdf)).toBe(3);
  });

  it('100 apuestas: varias páginas numeradas, con cabecera de tabla en cada una y todas las filas', async () => {
    const bets = many(100);
    const pdf = await renderReportPdf(input(bets));
    save('reporte-100-apuestas.pdf', pdf);
    const text = textOf(pdf);
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(text).toContain(`Página ${pages} de ${pages}`);
    expect((text.match(/Pronóstico \/ Mercado/g) ?? []).length).toBeGreaterThanOrEqual(pages - 2);
    // Los rangos de cada página cubren de 1 a 100 sin huecos.
    const ranges = [...text.matchAll(/Detalle de apuestas \((\d+) – (\d+) de 100\)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(ranges[0]![0]).toBe(1);
    expect(ranges.at(-1)![1]).toBe(100);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1]! + 1);
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it('agrupado por casa, apaisado y en carta', async () => {
    const pdf = await renderReportPdf(
      input(many(30), { groupBy: 'house', orientation: 'landscape', paper: 'LETTER' }),
    );
    save('reporte-agrupado-apaisado.pdf', pdf);
    const text = textOf(pdf);
    expect(text).toMatch(/Betano — \d+ apuestas/);
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 792 612]');
  });

  it('solo las secciones pedidas; tickets sin permiso lo explica', async () => {
    const pdf = await renderReportPdf(
      input([bet()], { sections: ['summary', 'tickets'], ticketsAllowed: false }),
    );
    const text = textOf(pdf);
    expect(text).not.toContain('Análisis y estadísticas');
    expect(text).not.toContain('Detalle de apuestas');
    expect(text).toContain('Tu rol no permite ver los tickets');
  });
});

describe('PDF del reporte: tickets adjuntos', () => {
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('incrusta las imágenes JPEG/PNG y explica los tickets en PDF', async () => {
    const withTicket = bet({ ticketCount: 1 });
    const pdfTicket = bet({ ticketCount: 1 });
    const pdf = await renderReportPdf(
      input([withTicket, pdfTicket], {
        sections: ['tickets'],
        ticketImages: [
          { betId: withTicket.id, buffer: PNG_1x1 },
          { betId: pdfTicket.id, buffer: null },
        ],
      }),
    );
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Subtype /Image');
    expect(textOf(pdf)).toContain('Este ticket es un PDF: no se incrusta');
  });
});
