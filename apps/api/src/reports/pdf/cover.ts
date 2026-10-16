import { formatPEN } from '@letfer/shared';
import { C, F, TONE_COLOR } from './theme.js';
import { dateParts, pct1, percent, signedPEN, toneOf, wrap } from './format.js';
import type { Frame } from './frame.js';
import { iconBadge, type IconName } from './icons.js';
import { BET_TYPE_LABEL, type ReportPdfInput } from './input.js';
import { countOf, shareOf, STATUS, STATUS_ORDER } from './charts.js';
import type { ReportInsights } from './insights.js';

/*
 * Página 1 — Reporte ejecutivo de rendimiento: identificación, introducción, seis indicadores (con
 * la ganancia/pérdida neta como protagonista), la conclusión del periodo y la lectura rápida.
 */

/** Resumen de los filtros aplicados (o «Todas las apuestas del periodo»). */
export function filtersSummary(input: ReportPdfInput): string {
  const { filters, filterNames } = input;
  const parts: string[] = [];
  if (filters.houseId) parts.push(`Casa: ${filterNames?.house ?? 'una casa'}`);
  if (filters.betType) parts.push(`Tipo: ${BET_TYPE_LABEL[filters.betType]}`);
  if (filters.status)
    parts.push(
      `Resultado: ${{ WON: 'Ganadas', LOST: 'Perdidas', PENDING: 'Pendientes', VOID: 'Anuladas', CASHOUT: 'Cash Out' }[filters.status]}`,
    );
  if (filters.origin) parts.push(`Origen: ${filters.origin === 'MANUAL' ? 'Manual' : 'Importada'}`);
  if (filters.sport) parts.push(`Deporte: ${filters.sport}`);
  if (filters.market) parts.push(`Mercado: ${filters.market}`);
  if (filters.stageId) parts.push(`Etapa: ${filterNames?.stage ?? 'una etapa'}`);
  return parts.length ? parts.join(' · ') : 'Todas las apuestas del periodo (sin filtros)';
}

function kpi(
  f: Frame,
  x: number,
  y: number,
  w: number,
  h: number,
  o: {
    icon: IconName;
    label: string;
    value: string;
    caption?: string;
    tone?: 'positive' | 'negative' | 'neutral';
    hero?: boolean;
  },
): void {
  const d = f.doc;
  const tone = o.tone ?? 'neutral';
  const hero = o.hero && tone !== 'neutral';
  f.card(x, y, w, h, {
    fill: hero ? (tone === 'positive' ? C.greenSoft : C.redSoft) : C.white,
    stroke: hero ? (tone === 'positive' ? C.greenLine : C.redLine) : C.line,
  });
  const badge = h >= 76 ? 38 : 30;
  const tint = tone === 'positive' ? '#dcfce7' : tone === 'negative' ? '#fee2e2' : C.lavender2;
  const fg = tone === 'positive' ? C.green : tone === 'negative' ? C.red : C.brand;
  f.line(o.label, x + 12, y + 11, { font: F.semibold, size: 8.5, color: C.text, width: w - 24 });
  const top = y + 25 + (h - 25 - badge - 8) / 2;
  iconBadge(d, o.icon, x + 12, top, badge, { bg: tint, fg, shape: 'circle' });
  const valueColor = o.tone ? TONE_COLOR[tone] : C.navy;
  const max = h >= 76 ? 21 : 18;
  d.font(F.black);
  let size = max;
  while (size > 11 && d.fontSize(size).widthOfString(o.value) > w - badge - 34) size -= 1;
  f.line(o.value, x + badge + 20, top + 1 + (max - size) / 2, {
    font: F.black,
    size,
    color: valueColor,
  });
  if (o.caption)
    f.line(o.caption, x + badge + 20, top + max + 6, {
      font: F.medium,
      size: 7,
      color: C.muted,
      width: w - badge - 30,
    });
}

