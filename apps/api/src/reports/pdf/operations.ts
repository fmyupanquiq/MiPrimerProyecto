import { formatOdds, formatPEN } from '@letfer/shared';
import { C, F } from './theme.js';
import { dateParts, signedPEN, wrap } from './format.js';
import type { Frame } from './frame.js';
import { countOf, shareOf, STATUS, STATUS_ORDER } from './charts.js';
import { drawIcon, iconBadge, type IconName } from './icons.js';
import type { ReportPdfInput } from './input.js';
import type { ReportInsights } from './insights.js';
import { segmentTable, withOthers } from './segments.js';

/*
 * Página 4 — Control operativo / Gestión del negocio: exposición (monto apostado, promedio por
 * apuesta, cuota media), apuestas por resultado, mayor ganancia y mayor pérdida, y los riesgos y
 * observaciones de las reglas deterministas de `insights.ts`.
 */

function exposureCard(
  f: Frame,
  x: number,
  y: number,
  w: number,
  h: number,
  icon: IconName,
  label: string,
  value: string,
  caption: string,
): void {
  f.card(x, y, w, h);
  iconBadge(f.doc, icon, x + 14, y + (h - 36) / 2, 36, {
    bg: C.lavender2,
    fg: C.brand,
    shape: 'circle',
  });
  f.line(label, x + 60, y + 13, { font: F.semibold, size: 8, color: C.text, width: w - 70 });
  f.line(value, x + 60, y + 25, { font: F.black, size: 16, color: C.navy, width: w - 70 });
  f.line(caption, x + 60, y + h - 15, { font: F.medium, size: 6.8, color: C.muted, width: w - 70 });
}

