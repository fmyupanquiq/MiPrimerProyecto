/*
 * Iconos vectoriales del informe (trazo, caja de 24 × 24, como los de la web). Se dibujan con
 * trayectorias: nítidos al imprimir y sin imágenes rasterizadas.
 */

const CIRCLE = (cx: number, cy: number, r: number) =>
  `M${cx + r} ${cy}a${r} ${r} 0 1 1-${2 * r} 0 ${r} ${r} 0 1 1 ${2 * r} 0Z`;

export const ICONS = {
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  dollar:
    'M12 3v18M16.5 7.5c-.8-1.3-2.4-2-4.5-2-2.5 0-4 1.2-4 3s1.6 2.6 4 3.1c2.6.5 4.4 1.3 4.4 3.4 0 1.9-1.8 3.2-4.4 3.2-2.3 0-4-.8-4.9-2.2',
  ticket:
    'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4ZM10 5v12',
  trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  trendDown: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  calendar: 'M4 6h16v14H4ZM4 10h16M8 3v4M16 3v4',
  user: `${CIRCLE(12, 8, 4)}M4 21c0-4 4-6 8-6s8 2 8 6`,
  folder: 'M3 7h6l2 2h10v10H3Z',
  database:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  info: `${CIRCLE(12, 12, 9)}M12 11v5M12 7.5v.5`,
  alert: 'M12 3 2 20h20ZM12 10v4M12 17v.5',
  bars: 'M5 20v-6M10 20V9M15 20v-8M20 20V5',
  pie: 'M12 3a9 9 0 1 0 9 9h-9ZM14 3.3A9 9 0 0 1 20.7 10H14Z',
  scale: 'M12 4v16M8 20h8M5 8h14M5 8l-3 7h6ZM19 8l-3 7h6Z',
  bank: 'M3 10l9-6 9 6M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20h18',
  layers: 'M12 3 2 8l10 5 10-5ZM2 13l10 5 10-5',
  sport: `${CIRCLE(12, 12, 9)}M3.5 9.5c3 1 5.5 3.5 6.5 11M20.5 14.5c-3-1-5.5-3.5-6.5-11`,
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6v.2M3.5 12v.2M3.5 18v.2',
  odds: 'M5 19 19 5M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  equal: 'M5 9h14M5 15h14',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
} as const;
export type IconName = keyof typeof ICONS;

/** Dibuja un icono de trazo en (x, y) con lado `size`. */
export function drawIcon(
  doc: PDFKit.PDFDocument,
  name: IconName,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 1.8,
): void {
  const k = size / 24;
  doc.save();
  doc.translate(x, y).scale(k);
  doc
    .path(ICONS[name])
    .lineWidth(weight)
    .lineCap('round')
    .lineJoin('round')
    .strokeColor(color)
    .stroke();
  doc.restore();
}

/** Icono dentro de un círculo o cuadro suave (el «chip» de la referencia). */
export function iconBadge(
  doc: PDFKit.PDFDocument,
  name: IconName,
  x: number,
  y: number,
  size: number,
  opts: { bg: string; fg: string; shape?: 'circle' | 'square'; weight?: number },
): void {
  doc.save();
  if (opts.shape === 'square') doc.roundedRect(x, y, size, size, size * 0.26).fill(opts.bg);
  else doc.circle(x + size / 2, y + size / 2, size / 2).fill(opts.bg);
  doc.restore();
  const inner = size * 0.56;
  drawIcon(
    doc,
    name,
    x + (size - inner) / 2,
    y + (size - inner) / 2,
    inner,
    opts.fg,
    opts.weight ?? 1.9,
  );
}
