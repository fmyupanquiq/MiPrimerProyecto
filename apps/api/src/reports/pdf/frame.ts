import { C, F } from './theme.js';
import { drawIcon, type IconName } from './icons.js';
import { fit } from './format.js';

/*
 * Marco de página del informe: cabecera (logo LetFer, proyecto y lema), pie (proyecto, tipo de
 * informe, periodo y «Pág. X de Y»), títulos de página y tarjetas. Lleva la cuenta de la posición
 * vertical y abre páginas nuevas cuando hace falta (nunca escribe sobre el pie).
 */

export const MARGIN = 34;
const HEADER_H = 40;
const FOOTER_H = 30;

export class Frame {
  readonly W: number;
  readonly H: number;
  readonly left = MARGIN;
  readonly right: number;
  readonly top = MARGIN + HEADER_H;
  readonly bottom: number;
  y: number;

  constructor(
    readonly doc: PDFKit.PDFDocument,
    readonly meta: { projectName: string; period: string; reportTitle: string; generated: string },
  ) {
    this.W = doc.page.width;
    this.H = doc.page.height;
    this.right = this.W - MARGIN;
    this.bottom = this.H - MARGIN - FOOTER_H;
    this.y = this.top;
    this.header();
  }

  /** Sin márgenes de pdfkit: el marco decide dónde escribir (así nunca abre páginas por su cuenta). */
  private noAutoPages(): void {
    this.doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  }

  get width(): number {
    return this.right - this.left;
  }

  get landscape(): boolean {
    return this.W > this.H;
  }

  newPage(): void {
    this.doc.addPage();
    this.header();
    this.y = this.top;
  }

  /** Abre una página nueva si no caben `height` puntos; devuelve si la abrió. */
  ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  /** Página actual (índice en el búfer de páginas). */
  page(): number {
    const range = this.doc.bufferedPageRange();
    return range.start + range.count - 1;
  }

  // --- Cabecera y pie --------------------------------------------------------------------------

  private header(): void {
    this.noAutoPages();
    const d = this.doc;
    const y = MARGIN - 8;
    logo(d, this.left, y, 18);
    d.font(F.bold).fontSize(11).fillColor(C.navy);
    const brandW = d.widthOfString('LetFer');
    d.text('LetFer', this.left + 24, y + 2.5, { lineBreak: false });
    d.font(F.regular)
      .fontSize(11)
      .fillColor(C.faint)
      .text('|', this.left + 24 + brandW + 5, y + 2.5, { lineBreak: false });
    d.font(F.semibold).fontSize(11).fillColor(C.brand);
    d.text(
      fit(d, this.meta.projectName, this.width * 0.45),
      this.left + 24 + brandW + 14,
      y + 2.5,
      { lineBreak: false },
    );
    d.font(F.medium).fontSize(7.5).fillColor(C.muted);
    d.text('Tus apuestas, un número más.', this.left, y + 6, {
      width: this.width,
      align: 'right',
      lineBreak: false,
    });
  }

  /** Pie de cada página; se escribe al final, cuando ya se conoce el total de páginas. */
  footers(): void {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      const y = this.H - MARGIN - 8;
      d.save()
        .moveTo(this.left, y - 9)
        .lineTo(this.right, y - 9)
        .lineWidth(0.6)
        .strokeColor(C.line)
        .stroke()
        .restore();
      d.font(F.bold)
        .fontSize(7.5)
        .fillColor(C.navy)
        .text('LetFer', this.left, y, { lineBreak: false });
      const w1 = d.widthOfString('LetFer');
      d.font(F.regular)
        .fillColor(C.faint)
        .text('|', this.left + w1 + 3, y, { lineBreak: false });
      d.font(F.semibold)
        .fillColor(C.brand)
        .text(fit(d, this.meta.projectName, 110), this.left + w1 + 10, y, { lineBreak: false });
      d.font(F.regular).fontSize(7).fillColor(C.muted);
      const middle = `${this.meta.reportTitle}   ·   ${this.meta.period}`;
      d.text(fit(d, middle, this.width - 250), this.left + 125, y + 0.5, {
        width: this.width - 250,
        align: 'center',
        lineBreak: false,
      });
      d.font(F.semibold).fontSize(7.5).fillColor(C.navy);
      d.text(`Pág. ${i - range.start + 1} de ${range.count}`, this.left, y, {
        width: this.width,
        align: 'right',
        lineBreak: false,
      });
    }
  }

  // --- Títulos y tarjetas ------------------------------------------------------------------------

  /** Título de página con barra violeta y subtítulo (páginas 2 en adelante). */
  pageTitle(title: string, subtitle: string): void {
    const d = this.doc;
    const y = this.y + 4;
    d.save()
      .roundedRect(this.left, y + 1, 3.5, 34, 1.75)
      .fill(C.brand)
      .restore();
    d.font(F.black)
      .fontSize(18)
      .fillColor(C.navy)
      .text(title, this.left + 12, y, { lineBreak: false });
    d.font(F.regular)
      .fontSize(9)
      .fillColor(C.muted)
      .text(subtitle, this.left + 12, y + 23, { width: this.width - 12, lineBreak: false });
    this.y = y + 46;
  }

  /** Tarjeta blanca con borde suave. */
  card(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { fill?: string; stroke?: string; radius?: number } = {},
  ): void {
    const d = this.doc;
    d.save()
      .roundedRect(x, y, w, h, opts.radius ?? 9)
      .fillColor(opts.fill ?? C.white)
      .strokeColor(opts.stroke ?? C.line)
      .lineWidth(0.8)
      .fillAndStroke()
      .restore();
  }

  /** Encabezado de bloque: icono violeta + título. Devuelve la altura usada. */
  blockTitle(x: number, y: number, icon: IconName, title: string, w?: number): number {
    const d = this.doc;
    drawIcon(d, icon, x, y - 0.5, 12, C.brand, 2.1);
    d.font(F.bold).fontSize(10.5).fillColor(C.navy);
    d.text(w ? fit(d, title, w - 18) : title, x + 17, y, { lineBreak: false });
    return 18;
  }

  /** Texto en una sola línea (sin saltos), con recorte si se indica un ancho. */
  line(
    text: string,
    x: number,
    y: number,
    opts: {
      font?: string;
      size?: number;
      color?: string;
      width?: number;
      align?: 'left' | 'right' | 'center';
    } = {},
  ): void {
    const d = this.doc;
    d.font(opts.font ?? F.regular)
      .fontSize(opts.size ?? 8)
      .fillColor(opts.color ?? C.text);
    const value = opts.width ? fit(d, text, opts.width) : text;
    d.text(value, x, y, {
      lineBreak: false,
      ...(opts.width ? { width: opts.width, align: opts.align ?? 'left' } : {}),
    });
  }
}

/** Logotipo vectorial de LetFer (cuadro violeta con la «L»). */
export function logo(d: PDFKit.PDFDocument, x: number, y: number, size: number): void {
  d.save()
    .roundedRect(x, y, size, size, size * 0.28)
    .fill(C.brand)
    .restore();
  d.font(F.black)
    .fontSize(size * 0.62)
    .fillColor(C.white)
    .text('L', x, y + size * 0.15, { width: size, align: 'center', lineBreak: false });
}