export function renderOperations(f: Frame, input: ReportPdfInput, insights: ReportInsights): void {
  const d = f.doc;
  const { analysis, totals, highlights } = input.data;
  f.pageTitle(
    'Control operativo / Gestión del negocio',
    'Exposición, resultados y métricas operativas del periodo.',
  );
  const gap = 12;

  // Resumen de exposición.
  let y = f.y;
  f.blockTitle(f.left, y, 'scale', 'Resumen de exposición');
  y += 20;
  const w3 = (f.width - gap * 2) / 3;
  const h = 64;
  exposureCard(
    f,
    f.left,
    y,
    w3,
    h,
    'dollar',
    'Apostado (liquidadas)',
    formatPEN(totals.stakedSettled),
    totals.stakedPending === '0.00'
      ? 'Liquidadas · sin pendientes'
      : `Excluye ${formatPEN(totals.stakedPending)} pendientes`,
  );
  exposureCard(
    f,
    f.left + w3 + gap,
    y,
    w3,
    h,
    'bars',
    'Promedio por apuesta',
    totals.averageStakeSettled === null ? '—' : formatPEN(totals.averageStakeSettled),
    totals.settledBets === 0
      ? 'Sin apuestas liquidadas'
      : `Monto ÷ ${totals.settledBets} liquidadas`,
  );
  exposureCard(
    f,
    f.left + 2 * (w3 + gap),
    y,
    w3,
    h,
    'odds',
    'Cuota media',
    analysis.averageOdds === null ? '—' : formatOdds(analysis.averageOdds),
    analysis.averageOdds === null ? 'Sin apuestas liquidadas' : 'Promedio simple',
  );
  y += h + gap + 4;

  // Apuestas por resultado | Otros indicadores.
  const wl = (f.width - gap) * 0.5;
  const wr = f.width - gap - wl;
  const rowH = 168;
  f.y = y;
  f.ensure(rowH);
  y = f.y;
  f.card(f.left, y, wl, rowH);
  f.blockTitle(f.left + 14, y + 12, 'pie', 'Apuestas por resultado');
  f.line(`% sobre ${analysis.counts.total} apuestas`, f.left + 14, y + 13, {
    font: F.medium,
    size: 7,
    color: C.muted,
    width: wl - 28,
    align: 'right',
  });
  STATUS_ORDER.forEach((status, i) => {
    const ry = y + 38 + i * 23;
    const value = countOf(analysis.counts, status);
    if (i > 0)
      d.save()
        .moveTo(f.left + 14, ry - 5)
        .lineTo(f.left + wl - 14, ry - 5)
        .lineWidth(0.4)
        .strokeColor(C.lineSoft)
        .stroke()
        .restore();
    d.save()
      .circle(f.left + 22, ry + 4, 4.2)
      .fill(STATUS[status].color)
      .restore();
    f.line(STATUS[status].plural, f.left + 34, ry, { font: F.medium, size: 8.8, color: C.text });
    f.line(String(value), f.left + wl * 0.55, ry, {
      font: F.bold,
      size: 8.8,
      color: C.navy,
      width: 40,
      align: 'right',
    });
    f.line(shareOf(value, analysis.counts.total), f.left + wl * 0.55 + 50, ry, {
      font: F.medium,
      size: 8.5,
      color: C.muted,
      width: wl * 0.45 - 64,
      align: 'right',
    });
  });

  const rx = f.left + wl + gap;
  f.card(rx, y, wr, rowH);
  f.blockTitle(rx + 14, y + 12, 'activity', 'Otros indicadores');
  const extreme = (yy: number, kind: 'best' | 'worst') => {
    const item = highlights[kind];
    const good = kind === 'best';
    iconBadge(d, good ? 'trophy' : 'arrowDown', rx + 14, yy, 34, {
      bg: good ? '#dcfce7' : '#fee2e2',
      fg: good ? C.green : C.red,
      shape: 'circle',
      weight: 2.2,
    });
    f.line(good ? 'Mayor ganancia' : 'Mayor pérdida', rx + 58, yy - 1, {
      font: F.semibold,
      size: 8,
      color: C.text,
    });
    if (!item) {
      f.line(
        good ? 'No hubo apuestas con ganancia.' : 'No hubo apuestas con pérdida.',
        rx + 58,
        yy + 12,
        { size: 8, color: C.faint, width: wr - 72 },
      );
      return;
    }
    f.line(signedPEN(item.profitLoss), rx + 58, yy + 10, {
      font: F.black,
      size: 14,
      color: good ? C.green : C.red,
    });
    d.font(F.regular).fontSize(7.5);
    const lines = wrap(d, item.label, wr - 72, 2);
    lines.forEach((l, i) => f.line(l, rx + 58, yy + 28 + i * 9.5, { size: 7.5, color: C.muted }));
    f.line(dateParts(item.placedAt, input.timeZone).date, rx + 58, yy + 28 + lines.length * 9.5, {
      font: F.medium,
      size: 7,
      color: C.faint,
    });
  };
  extreme(y + 36, 'best');
  extreme(y + 100, 'worst');
  f.y = y + rowH + gap + 4;

  // Riesgos y observaciones.
  d.font(F.regular).fontSize(8.5);
  const bullets = insights.risks.map((t) => wrap(d, t, f.width - 46, 3));
  const disclaimer =
    'Observaciones generadas con reglas fijas sobre las cifras del informe. Describen el periodo; no anticipan resultados futuros ni son recomendaciones.';
  const riskH = 36 + bullets.reduce((a, b) => a + b.length * 11.5 + 3, 0) + 20;
  f.ensure(Math.min(riskH, 160));
  y = f.y;
  f.card(f.left, y, f.width, riskH, { fill: C.amberSoft, stroke: C.amberLine, radius: 10 });
  drawIcon(d, 'alert', f.left + 14, y + 11, 14, C.amberMid, 2.2);
  f.line('Riesgos y observaciones', f.left + 34, y + 12, {
    font: F.bold,
    size: 10.5,
    color: C.amber,
  });
  let by = y + 34;
  for (const lines of bullets) {
    d.save()
      .circle(f.left + 20, by + 4, 2.2)
      .fill(C.amberMid)
      .restore();
    lines.forEach((l, i) => f.line(l, f.left + 30, by + i * 11.5, { size: 8.5, color: C.text }));
    by += lines.length * 11.5 + 3;
  }
  f.line(disclaimer, f.left + 14, by + 4, {
    font: F.medium,
    size: 6.8,
    color: C.muted,
    width: f.width - 28,
  });
  f.y = y + riskH + gap;

  // Actividad por mes de liquidación (solo con dos meses o más: con uno repetiría el total).
  const months = analysis.byPeriod;
  if (months.length > 1) {
    const rows = months.map((m) => ({
      key: monthLabel(m.key),
      count: m.count,
      staked: m.totalStaked,
      profit: m.profitLoss,
      yield: m.yield,
    }));
    segmentTable(
      f,
      'Actividad por mes de liquidación',
      'calendar',
      'Mes',
      rows.length > 12 ? withOthers(rows, 12) : rows,
      {
        key: 'Total',
        count: totals.settledBets,
        staked: analysis.totalStaked,
        profit: analysis.profitLoss,
        yield: analysis.yield,
      },
    );
  }
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
/** `2026-10` → «Octubre 2026». */
function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const name = MONTHS[Number(m[2]) - 1] ?? key;
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${m[1]}`;
}
