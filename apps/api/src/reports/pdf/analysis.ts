import { formatOdds, formatPEN } from '@letfer/shared';
import { C, F, TONE_COLOR } from './theme.js';
import { pct1, percent, signedPEN, toneOf, wrap } from './format.js';
import type { Frame } from './frame.js';
import { netEvolution, statusBars, statusDonut } from './charts.js';
import type { ReportPdfInput } from './input.js';

/*
 * Página 2 — Análisis financiero y estadístico: evolución de la ganancia neta, resultados por
 * estado (barras y dona) e indicadores interpretados. Las definiciones de «¿Qué significa?» son las
 * de LetFer (§108.1, §108.10, §112.6): no se inventa ninguna fórmula.
 */

interface IndicatorRow {
  name: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
  meaning: string;
}

export function indicatorRows(input: ReportPdfInput): IndicatorRow[] {
  const { analysis, totals } = input.data;
  const rows: IndicatorRow[] = [
    {
      name: 'Ganancia neta',
      value: totals.settledBets === 0 ? '—' : signedPEN(analysis.profitLoss),
      tone: toneOf(analysis.profitLoss),
      meaning:
        'Dinero ganado o perdido en las apuestas ya liquidadas: retornos menos montos apostados, según el registro contable (ledger).',
    },
    {
      name: 'Monto apostado',
      value: formatPEN(totals.stakedSettled),
      tone: 'neutral',
      meaning:
        'Dinero destinado a las apuestas ya liquidadas. No incluye el comprometido en pendientes.',
    },
    {
      name: 'Retornos realizados',
      value: formatPEN(totals.returns),
      tone: 'neutral',
      meaning: 'Dinero devuelto por las apuestas liquidadas (monto apostado más ganancia neta).',
    },
    {
      name: 'ROI',
      value: analysis.roi === null ? '—' : percent(analysis.roi),
      tone: toneOf(analysis.roi),
      meaning: `Ganancia neta ÷ capital invertido (banca inicial más depósitos netos del periodo: ${formatPEN(analysis.capitalInvested)}). Rendimiento sobre el dinero aportado.`,
    },
    {
      name: 'Yield',
      value: analysis.yield === null ? '—' : percent(analysis.yield),
      tone: toneOf(analysis.yield),
      meaning:
        'Ganancia neta ÷ monto apostado de las liquidadas. Cuánto se ganó o perdió por cada sol apostado.',
    },
    {
      name: 'Win rate',
      value: analysis.winRate === null ? '—' : pct1(analysis.winRate, false),
      tone: 'neutral',
      meaning: 'Ganadas ÷ (ganadas + perdidas). No cuenta anuladas, cash out ni pendientes.',
    },
    {
      name: 'Cuota media',
      value: analysis.averageOdds === null ? '—' : formatOdds(analysis.averageOdds),
      tone: 'neutral',
      meaning:
        'Promedio simple de la cuota total de las apuestas liquidadas (no se pondera por el monto apostado).',
    },
  ];
  if (totals.stakedPending !== '0.00') {
    rows.push({
      name: 'Comprometido',
      value: formatPEN(totals.stakedPending),
      tone: 'neutral',
      meaning:
        'Dinero en apuestas que aún no tienen resultado. No forma parte de la ganancia neta.',
    });
  }
  return rows;
}

export function renderAnalysis(
  f: Frame,
  input: ReportPdfInput,
  period: string,
  opts: { charts: boolean; metrics: boolean },
): void {
  const d = f.doc;
  const { data } = input;
  f.pageTitle(
    'Análisis financiero y estadístico',
    `Evolución, composición y métricas clave del periodo (${period}).`,
  );
  const gap = 12;

  if (opts.charts) {
    // Evolución de la ganancia neta.
    const evoH = f.landscape ? 168 : 182;
    f.ensure(evoH);
    let y = f.y;
    f.card(f.left, y, f.width, evoH);
    f.blockTitle(f.left + 14, y + 12, 'trendUp', 'Evolución de la ganancia neta');
    f.line(
      'Ganancia/pérdida acumulada de las apuestas liquidadas, por fecha de liquidación.',
      f.left + 31,
      y + 27,
      { size: 7.5, color: C.muted, width: f.width - 50 },
    );
    netEvolution(f, data, input.timeZone, f.left + 12, y + 46, f.width - 24, evoH - 58);
    f.y = y + evoH + gap;

    // Resultados por estado + distribución.
    const rowH = 140;
    f.ensure(rowH);
    y = f.y;
    const w = (f.width - gap) / 2;
    f.card(f.left, y, w, rowH);
    f.blockTitle(f.left + 14, y + 12, 'bars', 'Resultados por estado');
    statusBars(f, data.analysis.counts, f.left + 14, y + 40, w - 28, rowH - 54);
    f.card(f.left + w + gap, y, w, rowH);
    f.blockTitle(f.left + w + gap + 14, y + 12, 'pie', 'Distribución por resultado');
    statusDonut(f, data.analysis.counts, f.left + w + gap + 14, y + 36, w - 28, rowH - 48);
    f.y = y + rowH + gap;
  }

  if (opts.metrics) {
    const rows = indicatorRows(input);
    const nameW = f.width * 0.2;
    const valueW = f.width * 0.17;
    const meaningW = f.width - 28 - nameW - valueW;
    d.font(F.regular).fontSize(8);
    const lines = rows.map((r) => wrap(d, r.meaning, meaningW - 10, 3));
    const rowHs = lines.map((l) => Math.max(20, 8 + l.length * 10.5));
    const tableH = 40 + 20 + rowHs.reduce((a, b) => a + b, 0) + 6;
    f.ensure(tableH);
    const y = f.y;
    f.card(f.left, y, f.width, tableH);
    f.blockTitle(f.left + 14, y + 12, 'list', 'Indicadores interpretados');
    const tx = f.left + 14;
    let ty = y + 36;
    d.save()
      .roundedRect(tx, ty, f.width - 28, 20, 4)
      .fill(C.lavender)
      .restore();
    f.line('Indicador', tx + 8, ty + 6, { font: F.bold, size: 8, color: C.navy });
    f.line('Valor', tx + nameW, ty + 6, { font: F.bold, size: 8, color: C.navy });
    f.line('¿Qué significa?', tx + nameW + valueW, ty + 6, {
      font: F.bold,
      size: 8,
      color: C.navy,
    });
    ty += 22;
    rows.forEach((row, i) => {
      if (i > 0)
        d.save()
          .moveTo(tx, ty)
          .lineTo(tx + f.width - 28, ty)
          .lineWidth(0.4)
          .strokeColor(C.lineSoft)
          .stroke()
          .restore();
      f.line(row.name, tx + 8, ty + 6, { font: F.semibold, size: 8.5, color: C.navy });
      f.line(row.value, tx + nameW, ty + 6, {
        font: F.bold,
        size: 8.5,
        color: TONE_COLOR[row.tone],
        width: valueW - 6,
      });
      lines[i]!.forEach((line, j) =>
        f.line(line, tx + nameW + valueW, ty + 6 + j * 10.5, { size: 8, color: C.text }),
      );
      ty += rowHs[i]!;
    });
    f.y = y + tableH + gap;
  }
}