export function renderCover(
  f: Frame,
  input: ReportPdfInput,
  insights: ReportInsights,
  period: string,
): void {
  const d = f.doc;
  const { data } = input;
  const { analysis, totals } = data;
  const n = totals.bets;
  const generated = dateParts(data.generatedAt, input.timeZone);

  // Título.
  let y = f.y + 6;
  d.font(F.black)
    .fontSize(f.landscape ? 22 : 23)
    .fillColor(C.navy);
  d.text('Reporte ejecutivo de rendimiento', f.left, y, {
    width: f.width,
    align: 'center',
    lineBreak: false,
  });
  y += 30;
  d.font(F.medium).fontSize(11.5).fillColor(C.text);
  d.text(`Resumen financiero y operativo de ${n} ${n === 1 ? 'apuesta' : 'apuestas'}`, f.left, y, {
    width: f.width,
    align: 'center',
    lineBreak: false,
  });
  y += 26;

  // Información general (2 × 2).
  const panelH = 74;
  f.card(f.left, y, f.width, panelH, { fill: C.lavender, stroke: C.lavender2, radius: 10 });
  const colW = (f.width - 24) / 2;
  const items: [IconName, string, string, string?][] = [
    ['folder', 'Proyecto', input.projectName],
    [
      'calendar',
      'Periodo del reporte',
      period,
      input.filters.from || input.filters.to ? `Zona horaria: ${input.timeZone}` : undefined,
    ],
    [
      'activity',
      'Fecha de generación',
      `${generated.date}, ${generated.time}`,
      `Generado por ${input.generatedBy}`,
    ],
    ['database', 'Fuente de datos / filtros', filtersSummary(input)],
  ];
  items.forEach(([icon, label, value, extra], i) => {
    const cx = f.left + 12 + (i % 2) * colW;
    const cy = y + 10 + Math.floor(i / 2) * 32;
    iconBadge(d, icon, cx, cy, 22, { bg: C.lavender2, fg: C.brand, shape: 'square' });
    f.line(label, cx + 30, cy - 0.5, { font: F.medium, size: 7, color: C.muted });
    f.line(value, cx + 30, cy + 8.5, {
      font: F.semibold,
      size: 9,
      color: C.navy,
      width: colW - 44,
    });
    if (extra)
      f.line(extra, cx + 30, cy + 19.5, {
        font: F.regular,
        size: 6.5,
        color: C.muted,
        width: colW - 44,
      });
  });
  y += panelH + 12;

  // Introducción (adaptada al alcance real; sin cifras inventadas).
  const intro =
    `Este informe presenta los resultados financieros y operativos del proyecto ${input.projectName} durante el periodo seleccionado` +
    `${filtersSummary(input).startsWith('Todas') ? '' : ', con los filtros indicados'}: indicadores de rendimiento, evolución y distribución de los resultados, ` +
    'análisis por segmentos y el registro de cada operación. Las cifras de resultado corresponden a apuestas liquidadas; las pendientes se muestran aparte como dinero comprometido.';
  d.font(F.regular).fontSize(8.5).fillColor(C.text);
  const introLines = wrap(d, intro, f.width, 4);
  introLines.forEach((line, i) => d.text(line, f.left, y + i * 12, { lineBreak: false }));
  y += introLines.length * 12 + 12;

  // Indicadores ejecutivos (dos filas de tres).
  const roomy = !f.landscape;
  const gap = roomy ? 12 : 10;
  const w = (f.width - gap * 2) / 3;
  const h = roomy ? 80 : 64;
  const net = analysis.profitLoss;
  const settled = totals.settledBets;
  const decided = analysis.counts.won + analysis.counts.lost;
  kpi(f, f.left, y, w, h, {
    icon: 'ticket',
    label: 'Apuestas registradas',
    value: String(n),
    caption: `${settled} liquidadas · ${analysis.counts.pending} pendientes`,
  });
  kpi(f, f.left + w + gap, y, w, h, {
    icon: 'dollar',
    label: 'Monto apostado (liquidadas)',
    value: formatPEN(totals.stakedSettled),
    caption:
      totals.stakedPending === '0.00'
        ? 'En apuestas liquidadas'
        : `Excluye ${formatPEN(totals.stakedPending)} pendientes`,
  });
  kpi(f, f.left + 2 * (w + gap), y, w, h, {
    icon: toneOf(net) === 'negative' ? 'trendDown' : 'trendUp',
    label: 'Ganancia / Pérdida neta',
    value: settled === 0 ? '—' : signedPEN(net),
    caption: settled === 0 ? 'Sin apuestas liquidadas' : 'Resultado de las liquidadas',
    tone: settled === 0 ? 'neutral' : toneOf(net),
    hero: true,
  });
  y += h + gap;
  kpi(f, f.left, y, w, h, {
    icon: 'bars',
    label: 'ROI',
    value: analysis.roi === null ? '—' : percent(analysis.roi),
    caption: analysis.roi === null ? 'Sin capital invertido' : 'Ganancia ÷ capital invertido',
    tone: toneOf(analysis.roi),
  });
  kpi(f, f.left + w + gap, y, w, h, {
    icon: 'scale',
    label: 'Yield',
    value: analysis.yield === null ? '—' : percent(analysis.yield),
    caption: analysis.yield === null ? 'Sin monto liquidado' : 'Ganancia ÷ monto apostado',
    tone: toneOf(analysis.yield),
  });
  kpi(f, f.left + 2 * (w + gap), y, w, h, {
    icon: 'pie',
    label: 'Win rate',
    value: analysis.winRate === null ? '—' : pct1(analysis.winRate, false),
    caption:
      decided === 0
        ? 'Sin ganadas ni perdidas'
        : `${analysis.counts.won} ganadas de ${decided} decididas`,
  });
  y += h + (roomy ? 18 : 14);

  // Conclusión ejecutiva.
  const state = insights.conclusion.state;
  const palette =
    state === 'profit'
      ? {
          bg: C.greenSoft,
          line: C.greenLine,
          circle: C.greenMid,
          title: C.green,
          icon: 'trophy' as IconName,
        }
      : state === 'loss'
        ? {
            bg: C.redSoft,
            line: C.redLine,
            circle: C.redMid,
            title: C.red,
            icon: 'trendDown' as IconName,
          }
        : {
            bg: C.slateSoft,
            line: C.line,
            circle: C.faint,
            title: C.navy,
            icon: state === 'even' ? ('equal' as IconName) : ('info' as IconName),
          };
  // Vertical: conclusión y lectura rápida una debajo de otra; apaisado: lado a lado.
  const side = f.landscape;
  const conclW = side ? f.width * 0.42 : f.width;
  const quickX = side ? f.left + conclW + 12 : f.left;
  const quickW = side ? f.width - conclW - 12 : f.width;
  d.font(F.regular).fontSize(9.5);
  const conclLines = wrap(d, insights.conclusion.text, conclW - 96, 4);
  d.font(F.regular).fontSize(8.5);
  const bullets = insights.quick.map((t) => wrap(d, t, quickW - 34, 3));
  const step = roomy ? 14 : 11.5;
  const quickH = 34 + bullets.reduce((a, b) => a + b.length * step + 4, 0);
  const conclH = side ? quickH : Math.max(roomy ? 84 : 66, 34 + conclLines.length * 13);
  f.card(f.left, y, conclW, conclH, { fill: palette.bg, stroke: palette.line, radius: 12 });
  iconBadge(d, palette.icon, f.left + 16, y + (conclH - 46) / 2, 46, {
    bg: palette.circle,
    fg: C.white,
    shape: 'circle',
    weight: 2.2,
  });
  const textTop = y + (conclH - (22 + conclLines.length * 13)) / 2;
  f.line(insights.conclusion.title, f.left + 76, textTop, {
    font: F.black,
    size: 15,
    color: palette.title,
  });
  conclLines.forEach((line, i) =>
    f.line(line, f.left + 76, textTop + 22 + i * 13, { font: F.regular, size: 9.5, color: C.text }),
  );
  if (!side) y += conclH + (roomy ? 18 : 14);

  // Lectura rápida.
  if (y + quickH > f.bottom) {
    f.newPage();
    y = f.y;
  }
  f.card(quickX, y, quickW, quickH, { fill: C.white, stroke: C.line });
  f.blockTitle(quickX + 12, y + 10, 'info', 'Lectura rápida');
  let by = y + 32;
  for (const lines of bullets) {
    d.save()
      .circle(quickX + 18, by + 4, 2.3)
      .fill(C.brand)
      .restore();
    lines.forEach((line, i) =>
      f.line(line, quickX + 26, by + i * step, { font: F.regular, size: 8.5, color: C.text }),
    );
    by += lines.length * step + 4;
  }
  f.y = y + quickH + 14;
  composition(f, input);
}

