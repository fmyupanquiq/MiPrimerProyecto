import type { BetStatus, BetStatusCounts, ReportData } from '@letfer/shared';
import { C, F } from './theme.js';
import { axisDate, signedPEN, toneOf } from './format.js';
import type { Frame } from './frame.js';

/*
 * Gráficos vectoriales del informe. SOLO dibujan valores ya calculados (las posiciones se calculan
 * con números únicamente para situar cada punto; las etiquetas usan las cadenas originales). No se
 * inventan puntos ni se suavizan las curvas.
 */

export const STATUS_ORDER: BetStatus[] = ['WON', 'LOST', 'PENDING', 'VOID', 'CASHOUT'];
export const STATUS: Record<
  BetStatus,
  { label: string; plural: string; color: string; fg: string; bg: string }
> = {
  WON: { label: 'Ganada', plural: 'Ganadas', color: '#22c55e', fg: '#15803d', bg: '#dcfce7' },
  LOST: { label: 'Perdida', plural: 'Perdidas', color: '#ef4444', fg: '#b91c1c', bg: '#fee2e2' },
  PENDING: {
    label: 'Pendiente',
    plural: 'Pendientes',
    color: '#eab308',
    fg: '#92400e',
    bg: '#fef3c7',
  },
  VOID: { label: 'Anulada', plural: 'Anuladas', color: '#94a3b8', fg: '#475569', bg: '#e2e8f0' },
  CASHOUT: {
    label: 'Cash Out',
    plural: 'Cash Out',
    color: '#3b82f6',
    fg: '#1d4ed8',
    bg: '#dbeafe',
  },
};
const COUNT_KEY: Record<BetStatus, keyof Omit<BetStatusCounts, 'total'>> = {
  WON: 'won',
  LOST: 'lost',
  PENDING: 'pending',
  VOID: 'void',
  CASHOUT: 'cashout',
};
export const countOf = (counts: BetStatusCounts, status: BetStatus) => counts[COUNT_KEY[status]];

/** Porcentaje de un conteo, con un decimal (solo presentación). */
export const shareOf = (count: number, total: number) =>
  total === 0 ? '0.0 %' : `${((count / total) * 100).toFixed(1)} %`;

/** Eje con pasos redondos (1, 2, 2.5, 5 × 10ⁿ) que incluye el 0. */
export function niceAxis(
  values: number[],
  ticksWanted = 5,
): { ticks: number[]; low: number; high: number } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max > min ? max - min : Math.max(Math.abs(max), 10);
  const raw = span / (ticksWanted - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step || step;
  const ticks: number[] = [];
  for (let i = 0; low + i * step <= high + step / 2 && i < 12; i++) ticks.push(low + i * step);
  return { ticks, low, high };
}

