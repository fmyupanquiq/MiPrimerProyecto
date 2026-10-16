import { formatPEN, percentageOf, sumMoney } from '@letfer/shared';
import { C, F, TONE_COLOR } from './theme.js';
import { percent, signedPEN, toneOf, wrap } from './format.js';
import type { Frame } from './frame.js';
import { perfBar } from './charts.js';
import type { IconName } from './icons.js';
import { BET_TYPE_LABEL, type ReportPdfInput } from './input.js';

/*
 * Página 3 — Análisis por segmentos: casa, tipo de apuesta y deporte. Cifras de las apuestas
 * liquidadas, del análisis (§108): cada fila sale del desglose ya calculado y la fila «Total» es el
 * total del análisis. Se usa el Yield (ganancia ÷ monto apostado): el ROI usa el capital invertido del
 * proyecto, que no se reparte por segmento. Una apuesta con legs de varios deportes cuenta en
 * «Mixto» (D-M4): su ganancia nunca se reparte.
 */

export interface SegmentRow {
  key: string;
  count: number;
  staked: string;
  profit: string;
  yield: string | null;
}

/**
 * Con más de `max` filas, conserva las `max - 1` de mayor monto apostado y suma el resto en «Otros»
 * (sus sumas con las utilidades decimales compartidas; el Yield con la misma `percentageOf` del
 * análisis). Los totales no cambian: la fila «Total» sigue siendo la del análisis.
 */
export function withOthers(rows: SegmentRow[], max: number): SegmentRow[] {
  if (rows.length <= max) return rows;
  const byStake = [...rows].sort(
    (a, b) => Number(b.staked) - Number(a.staked) || a.key.localeCompare(b.key),
  );
  const kept = byStake.slice(0, max - 1);
  const rest = byStake.slice(max - 1);
  const staked = sumMoney(rest.map((r) => r.staked));
  const profit = sumMoney(rest.map((r) => r.profit));
  return [
    ...kept,
    {
      key: `Otros (${rest.length})`,
      count: rest.reduce((a, r) => a + r.count, 0),
      staked,
      profit,
      yield: percentageOf(profit, staked),
    },
  ];
}

export function segmentTable(
  f: Frame,
  title: string,
  icon: IconName,
  firstCol: string,
  rows: SegmentRow[],
  total: SegmentRow,
  note?: string,
): void {
  const d = f.doc;
  const rowH = 19;
  const x = f.left;
  const w = f.width;
  const cols = {
    key: x + 14,
    count: x + w * 0.3,
    staked: x + w * 0.42,
    profit: x + w * 0.56,
    yield: x + w * 0.69,
    bar: x + w * 0.8,
  };
  const colW = { count: w * 0.1, staked: w * 0.13, profit: w * 0.12, yield: w * 0.1 };
  const barW = x + w - 14 - cols.bar;
  const maxAbs = Math.max(
    0,
    ...rows.map((r) => (r.yield === null ? 0 : Math.abs(Number(r.yield)))),
  );
  const head = () => {
    const y = f.y;
    d.save()
      .roundedRect(x + 10, y, w - 20, 19, 4)
      .fill(C.lavender)
      .restore();
    f.line(firstCol, cols.key, y + 6, { font: F.bold, size: 7.8, color: C.navy });
    f.line('Liquidadas', cols.count, y + 6, {
      font: F.bold,
      size: 7.8,
      color: C.navy,
      width: colW.count,
      align: 'right',
    });
    f.line('Monto', cols.staked, y + 6, {
      font: F.bold,
      size: 7.8,
      color: C.navy,
      width: colW.staked,
      align: 'right',
    });
    f.line('Ganancia', cols.profit, y + 6, {
      font: F.bold,
      size: 7.8,
      color: C.navy,
      width: colW.profit,
      align: 'right',
    });
    f.line('Yield', cols.yield, y + 6, {
      font: F.bold,
      size: 7.8,
      color: C.navy,
      width: colW.yield,
      align: 'right',
    });
    f.line('Rendimiento relativo', cols.bar, y + 6, {
      font: F.bold,
      size: 7.8,
      color: C.navy,
      width: barW,
    });
    f.y = y + 21;
  };
  const row = (r: SegmentRow, isTotal = false) => {
    const y = f.y;
    if (isTotal)
      d.save()
        .moveTo(x + 10, y)
        .lineTo(x + w - 10, y)
        .lineWidth(0.7)
        .strokeColor(C.line)
        .stroke()
        .restore();
    const font = isTotal ? F.bold : F.medium;
    f.line(r.key, cols.key, y + 5.5, {
      font: isTotal ? F.bold : F.semibold,
      size: 8.3,
      color: C.navy,
      width: cols.count - cols.key - 6,
    });
    f.line(String(r.count), cols.count, y + 5.5, {
      font,
      size: 8.3,
      color: C.text,
      width: colW.count,
      align: 'right',
    });
    f.line(formatPEN(r.staked), cols.staked, y + 5.5, {
      font,
      size: 8.3,
      color: C.text,
      width: colW.staked,
      align: 'right',
    });
    f.line(signedPEN(r.profit), cols.profit, y + 5.5, {
      font: F.bold,
      size: 8.3,
      color: TONE_COLOR[toneOf(r.profit)],
      width: colW.profit,
      align: 'right',
    });
    f.line(percent(r.yield), cols.yield, y + 5.5, {
      font: F.semibold,
      size: 8.3,
      color: TONE_COLOR[toneOf(r.yield)],
      width: colW.yield,
      align: 'right',
    });
    if (!isTotal) perfBar(f, r.yield, maxAbs, cols.bar, y + 6, barW);
    f.y = y + rowH;
  };

  // Tarjeta: si no cabe entera, empieza en una página nueva (no se deja el título solo al final).
  d.font(F.regular).fontSize(6.8);
  const noteLines = note ? wrap(d, note, w - 28, 2) : [];
  const fullH = 34 + 21 + (rows.length + 1) * rowH + noteLines.length * 9 + (note ? 6 : 0) + 8;
  f.ensure(Math.min(fullH, 34 + 21 + 4 * rowH));
  const top = f.y;
  const cardH = Math.min(fullH, f.bottom - top);
  f.card(x, top, w, cardH);
  f.blockTitle(x + 14, top + 12, icon, title);
  f.y = top + 32;
  head();
  if (rows.length === 0) {
    f.line('Sin apuestas liquidadas en este periodo.', cols.key, f.y + 4, {
      size: 8.3,
      color: C.faint,
    });
    f.y += rowH;
  }
  for (const r of rows) {
    if (f.y + rowH * 2 > f.bottom) {
      f.newPage();
      const contTop = f.y;
      f.card(x, contTop, w, Math.min(f.bottom - contTop, 34 + 21 + (rows.length + 1) * rowH));
      f.blockTitle(x + 14, contTop + 12, icon, `${title} (continuación)`);
      f.y = contTop + 32;
      head();
    }
    row(r);
  }
  row(total, true);
  noteLines.forEach((l, i) => f.line(l, cols.key, f.y + 3 + i * 9, { size: 6.8, color: C.muted }));
  if (note) f.y += noteLines.length * 9 + 6;
  f.y = Math.max(f.y + 8, top + cardH) + 10;
}