/**
 * Composición de las apuestas del periodo (barra apilada por resultado), solo si queda sitio en la
 * portada. Los segmentos son los conteos reales; el ancho es proporcional a cada conteo.
 */
function composition(f: Frame, input: ReportPdfInput): void {
  const d = f.doc;
  const { counts } = input.data.analysis;
  const h = 78;
  if (counts.total === 0 || f.y + h > f.bottom) return;
  const y = f.y;
  f.card(f.left, y, f.width, h, { fill: C.white, stroke: C.line });
  f.blockTitle(f.left + 12, y + 11, 'bars', 'Composición de las apuestas');
  const bx = f.left + 14;
  const bw = f.width - 28;
  let x = bx;
  d.save()
    .roundedRect(bx, y + 34, bw, 12, 6)
    .clip();
  for (const status of STATUS_ORDER) {
    const value = countOf(counts, status);
    if (value === 0) continue;
    const w = (value / counts.total) * bw;
    d.rect(x, y + 34, w + 0.5, 12).fill(STATUS[status].color);
    x += w;
  }
  d.restore();
  const slot = bw / STATUS_ORDER.length;
  STATUS_ORDER.forEach((status, i) => {
    const lx = bx + i * slot;
    const value = countOf(counts, status);
    d.save()
      .circle(lx + 4, y + 60, 3.5)
      .fill(STATUS[status].color)
      .restore();
    f.line(
      `${STATUS[status].plural}: ${value} (${shareOf(value, counts.total)})`,
      lx + 12,
      y + 56.5,
      { font: F.medium, size: 7.8, color: C.text, width: slot - 14 },
    );
  });
  f.y = y + h + 10;
}