const axisMoney = (v: number) =>
  `${v < 0 ? '-' : ''}S/ ${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

/**
 * Evolución de la ganancia neta acumulada (apuestas liquidadas, por fecha de liquidación): línea
 * violeta, área suave, eje de fechas y monetario, línea del cero y valor final destacado.
 */
export function netEvolution(
  f: Frame,
  data: ReportData,
  timeZone: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const d = f.doc;
  const points = data.cumulative;
  if (points.length === 0) {
    emptyNote(
      f,
      x,
      y,
      w,
      h,
      'Aún no hay apuestas liquidadas: la evolución aparecerá con la primera.',
    );
    return;
  }
  const values = points.map((p) => Number(p.cumulative));
  const { ticks, low, high } = niceAxis(values);
  const axisW = 50;
  const px = x + axisW;
  const pw = w - axisW - 10;
  const ph = h - 20;
  const t0 = new Date(points[0]!.settledAt).getTime();
  const t1 = new Date(points.at(-1)!.settledAt).getTime();
  const sx = (t: number, i: number) =>
    t1 > t0
      ? px + ((t - t0) / (t1 - t0)) * pw
      : points.length === 1
        ? px + pw / 2
        : px + (i / (points.length - 1)) * pw;
  const sy = (v: number) => y + ph - ((v - low) / (high - low || 1)) * ph;

  d.font(F.medium).fontSize(7).fillColor(C.muted);
  for (const t of ticks) {
    const ty = sy(t);
    d.save()
      .moveTo(px, ty)
      .lineTo(px + pw, ty)
      .dash(1.5, { space: 2.5 })
      .lineWidth(0.5)
      .strokeColor(C.line)
      .stroke()
      .undash()
      .restore();
    d.text(axisMoney(t), x, ty - 3.5, { width: axisW - 8, align: 'right', lineBreak: false });
  }
  if (low < 0 && high > 0) {
    d.save()
      .moveTo(px, sy(0))
      .lineTo(px + pw, sy(0))
      .lineWidth(0.7)
      .strokeColor(C.faint)
      .stroke()
      .restore();
  }
  const coords = points.map(
    (p, i) => [sx(new Date(p.settledAt).getTime(), i), sy(Number(p.cumulative))] as const,
  );
  // Área degradada hasta el cero (o el borde inferior si todo es positivo).
  const base = sy(Math.max(low, Math.min(0, high)));
  const grad = d.linearGradient(0, y, 0, y + ph);
  grad.stop(0, C.brand, 0.28).stop(1, C.brand, 0.02);
  d.save();
  d.moveTo(coords[0]![0], base);
  for (const [cx, cy] of coords) d.lineTo(cx, cy);
  d.lineTo(coords.at(-1)![0], base).closePath().fill(grad);
  d.restore();
  d.save().moveTo(coords[0]![0], coords[0]![1]);
  for (const [cx, cy] of coords.slice(1)) d.lineTo(cx, cy);
  d.lineWidth(1.6).lineJoin('round').strokeColor(C.brand).stroke().restore();

  // Valor final.
  const last = points.at(-1)!;
  const [lx, ly] = coords.at(-1)!;
  const tone = toneOf(last.cumulative);
  const color = tone === 'negative' ? C.redMid : tone === 'positive' ? C.greenMid : C.navy;
  d.save().circle(lx, ly, 3.2).fill(color).restore();
  const label = `Acumulado: ${signedPEN(last.cumulative)}`;
  d.font(F.bold).fontSize(8.5);
  const lw = d.widthOfString(label) + 14;
  // Etiqueta del valor final arriba a la derecha, fuera del trazado (nunca tapa la curva).
  const bx = px + pw - lw + 6;
  const by = y - 24;
  d.save().roundedRect(bx, by, lw, 16, 5).fill(color).restore();
  d.fillColor(C.white).text(label, bx, by + 4, { width: lw, align: 'center', lineBreak: false });

  // Eje de fechas: hasta 6 marcas repartidas, sin repetir el mismo día.
  d.font(F.medium).fontSize(7).fillColor(C.muted);
  const wanted = Math.max(2, Math.min(6, Math.floor(pw / 70)));
  const seen = new Set<string>();
  for (let k = 0; k < wanted; k++) {
    const i = Math.round((k / (wanted - 1)) * (points.length - 1));
    const label2 = axisDate(points[i]!.settledAt, timeZone);
    if (seen.has(label2)) continue;
    seen.add(label2);
    const cx = coords[i]![0];
    d.text(label2, Math.min(Math.max(cx - 22, px - 10), px + pw - 34), y + ph + 7, {
      width: 44,
      align: 'center',
      lineBreak: false,
    });
  }
}

/** Barras verticales por estado, con su cantidad encima. */
export function statusBars(
  f: Frame,
  counts: BetStatusCounts,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const d = f.doc;
  if (counts.total === 0) {
    emptyNote(f, x, y, w, h, 'Sin apuestas en el periodo.');
    return;
  }
  const max = Math.max(...STATUS_ORDER.map((s) => countOf(counts, s)), 1);
  const { ticks, high } = niceAxis([max], 4);
  const axisW = 20;
  const ph = h - 18;
  const px = x + axisW;
  const pw = w - axisW;
  const slot = pw / STATUS_ORDER.length;
  const barW = Math.min(24, slot * 0.58);
  d.font(F.medium).fontSize(6.5).fillColor(C.muted);
  for (const t of ticks) {
    const ty = y + ph - (t / high) * ph;
    d.save()
      .moveTo(px, ty)
      .lineTo(px + pw, ty)
      .lineWidth(0.4)
      .strokeColor(C.lineSoft)
      .stroke()
      .restore();
    d.text(String(t), x, ty - 3, { width: axisW - 5, align: 'right', lineBreak: false });
  }
  STATUS_ORDER.forEach((status, i) => {
    const value = countOf(counts, status);
    const bh = (value / high) * ph;
    const bx = px + i * slot + (slot - barW) / 2;
    if (value > 0)
      d.save()
        .roundedRect(bx, y + ph - bh, barW, bh, 2)
        .fill(STATUS[status].color)
        .restore();
    d.font(F.bold)
      .fontSize(8)
      .fillColor(C.navy)
      .text(String(value), bx - 6, y + ph - bh - 11, {
        width: barW + 12,
        align: 'center',
        lineBreak: false,
      });
    d.font(F.medium)
      .fontSize(6.5)
      .fillColor(C.muted)
      .text(STATUS[status].plural, px + i * slot, y + ph + 5, {
        width: slot,
        align: 'center',
        lineBreak: false,
      });
  });
}

/** Dona de distribución por estado con el total en el centro y leyenda en columnas. */
export function statusDonut(
  f: Frame,
  counts: BetStatusCounts,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const d = f.doc;
  const size = Math.min(h, w * 0.42);
  const cx = x + size / 2;
  const cy = y + h / 2;
  const ro = size / 2;
  const ri = ro * 0.6;
  if (counts.total === 0) {
    d.save()
      .circle(cx, cy, (ro + ri) / 2)
      .lineWidth(ro - ri)
      .strokeColor(C.slateSoft)
      .stroke()
      .restore();
  } else {
    let angle = -Math.PI / 2;
    for (const status of STATUS_ORDER) {
      const value = countOf(counts, status);
      if (value === 0) continue;
      const sweep = (value / counts.total) * Math.PI * 2;
      slice(d, cx, cy, ro, ri, angle, angle + sweep, STATUS[status].color);
      angle += sweep;
    }
  }
  d.font(F.black)
    .fontSize(15)
    .fillColor(C.navy)
    .text(String(counts.total), cx - ri, cy - 11, {
      width: ri * 2,
      align: 'center',
      lineBreak: false,
    });
  d.font(F.medium)
    .fontSize(6.5)
    .fillColor(C.muted)
    .text('apuestas', cx - ri, cy + 6, { width: ri * 2, align: 'center', lineBreak: false });
  const lx = x + size + 14;
  const lw = x + w - lx;
  STATUS_ORDER.forEach((status, i) => {
    const ly = cy - 40 + i * 17;
    const value = countOf(counts, status);
    d.save()
      .circle(lx + 4, ly + 4, 3.6)
      .fill(STATUS[status].color)
      .restore();
    d.font(F.medium)
      .fontSize(8)
      .fillColor(C.text)
      .text(STATUS[status].plural, lx + 13, ly, { lineBreak: false });
    d.font(F.bold)
      .fontSize(8)
      .fillColor(C.navy)
      .text(shareOf(value, counts.total), lx, ly, { width: lw, align: 'right', lineBreak: false });
  });
}

/** Barra horizontal de rendimiento: longitud proporcional a |valor| ÷ máximo |valor| de la tabla. */
export function perfBar(
  f: Frame,
  value: string | null,
  maxAbs: number,
  x: number,
  y: number,
  w: number,
  h = 7,
): void {
  const d = f.doc;
  d.save()
    .roundedRect(x, y, w, h, h / 2)
    .fill(C.slateSoft)
    .restore();
  if (value === null || maxAbs <= 0) return;
  const v = Number(value);
  const len = Math.max(2, (Math.abs(v) / maxAbs) * w);
  d.save()
    .roundedRect(x, y, len, h, h / 2)
    .fill(v < 0 ? '#f87171' : v > 0 ? '#22c55e' : C.faint)
    .restore();
}

export function emptyNote(
  f: Frame,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
): void {
  f.doc
    .font(F.medium)
    .fontSize(8.5)
    .fillColor(C.faint)
    .text(text, x + 10, y + h / 2 - 6, { width: w - 20, align: 'center' });
}

function slice(
  d: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  a0: number,
  a1: number,
  color: string,
) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    d.save()
      .circle(cx, cy, (ro + ri) / 2)
      .lineWidth(ro - ri)
      .strokeColor(color)
      .stroke()
      .restore();
    return;
  }
  const gap = 0.012;
  const s = a0 + gap;
  const e = a1 - gap;
  const large = e - s > Math.PI ? 1 : 0;
  const p = (r: number, a: number) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  d.save()
    .path(
      `M ${p(ro, s)} A ${ro} ${ro} 0 ${large} 1 ${p(ro, e)} L ${p(ri, e)} A ${ri} ${ri} 0 ${large} 0 ${p(ri, s)} Z`,
    )
    .fill(color)
    .restore();
}
