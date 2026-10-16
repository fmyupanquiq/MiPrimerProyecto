import { C, F } from './theme.js';
import { dateParts } from './format.js';
import type { Frame } from './frame.js';
import type { ReportPdfInput } from './input.js';

/** Anexo opcional: imágenes de los tickets originales (JPEG/PNG; solo con permiso de tickets). */
export function renderTickets(f: Frame, input: ReportPdfInput): void {
  f.pageTitle(
    'Tickets adjuntos',
    'Imágenes de los tickets originales vinculados a las apuestas del reporte.',
  );
  const images = input.ticketImages;
  if (images === null) {
    f.line(
      input.ticketsAllowed
        ? 'No se pidieron tickets.'
        : 'Tu rol no permite ver los tickets: no se incluyen en el reporte.',
      f.left,
      f.y,
      { size: 9, color: C.muted, width: f.width },
    );
    f.y += 16;
    return;
  }
  if (images.length === 0) {
    f.line('Ninguna apuesta del reporte tiene tickets vinculados.', f.left, f.y, {
      size: 9,
      color: C.muted,
      width: f.width,
    });
    f.y += 16;
    return;
  }
  const position = new Map(input.data.bets.map((b) => [b.id, b] as const));
  const boxH = (f.bottom - f.top - 50) / 2 - 10;
  for (const image of images) {
    f.ensure(boxH);
    const y = f.y;
    const bet = position.get(image.betId);
    const label = bet
      ? `Apuesta del ${dateParts(bet.placedAt, input.timeZone).date} · ${bet.houseName} · ${bet.legs.map((l) => l.event).join(' + ')}`
      : 'Apuesta';
    f.line(label, f.left, y, { font: F.semibold, size: 8.5, color: C.navy, width: f.width });
    f.card(f.left, y + 14, f.width, boxH - 18, { fill: C.zebra });
    if (image.buffer) {
      try {
        f.doc.image(image.buffer, f.left + 8, y + 22, {
          fit: [f.width - 16, boxH - 34],
          align: 'center',
          valign: 'center',
        });
      } catch {
        f.line('No se pudo incrustar esta imagen.', f.left, y + boxH / 2, {
          size: 8,
          color: C.muted,
          width: f.width,
          align: 'center',
        });
      }
    } else {
      f.line(
        'Este ticket es un PDF: no se incrusta (descárgalo desde la apuesta).',
        f.left,
        y + boxH / 2,
        { size: 8, color: C.muted, width: f.width, align: 'center' },
      );
    }
    f.y = y + boxH + 6;
  }
}