/** Filas por tabla antes de agrupar el resto en «Otros». */
const MAX_ROWS = 8;

export function renderSegments(f: Frame, input: ReportPdfInput): void {
  const { analysis, byBetType, totals } = input.data;
  f.pageTitle(
    'Análisis por segmentos',
    'Qué casas, tipos de apuesta y deportes aportaron ganancias o pérdidas en el periodo.',
  );
  const total: SegmentRow = {
    key: 'Total',
    count: totals.settledBets,
    staked: analysis.totalStaked,
    profit: analysis.profitLoss,
    yield: analysis.yield,
  };
  // Qué mide cada indicador de esta página (y por qué el ROI no aparece por segmento).
  const d = f.doc;
  const definition =
    `Yield = ganancia neta ÷ monto apostado de las apuestas liquidadas de cada fila. ` +
    `El ROI es un indicador global: ${percent(analysis.roi)} en el periodo (ganancia neta ÷ capital ` +
    `invertido de ${formatPEN(analysis.capitalInvested)}); no se reparte por segmento porque el capital es ` +
    `del proyecto, no de una casa, un tipo o un deporte.`;
  d.font(F.regular).fontSize(7.8);
  const defLines = wrap(d, definition, f.width - 28, 3);
  const defH = 14 + defLines.length * 10.5;
  f.card(f.left, f.y, f.width, defH, { fill: C.lavender, stroke: C.lavender2, radius: 8 });
  defLines.forEach((l, i) =>
    f.line(l, f.left + 14, f.y + 7 + i * 10.5, { size: 7.8, color: C.text }),
  );
  f.y += defH + 10;
  // «Otros» siempre al final; el resto, de mayor a menor ganancia (solo orden de presentación).
  const byProfit = (a: SegmentRow, b: SegmentRow) =>
    Number(a.key.startsWith('Otros (')) - Number(b.key.startsWith('Otros (')) ||
    Number(b.profit) - Number(a.profit) ||
    a.key.localeCompare(b.key);
  segmentTable(
    f,
    'Rendimiento por casa de apuestas',
    'bank',
    'Casa',
    withOthers(
      analysis.byHouse.map((h) => ({
        key: h.key,
        count: h.count,
        staked: h.totalStaked,
        profit: h.profitLoss,
        yield: h.yield,
      })),
      MAX_ROWS,
    ).sort(byProfit),
    total,
  );
  segmentTable(
    f,
    'Rendimiento por tipo de apuesta',
    'layers',
    'Tipo',
    byBetType
      .filter((t) => t.settledBets > 0)
      .map((t) => ({
        key: BET_TYPE_LABEL[t.betType],
        count: t.settledBets,
        staked: t.totalStaked,
        profit: t.profitLoss,
        yield: t.yield,
      }))
      .sort(byProfit),
    total,
    'Simple: un pronóstico. Creada: varios pronósticos de un mismo partido. Múltiple: varios partidos (una Múltiple con una Creada dentro sigue siendo una sola apuesta).',
  );
  segmentTable(
    f,
    'Rendimiento por deporte',
    'sport',
    'Deporte',
    withOthers(
      analysis.bySport.map((s) => ({
        key: s.key,
        count: s.count,
        staked: s.totalStaked,
        profit: s.profitLoss,
        yield: s.yield,
      })),
      MAX_ROWS,
    ).sort(byProfit),
    total,
    'Una apuesta con partidos de varios deportes cuenta en «Mixto»; su ganancia no se reparte. Barras: Yield de cada fila frente al mayor de la tabla.',
  );
}
