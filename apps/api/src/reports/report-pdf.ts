import {
  formatOdds,
  formatPEN,
  type BetStatus,
  type BetType,
  type ReportBet,
  type ReportData,
  type ReportFilters,
  type ReportGroupBy,
  type ReportSection,
  type ReportSortBy,
  sortReportBets,
} from '@letfer/shared';
import PDFDocument from 'pdfkit';

/*
 * Plantilla del informe PDF de LetFer (§108.11; referencia
 * `docs/referencias/Referencias mockups/Reportes/Vista de reportes en PDF.png`). Documento claro,
 * con texto seleccionable (fuentes estándar Helvetica, sin archivos externos), paginado y con
 * cabecera y pie en cada página. SOLO presenta los datos de `ReportData`: no calcula ninguna
 * métrica financiera (las cifras llegan ya calculadas del análisis y del ledger).
 */

export interface ReportTicketImage {
  betId: string;
  /** `null` si el ticket no es una imagen incrustable (p. ej. un PDF). */
  buffer: Buffer | null;
}

export interface ReportPdfInput {
  data: ReportData;
  projectName: string;
  currency: string;
  timeZone: string;
  generatedBy: string;
  filters: ReportFilters;
  /** Nombres legibles de los filtros por id (casa, etapa). */
  filterNames?: { house?: string; stage?: string };
  periodLabel: string | null;
  sections: readonly ReportSection[];
  groupBy: ReportGroupBy;
  sortBy: ReportSortBy;
  direction: 'asc' | 'desc';
  orientation: 'portrait' | 'landscape';
  paper: 'A4' | 'LETTER';
  /** `null` si no se pidieron o no hay permiso de tickets. */
  ticketImages: ReportTicketImage[] | null;
  ticketsAllowed: boolean;
  /** Solo para pruebas: sin compresión, el texto del PDF se puede inspeccionar. */
  compress?: boolean;
}

// --- Paleta (clara, para pantalla e impresión) -----------------------------------------------------
const C = {
  brand: '#7c3aed',
  brandDark: '#5b21b6',
  brandSoft: '#f5f3ff',
  brandLine: '#ddd6fe',
  ink: '#0f172a',
  text: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  zebra: '#f8fafc',
  green: '#15803d',
  greenSoft: '#ecfdf5',
  greenLine: '#bbf7d0',
  red: '#b91c1c',
  redSoft: '#fef2f2',
  redLine: '#fecaca',
  amber: '#b45309',
  amberSoft: '#fffbeb',
  blue: '#1d4ed8',
  blueSoft: '#eff6ff',
  slateSoft: '#f1f5f9',
};
const STATUS_STYLE: Record<BetStatus, { label: string; fg: string; bg: string; chart: string }> = {
  WON: { label: 'Ganada', fg: C.green, bg: '#dcfce7', chart: '#22c55e' },
  LOST: { label: 'Perdida', fg: C.red, bg: '#fee2e2', chart: '#ef4444' },
  PENDING: { label: 'Pendiente', fg: C.amber, bg: '#fef3c7', chart: '#eab308' },
  VOID: { label: 'Anulada', fg: '#475569', bg: '#e2e8f0', chart: '#94a3b8' },
  CASHOUT: { label: 'Cash Out', fg: C.blue, bg: '#dbeafe', chart: '#3b82f6' },
};
const STATUS_ORDER: BetStatus[] = ['WON', 'LOST', 'PENDING', 'VOID', 'CASHOUT'];
const BET_TYPE_LABEL: Record<BetType, string> = {
  SIMPLE: 'Simple',
  CREATED: 'Creada',
  MULTIPLE: 'Múltiple',
};
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const MARGIN = 36;
const HEADER_H = 46;
const FOOTER_H = 30;
/** Alto que ocupa `sectionTitle` con subtítulo de una línea. */
const TITLE_BLOCK_H = 46;

type Doc = PDFKit.PDFDocument;

// --- Formatos (presentación) -------------------------------------------------------------------------
function signedPEN(value: string): string {
  if (value.startsWith('-')) return `-${formatPEN(value.slice(1))}`;
  if (/^0+(\.0+)?$/.test(value)) return formatPEN(value);
  return `+${formatPEN(value)}`;
}
const percent = (value: string | null, signed = true) =>
  value === null
    ? '—'
    : `${signed && !value.startsWith('-') && !/^0+(\.0+)?$/.test(value) ? '+' : ''}${value} %`;
/** Porcentaje con UN decimal (redondeo sobre la cadena, sin coma flotante), para tablas estrechas. */
function pct1(value: string | null, signed = true): string {
  if (value === null) return '—';
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace(/^[-+]/, '').split('.');
  const hundredths = BigInt(int) * 100n + BigInt(`${frac}00`.slice(0, 2));
  const tenths = (hundredths + 5n) / 10n;
  const text = `${tenths / 10n}.${tenths % 10n}`;
  if (tenths === 0n) return `${text} %`;
  return `${negative ? '-' : signed ? '+' : ''}${text} %`;
}
const tone = (value: string | null) =>
  value === null || /^-?0+(\.0+)?$/.test(value) ? C.ink : value.startsWith('-') ? C.red : C.green;
function dateParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts['day']}/${parts['month']}/${parts['year']}`,
    time: `${parts['hour']}:${parts['minute']}`,
  };
}

/** Recorta un texto a un ancho con «…» (una línea). */
function fit(doc: Doc, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function roundedBox(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
) {
  doc.save().roundedRect(x, y, w, h, 6).fillColor(fill);
  if (stroke) doc.strokeColor(stroke).lineWidth(0.6).fillAndStroke();
  else doc.fill();
  doc.restore();
}

function logo(doc: Doc, x: number, y: number, size = 20) {
  doc
    .save()
    .roundedRect(x, y, size, size, size * 0.24)
    .fill(C.brand);
  doc
    .fillColor('#ffffff')
    .font(BOLD)
    .fontSize(size * 0.6)
    .text('L', x, y + size * 0.2, { width: size, align: 'center', lineBreak: false });
  doc
    .fillColor(C.ink)
    .font(BOLD)
    .fontSize(size * 0.68)
    .text('LetFer', x + size + 7, y + size * 0.16, { lineBreak: false });
  doc.restore();
}

// --- Documento -------------------------------------------------------------------------------------

/** Genera el PDF del reporte. Devuelve el archivo completo en memoria. */
export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: input.paper === 'LETTER' ? 'LETTER' : 'A4',
    layout: input.orientation,
    margin: MARGIN,
    bufferPages: true,
    compress: input.compress ?? true,
    info: {
      Title: `Reporte de apuestas — ${input.projectName}`,
      Author: 'LetFer',
      Subject: 'Reporte de apuestas',
      Creator: 'LetFer',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const r = new Renderer(doc, input);
  r.render();
  doc.end();
  return done;
}

class Renderer {
  private readonly W: number;
  private readonly H: number;
  private readonly left = MARGIN;
  private readonly right: number;
  private readonly contentTop = MARGIN + HEADER_H;
  private readonly contentBottom: number;
  private readonly generated: { date: string; time: string };
  private readonly period: string;

  constructor(
    private readonly doc: Doc,
    private readonly input: ReportPdfInput,
  ) {
    this.W = doc.page.width;
    this.H = doc.page.height;
    this.right = this.W - MARGIN;
    this.contentBottom = this.H - MARGIN - FOOTER_H;
    this.generated = dateParts(input.data.generatedAt, input.timeZone);
    this.period = input.periodLabel ?? this.defaultPeriod();
  }

  private get width() {
    return this.right - this.left;
  }

  private defaultPeriod(): string {
    const { from, to } = this.input.filters;
    if (!from && !to) return 'Todo el historial';
    const f = from ? dateParts(from, this.input.timeZone).date : '…';
    const t = to ? dateParts(to, this.input.timeZone).date : '…';
    return `${f} - ${t}`;
  }

  render() {
    const { sections } = this.input;
    this.header();
    this.cover(sections.includes('summary'));
    if (sections.includes('charts') || sections.includes('metrics')) {
      this.newPage();
      this.analysisPage(sections.includes('charts'), sections.includes('metrics'));
    }
    if (sections.includes('table')) {
      this.newPage();
      this.detail(sections.includes('selections'));
    }
    if (sections.includes('tickets')) {
      this.newPage();
      this.ticketsAnnex();
    }
    this.footers();
  }

  // --- Marco de página ---------------------------------------------------------------------------
  private newPage() {
    this.doc.addPage();
    this.header();
    this.doc.y = this.contentTop;
  }

  private header() {
    const d = this.doc;
    logo(d, this.left, MARGIN - 6, 22);
    d.font(BOLD).fontSize(9).fillColor(C.ink);
    d.text('Reporte de apuestas', this.left, MARGIN - 4, {
      width: this.width,
      align: 'right',
      lineBreak: false,
    });
    d.font(FONT).fontSize(8).fillColor(C.muted);
    const label = 'Proyecto: ';
    const name = this.input.projectName;
    const total = d.widthOfString(label) + d.font(BOLD).widthOfString(name);
    const x0 = this.right - total;
    d.font(FONT)
      .fillColor(C.muted)
      .text(label, x0, MARGIN + 8, { lineBreak: false });
    d.font(BOLD)
      .fillColor(C.brand)
      .text(name, x0 + d.font(FONT).widthOfString(label), MARGIN + 8, {
        lineBreak: false,
      });
    d.y = this.contentTop;
  }

  /** Pie con el proyecto, la fecha de generación y «Página X de Y» (al final, ya paginado). */
  private footers() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      const y = this.H - MARGIN - 10;
      d.save()
        .moveTo(this.left, y - 8)
        .lineTo(this.right, y - 8)
        .lineWidth(0.5)
        .strokeColor(C.line)
        .stroke()
        .restore();
      d.font(FONT).fontSize(7.5).fillColor(C.muted);
      d.text(
        `Proyecto: ${this.input.projectName}   |   Reporte de apuestas   |   Generado el ${this.generated.date}, ${this.generated.time}`,
        this.left,
        y,
        { lineBreak: false },
      );
      d.text(`Página ${i - range.start + 1} de ${range.count}`, this.left, y, {
        width: this.width,
        align: 'right',
        lineBreak: false,
      });
    }
  }

  private ensure(height: number): boolean {
    if (this.doc.y + height <= this.contentBottom) return false;
    this.newPage();
    return true;
  }

  private sectionTitle(title: string, subtitle?: string, right?: string) {
    const d = this.doc;
    const y = d.y;
    d.font(BOLD).fontSize(17).fillColor(C.ink).text(title, this.left, y, { lineBreak: false });
    if (right) {
      d.font(FONT)
        .fontSize(8.5)
        .fillColor(C.muted)
        .text(right, this.left, y + 5, {
          width: this.width,
          align: 'right',
          lineBreak: false,
        });
    }
    d.y = y + 22;
    if (subtitle) {
      d.font(FONT)
        .fontSize(8.5)
        .fillColor(C.muted)
        .text(subtitle, this.left, d.y, { width: this.width });
      d.y += 4;
    }
    d.y += 6;
  }

  // --- Página 1: portada y resumen -----------------------------------------------------------------
  private cover(withSummary: boolean) {
    const d = this.doc;
    const { data } = this.input;
    const n = data.totals.bets;
    const top = this.contentTop + 6;
    const infoW = Math.min(205, this.width * 0.38);
    const titleW = this.width - infoW - 20;

    d.font(BOLD).fontSize(28).fillColor(C.ink).text('Reporte de apuestas', this.left, top, {
      width: titleW,
    });
    d.font(FONT)
      .fontSize(15)
      .fillColor(C.text)
      .text(`Resumen completo de ${n} ${n === 1 ? 'apuesta' : 'apuestas'}`, this.left, d.y + 2, {
        width: titleW,
      });
    d.font(FONT)
      .fontSize(9)
      .fillColor(C.muted)
      .text(
        'Análisis detallado del rendimiento de tus apuestas, con estadísticas, gráficos y el registro completo del periodo seleccionado.',
        this.left,
        d.y + 8,
        { width: titleW * 0.92, lineGap: 2 },
      );
    const titleBottom = d.y;

    // Tarjeta de identificación (proyecto, periodo, generación).
    const infoX = this.right - infoW;
    const rows: [string, string, string?][] = [
      ['Proyecto', this.input.projectName],
      [
        'Periodo',
        this.period,
        this.input.filters.from || this.input.filters.to ? this.input.timeZone : undefined,
      ],
      ['Generado el', `${this.generated.date}, ${this.generated.time}`],
      ['Generado por', this.input.generatedBy],
    ];
    const rowH = 33;
    roundedBox(d, infoX, top - 4, infoW, rows.length * rowH + 12, C.brandSoft, C.brandLine);
    rows.forEach(([label, value, extra], i) => {
      const y = top + 4 + i * rowH;
      d.save()
        .roundedRect(infoX + 10, y + 2, 20, 20, 5)
        .fill('#ede9fe')
        .restore();
      d.save()
        .circle(infoX + 20, y + 12, 3.2)
        .fill(C.brand)
        .restore();
      d.font(FONT)
        .fontSize(7)
        .fillColor(C.muted)
        .text(label, infoX + 38, y, { lineBreak: false });
      d.font(BOLD)
        .fontSize(9)
        .fillColor(C.ink)
        .text(fit(d, value, infoW - 48), infoX + 38, y + 10, { lineBreak: false });
      if (extra) {
        d.font(FONT)
          .fontSize(6.5)
          .fillColor(C.muted)
          .text(extra, infoX + 38, y + 21, { lineBreak: false });
      }
    });

    d.y = Math.max(titleBottom, top + rows.length * rowH + 14) + 14;
    this.filtersBox();
    if (withSummary) this.summaryCards();
    this.banner();
  }

  private filtersBox() {
    const d = this.doc;
    const { filters, filterNames } = this.input;
    const status = filters.status ? STATUS_STYLE[filters.status].label : 'Todos';
    const items: [string, string][] = [
      ['Casa de apuestas', filterNames?.house ?? (filters.houseId ? 'Una casa' : 'Todas')],
      ['Tipo de apuesta', filters.betType ? BET_TYPE_LABEL[filters.betType] : 'Todos'],
      ['Resultado', status],
      [
        'Origen del registro',
        filters.origin ? (filters.origin === 'MANUAL' ? 'Manual' : 'Importada') : 'Todos',
      ],
      ['Deporte', filters.sport ?? 'Todos'],
      ['Mercado', filters.market ?? 'Todos'],
      ['Etapa', filterNames?.stage ?? (filters.stageId ? 'Una etapa' : 'Todas')],
      [
        'Rango de fechas',
        `${this.period}${filters.from || filters.to ? ` (${this.input.timeZone})` : ''}`,
      ],
    ];
    const x = this.left;
    const y = d.y;
    const lineH = 15;
    const h = 30 + Math.ceil(items.length / 2) * lineH + 22;
    roundedBox(d, x, y, this.width, h, C.brandSoft, C.brandLine);
    d.font(BOLD)
      .fontSize(10)
      .fillColor(C.ink)
      .text('Filtros aplicados', x + 12, y + 10, { lineBreak: false });
    const colW = (this.width - 24) / 2;
    items.forEach(([label, value], i) => {
      const cx = x + 12 + (i % 2) * colW;
      const cy = y + 30 + Math.floor(i / 2) * lineH;
      d.save()
        .circle(cx + 3, cy + 4, 2)
        .fill(C.brand)
        .restore();
      d.font(FONT)
        .fontSize(8)
        .fillColor(C.text)
        .text(label, cx + 10, cy, { lineBreak: false });
      d.font(FONT)
        .fontSize(8)
        .fillColor(C.muted)
        .text(fit(d, value, colW - 120), cx + 112, cy, { lineBreak: false });
    });
    d.font(FONT)
      .fontSize(7)
      .fillColor(C.muted)
      .text(
        'Fechas: una apuesta liquidada cuenta por su fecha de liquidación; una pendiente, por la de colocación.',
        x + 12,
        y + h - 16,
        { width: this.width - 24, lineBreak: false },
      );
    d.y = y + h + 14;
  }

  private summaryCards() {
    const d = this.doc;
    const { analysis, totals } = this.input.data;
    const decided = analysis.counts.won + analysis.counts.lost;
    d.font(BOLD)
      .fontSize(11)
      .fillColor(C.ink)
      .text('Resumen general', this.left, d.y, { lineBreak: false });
    d.y += 18;
    const cards: {
      value: string;
      title: string;
      caption: string;
      color: string;
      sign: string | null;
    }[] = [
      {
        value: String(totals.bets),
        title: totals.bets === 1 ? 'apuesta' : 'apuestas',
        caption: `Total del periodo · ${analysis.counts.pending} ${analysis.counts.pending === 1 ? 'pendiente' : 'pendientes'}`,
        color: C.ink,
        sign: null,
      },
      {
        value: formatPEN(totals.stakedSettled),
        title: 'Monto apostado',
        caption:
          totals.stakedPending === '0.00'
            ? 'De las apuestas liquidadas'
            : `Liquidadas · ${formatPEN(totals.stakedPending)} en pendientes`,
        color: C.ink,
        sign: null,
      },
      {
        value: signedPEN(analysis.profitLoss),
        title: 'Ganancia/Pérdida neta',
        caption:
          analysis.unconfirmedReturns.count > 0
            ? `Incluye ${signedPEN(analysis.unconfirmedReturns.profitLoss)} provisional`
            : 'Resultado de las liquidadas',
        color: tone(analysis.profitLoss),
        sign: analysis.profitLoss,
      },
      {
        value: percent(analysis.roi),
        title: 'ROI',
        caption: 'Ganancia ÷ capital invertido',
        color: tone(analysis.roi),
        sign: analysis.roi,
      },
      {
        value: percent(analysis.yield),
        title: 'Yield',
        caption: 'Ganancia ÷ monto apostado',
        color: tone(analysis.yield),
        sign: analysis.yield,
      },
      {
        value: percent(analysis.winRate, false),
        title: 'Win rate',
        caption:
          decided > 0
            ? `${analysis.counts.won} de ${decided} apuestas decididas`
            : 'Sin apuestas decididas',
        color: C.ink,
        sign: null,
      },
    ];
    const gap = 9;
    const cols = 3;
    const w = (this.width - gap * (cols - 1)) / cols;
    const h = 58;
    const baseY = d.y;
    cards.forEach((card, i) => {
      const x = this.left + (i % cols) * (w + gap);
      const y = baseY + Math.floor(i / cols) * (h + gap);
      const negative = card.sign !== null && card.sign.startsWith('-');
      const positive = card.sign !== null && !negative && !/^0+(\.0+)?$/.test(card.sign);
      roundedBox(
        d,
        x,
        y,
        w,
        h,
        negative ? C.redSoft : positive ? C.greenSoft : C.brandSoft,
        negative ? C.redLine : positive ? C.greenLine : C.brandLine,
      );
      d.save()
        .roundedRect(x + 10, y + 14, 26, 26, 6)
        .fill(negative ? '#fee2e2' : positive ? '#dcfce7' : '#ede9fe')
        .restore();
      d.save()
        .rect(x + 18, y + 26, 3, 8)
        .rect(x + 22.5, y + 22, 3, 12)
        .rect(x + 27, y + 19, 3, 15)
        .fill(negative ? C.red : positive ? C.green : C.brand)
        .restore();
      d.font(BOLD)
        .fontSize(15)
        .fillColor(card.color)
        .text(fit(d, card.value, w - 56), x + 44, y + 10, { lineBreak: false });
      d.font(BOLD)
        .fontSize(8.5)
        .fillColor(C.ink)
        .text(card.title, x + 44, y + 29, { lineBreak: false });
      d.font(FONT)
        .fontSize(7)
        .fillColor(C.muted)
        .text(fit(d, card.caption, w - 52), x + 44, y + 41, { lineBreak: false });
    });
    d.y = baseY + 2 * h + gap + 14;
  }

  private banner() {
    const d = this.doc;
    const h = 40;
    const y = Math.min(d.y, this.contentBottom - h - 4);
    if (y < d.y - 1) return;
    const grad = d.linearGradient(this.left, y, this.right, y);
    grad.stop(0, '#4c1d95').stop(1, '#7c3aed');
    d.save().roundedRect(this.left, y, this.width, h, 7).fill(grad).restore();
    d.save()
      .rect(this.left + 14, y + 22, 4, 10)
      .rect(this.left + 20, y + 15, 4, 17)
      .rect(this.left + 26, y + 9, 4, 23)
      .fill('#ddd6fe')
      .restore();
    d.font(BOLD)
      .fontSize(11)
      .fillColor('#ffffff')
      .text('LetFer', this.left + 40, y + 9, { lineBreak: false });
    d.font(FONT)
      .fontSize(7.5)
      .fillColor('#ede9fe')
      .text('Control total de tus apuestas', this.left + 40, y + 23, {
        lineBreak: false,
      });
    d.font(FONT)
      .fontSize(8.5)
      .fillColor('#ffffff')
      .text('Analiza. Aprende. Mejora.', this.left, y + 16, {
        width: this.width - 16,
        align: 'right',
        lineBreak: false,
      });
    d.y = y + h + 8;
  }

  // --- Página 2: análisis --------------------------------------------------------------------------
  private analysisPage(withCharts: boolean, withMetrics: boolean) {
    const d = this.doc;
    const n = this.input.data.totals.bets;
    this.sectionTitle(
      'Análisis y estadísticas',
      `Rendimiento de tus ${n} ${n === 1 ? 'apuesta' : 'apuestas'} con gráficos y métricas clave.`,
      `Periodo: ${this.period}`,
    );
    const gap = 12;
    const landscape = this.input.orientation === 'landscape';
    const leftW = (this.width - gap) * 0.58;
    const rightW = this.width - gap - leftW;
    const rowH = landscape ? 170 : 200;
    if (withCharts) {
      const y = d.y;
      this.card(
        this.left,
        y,
        leftW,
        rowH,
        'Rendimiento acumulado',
        'Evolución de la ganancia/pérdida neta, apuesta liquidada a apuesta liquidada.',
      );
      this.lineChart(this.left + 12, y + 44, leftW - 24, rowH - 56);
      this.card(
        this.left + leftW + gap,
        y,
        rightW,
        rowH,
        'Distribución por resultado',
        `Total de apuestas: ${n}`,
      );
      this.donut(this.left + leftW + gap + 12, y + 44, rightW - 24, rowH - 56);
      d.y = y + rowH + gap;
    }
    if (withMetrics) {
      const leftW = (this.width - gap) * 0.5;
      const rightW = this.width - gap - leftW;
      const houses = this.input.data.analysis.byHouse;
      const types = this.input.data.byBetType;
      const listH = Math.max(110, 52 + Math.min(houses.length, 8) * 21);
      const typeH = Math.max(110, 64 + types.length * 22 + 26);
      const h = Math.max(listH, typeH);
      this.ensure(h);
      const y = d.y;
      this.card(
        this.left,
        y,
        leftW,
        h,
        'Apuestas por casa',
        'Apuestas liquidadas y monto apostado por casa.',
      );
      this.houseBars(this.left + 12, y + 46, leftW - 24, houses);
      this.card(
        this.left + leftW + gap,
        y,
        rightW,
        h,
        'Resumen por tipo de apuesta',
        'Rendimiento según el tipo de apuesta.',
      );
      this.typeTable(this.left + leftW + gap + 12, y + 46, rightW - 24);
      d.y = y + h + gap;
    }
  }

  private card(x: number, y: number, w: number, h: number, title: string, subtitle: string) {
    const d = this.doc;
    roundedBox(d, x, y, w, h, '#ffffff', C.line);
    d.font(BOLD)
      .fontSize(10)
      .fillColor(C.ink)
      .text(title, x + 12, y + 12, { lineBreak: false });
    d.font(FONT)
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(fit(d, subtitle, w - 24), x + 12, y + 26, { lineBreak: false });
  }

  private emptyNote(x: number, y: number, w: number, h: number, text: string) {
    this.doc
      .font(FONT)
      .fontSize(8.5)
      .fillColor(C.faint)
      .text(text, x, y + h / 2 - 5, { width: w, align: 'center' });
  }

  private lineChart(x: number, y: number, w: number, h: number) {
    const d = this.doc;
    const points = this.input.data.cumulative;
    if (points.length === 0) {
      this.emptyNote(x, y, w, h, 'Aún no hay apuestas liquidadas en este periodo.');
      return;
    }
    // Posiciones solo para dibujar: las cifras se rotulan con las cadenas originales.
    const values = [0, ...points.map((p) => Number(p.cumulative))];
    const { ticks, low, high } = niceAxis(values);
    const axisW = 44;
    const px = x + axisW;
    const pw = w - axisW - 8;
    const ph = h - 18;
    const sx = (i: number) =>
      px + (points.length <= 1 ? pw / 2 : ((i - 1) / (points.length - 1)) * pw);
    const sy = (v: number) => y + ph - ((v - low) / (high - low || 1)) * ph;
    d.font(FONT).fontSize(6.5).fillColor(C.muted);
    for (const t of ticks) {
      const ty = sy(t);
      d.save()
        .moveTo(px, ty)
        .lineTo(px + pw, ty)
        .dash(2, { space: 2 })
        .lineWidth(0.4)
        .strokeColor(C.line)
        .stroke()
        .undash()
        .restore();
      d.text(`S/ ${Math.round(t).toLocaleString('en-US')}`, x, ty - 3, {
        width: axisW - 6,
        align: 'right',
        lineBreak: false,
      });
    }
    if (low < 0 && high > 0) {
      d.save()
        .moveTo(px, sy(0))
        .lineTo(px + pw, sy(0))
        .lineWidth(0.6)
        .strokeColor(C.faint)
        .stroke()
        .restore();
    }
    // Área y línea.
    const coords = points.map((p) => [sx(p.index), sy(Number(p.cumulative))] as const);
    d.save();
    d.moveTo(coords[0]![0], sy(Math.max(low, 0)));
    for (const [cx, cy] of coords) d.lineTo(cx, cy);
    d.lineTo(coords.at(-1)![0], sy(Math.max(low, 0)))
      .closePath()
      .fillOpacity(0.12)
      .fill(C.brand);
    d.restore();
    d.save().moveTo(coords[0]![0], coords[0]![1]);
    for (const [cx, cy] of coords.slice(1)) d.lineTo(cx, cy);
    d.lineWidth(1.4).strokeColor(C.brand).stroke().restore();
    const last = points.at(-1)!;
    const [lx, ly] = coords.at(-1)!;
    d.save().circle(lx, ly, 2.6).fill(tone(last.cumulative)).restore();
    const label = signedPEN(last.cumulative);
    d.font(BOLD).fontSize(7.5);
    const lw = d.widthOfString(label) + 10;
    const bx = Math.min(lx - lw / 2, px + pw - lw);
    const by = Math.max(y, ly - 26);
    roundedBox(d, bx, by, lw, 20, '#ffffff', C.line);
    d.fillColor(tone(last.cumulative)).text(label, bx, by + 3, {
      width: lw,
      align: 'center',
      lineBreak: false,
    });
    d.font(FONT)
      .fontSize(5.5)
      .fillColor(C.muted)
      .text('Resultado final', bx, by + 12.5, { width: lw, align: 'center', lineBreak: false });
    // Eje X: número de apuesta liquidada.
    d.font(FONT).fontSize(6.5).fillColor(C.muted);
    const step = Math.max(1, Math.ceil(points.length / 10));
    for (let i = 1; i <= points.length; i += step) {
      d.text(String(i), sx(i) - 10, y + ph + 6, { width: 20, align: 'center', lineBreak: false });
    }
  }

  private donut(x: number, y: number, w: number, h: number) {
    const d = this.doc;
    const { counts } = this.input.data.analysis;
    const total = counts.total;
    const size = Math.min(h, w * 0.36);
    const cx = x + size / 2 + 4;
    const cy = y + h / 2;
    const ro = size / 2;
    const ri = ro * 0.62;
    const key: Record<BetStatus, keyof typeof counts> = {
      WON: 'won',
      LOST: 'lost',
      PENDING: 'pending',
      VOID: 'void',
      CASHOUT: 'cashout',
    };
    if (total === 0) {
      d.save()
        .circle(cx, cy, ro)
        .lineWidth(ro - ri)
        .strokeColor(C.slateSoft)
        .stroke()
        .restore();
    } else {
      let angle = -Math.PI / 2;
      for (const status of STATUS_ORDER) {
        const value = counts[key[status]];
        if (value === 0) continue;
        const sweep = (value / total) * Math.PI * 2;
        donutSlice(d, cx, cy, ro, ri, angle, angle + sweep, STATUS_STYLE[status].chart);
        angle += sweep;
      }
    }
    d.font(BOLD)
      .fontSize(15)
      .fillColor(C.ink)
      .text(String(total), cx - ri, cy - 11, { width: ri * 2, align: 'center', lineBreak: false });
    d.font(FONT)
      .fontSize(7)
      .fillColor(C.muted)
      .text('apuestas', cx - ri, cy + 6, { width: ri * 2, align: 'center', lineBreak: false });
    // Leyenda.
    const lx = x + size + 12;
    const lw = x + w - lx;
    const pctW = 34;
    const countW = 16;
    const names = STATUS_ORDER.map((st) =>
      st === 'CASHOUT' ? 'Cash Out' : `${STATUS_STYLE[st].label}s`,
    );
    d.font(FONT).fontSize(8);
    const labelW = Math.max(...names.map((nm) => d.widthOfString(nm)));
    // Conteo y porcentaje alineados a la derecha DENTRO de la tarjeta (nunca fuera de su borde).
    const countX = Math.max(lx + 13 + labelW + 4, lx + lw - pctW - countW - 2);
    STATUS_ORDER.forEach((status, i) => {
      const ly = cy - 44 + i * 19;
      const value = counts[key[status]];
      // Porcentaje de un conteo, solo para mostrar.
      const pct = total === 0 ? '0.0' : ((value / total) * 100).toFixed(1);
      const name = status === 'CASHOUT' ? 'Cash Out' : `${STATUS_STYLE[status].label}s`;
      d.save()
        .circle(lx + 4, ly + 4, 3.5)
        .fill(STATUS_STYLE[status].chart)
        .restore();
      d.font(FONT)
        .fontSize(8)
        .fillColor(C.text)
        .text(name, lx + 13, ly, { lineBreak: false });
      d.font(BOLD)
        .fontSize(8)
        .fillColor(C.ink)
        .text(String(value), countX, ly, { width: countW, align: 'right', lineBreak: false });
      d.font(FONT)
        .fontSize(7.5)
        .fillColor(C.muted)
        .text(`(${pct} %)`, countX + countW + 2, ly + 0.5, {
          width: Math.max(pctW, lx + lw - countX - countW - 2),
          align: 'right',
          lineBreak: false,
        });
    });
  }

  private houseBars(x: number, y: number, w: number, houses: ReportData['analysis']['byHouse']) {
    const d = this.doc;
    if (houses.length === 0) {
      this.emptyNote(x, y, w, 60, 'Sin apuestas liquidadas en este periodo.');
      return;
    }
    const sorted = [...houses]
      .sort((a, b) => Number(b.totalStaked) - Number(a.totalStaked))
      .slice(0, 8);
    const max = Math.max(...sorted.map((h) => Number(h.totalStaked)), 1);
    const nameW = 78;
    const countW = 24;
    const amountW = 62;
    const barW = w - nameW - countW - amountW - 12;
    sorted.forEach((house, i) => {
      const ry = y + i * 21;
      d.font(FONT)
        .fontSize(8)
        .fillColor(C.text)
        .text(fit(d, house.key, nameW - 4), x, ry + 2, { lineBreak: false });
      d.font(BOLD)
        .fontSize(8)
        .fillColor(C.ink)
        .text(String(house.count), x + nameW, ry + 2, {
          width: countW - 4,
          align: 'right',
          lineBreak: false,
        });
      const bx = x + nameW + countW + 4;
      d.save()
        .roundedRect(bx, ry + 1, barW, 10, 3)
        .fill(C.slateSoft)
        .restore();
      const fillW = Math.max(3, (Number(house.totalStaked) / max) * barW);
      d.save()
        .roundedRect(bx, ry + 1, fillW, 10, 3)
        .fill(C.brand)
        .restore();
      d.font(FONT)
        .fontSize(8)
        .fillColor(C.text)
        .text(formatPEN(house.totalStaked), x, ry + 2, {
          width: w,
          align: 'right',
          lineBreak: false,
        });
    });
    if (houses.length > sorted.length) {
      d.font(FONT)
        .fontSize(7)
        .fillColor(C.muted)
        .text(`Y ${houses.length - sorted.length} casas más.`, x, y + sorted.length * 21 + 2, {
          lineBreak: false,
        });
    }
  }

  private typeTable(x: number, y: number, w: number) {
    const d = this.doc;
    const rows = this.input.data.byBetType;
    const cols = [
      { label: 'Tipo', w: w * 0.22, align: 'left' as const },
      { label: 'Apuestas', w: w * 0.19, align: 'right' as const },
      { label: 'Win rate', w: w * 0.19, align: 'right' as const },
      { label: 'ROI', w: w * 0.19, align: 'right' as const },
      { label: 'Yield', w: w * 0.21, align: 'right' as const },
    ];
    d.save().rect(x, y, w, 18).fill(C.slateSoft).restore();
    let cx = x;
    d.font(BOLD).fontSize(7.5).fillColor(C.text);
    for (const c of cols) {
      d.text(c.label, cx + 3, y + 5, { width: c.w - 6, align: c.align, lineBreak: false });
      cx += c.w;
    }
    if (rows.length === 0) {
      this.emptyNote(x, y + 18, w, 50, 'Sin apuestas en este periodo.');
      return;
    }
    rows.forEach((row, i) => {
      const ry = y + 18 + i * 22;
      if (i > 0)
        d.save()
          .moveTo(x, ry)
          .lineTo(x + w, ry)
          .lineWidth(0.4)
          .strokeColor(C.line)
          .stroke()
          .restore();
      const cells = [
        { text: BET_TYPE_LABEL[row.betType], color: C.text },
        { text: String(row.bets), color: C.text },
        { text: pct1(row.winRate, false), color: C.text },
        { text: pct1(row.roi), color: tone(row.roi) },
        { text: pct1(row.yield), color: tone(row.yield) },
      ];
      let x2 = x;
      cells.forEach((cell, j) => {
        d.font(FONT)
          .fontSize(7.8)
          .fillColor(cell.color)
          .text(cell.text, x2 + 3, ry + 7, {
            width: cols[j]!.w - 6,
            align: cols[j]!.align,
            lineBreak: false,
          });
        x2 += cols[j]!.w;
      });
    });
    const avg = this.input.data.analysis.averageOdds;
    d.font(FONT)
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(
        `Cuota media de las liquidadas: ${avg === null ? '—' : formatOdds(avg)}`,
        x,
        y + 18 + rows.length * 22 + 10,
        { lineBreak: false },
      );
  }

  // --- Detalle de apuestas -------------------------------------------------------------------------
  private sortedBets(): { group: string | null; bets: ReportBet[] }[] {
    const { sortBy, direction, groupBy, timeZone } = this.input;
    // El mismo orden que el panel (`sortReportBets`, de @letfer/shared).
    const bets = sortReportBets(this.input.data.bets, sortBy, direction);
    if (groupBy === 'none') return [{ group: null, bets }];
    const label = (b: ReportBet) =>
      groupBy === 'house'
        ? b.houseName
        : groupBy === 'status'
          ? STATUS_STYLE[b.status].label
          : groupBy === 'betType'
            ? BET_TYPE_LABEL[b.betType]
            : dateParts(b.placedAt, timeZone).date.slice(3);
    const groups = new Map<string, ReportBet[]>();
    for (const b of bets) groups.set(label(b), [...(groups.get(label(b)) ?? []), b]);
    return [...groups.entries()].map(([group, list]) => ({
      group: groupBy === 'date' ? `Mes ${group}` : group,
      bets: list,
    }));
  }

  private columns() {
    const fixed = {
      n: 24,
      date: 46,
      house: 50,
      stake: 28,
      amount: 46,
      odds: 32,
      result: 48,
      profit: 52,
    };
    const fixedW = Object.values(fixed).reduce((a, b) => a + b, 0);
    const flex = this.width - fixedW;
    const event = flex * 0.52;
    const pick = flex - event;
    return [
      { key: 'n', label: '#', w: fixed.n, align: 'left' as const },
      { key: 'date', label: 'Fecha', w: fixed.date, align: 'left' as const },
      { key: 'house', label: 'Casa', w: fixed.house, align: 'left' as const },
      { key: 'event', label: 'Partido', w: event, align: 'left' as const },
      { key: 'pick', label: 'Pronóstico / Mercado', w: pick, align: 'left' as const },
      { key: 'stake', label: 'Stake', w: fixed.stake, align: 'right' as const },
      { key: 'amount', label: 'Monto', w: fixed.amount, align: 'right' as const },
      { key: 'odds', label: 'Cuota', w: fixed.odds, align: 'right' as const },
      { key: 'result', label: 'Resultado', w: fixed.result, align: 'center' as const },
      { key: 'profit', label: 'Ganancia', w: fixed.profit, align: 'right' as const },
    ];
  }

  private tableHeader(cols: ReturnType<Renderer['columns']>) {
    const d = this.doc;
    const y = d.y;
    d.save().rect(this.left, y, this.width, 18).fill(C.brandSoft).restore();
    let x = this.left;
    d.font(BOLD).fontSize(7).fillColor(C.text);
    for (const c of cols) {
      d.text(c.label, x + 3, y + 5.5, { width: c.w - 6, align: c.align, lineBreak: false });
      x += c.w;
    }
    d.y = y + 18;
  }

  /**
   * Bloques de las celdas «Partido» y «Pronóstico / Mercado»: uno por leg (con su cuota UNA vez) y,
   * a su lado, sus condiciones. Los textos largos pasan a varias líneas: nunca se cortan nombres.
   */
  private betBlocks(
    b: ReportBet,
    withSelections: boolean,
    eventW: number,
    pickW: number,
  ): { event: string[]; odds: string | null; pick: string[] }[] {
    const d = this.doc;
    d.font(BOLD).fontSize(7.2);
    const oddsW = (t: string | null) => (t === null ? 0 : d.widthOfString(t) + 6);
    if (!withSelections || b.legs.length === 0) {
      const event =
        b.legs.length > 1
          ? `${BET_TYPE_LABEL[b.betType]} de ${b.legs.length}: ${b.legs.map((l) => l.event).join(' + ')}`
          : (b.legs[0]?.event ?? 'Sin partido');
      const conds = b.legs.flatMap((l) => l.conditions);
      const pick =
        b.betType === 'MULTIPLE'
          ? `${b.legs.length} selecciones`
          : conds.length > 1
            ? `Creada · ${conds.length} pronósticos`
            : `${conds[0]?.selection ?? ''}${conds[0]?.market ? ` (${conds[0].market})` : ''}`;
      return [
        { event: wrap(d, event, eventW, 6), odds: null, pick: wrap(d, pick, pickW, 4, FONT) },
      ];
    }
    return b.legs.map((leg, i) => {
      const odds = b.legs.length > 1 && leg.odds !== null ? `@ ${formatOdds(leg.odds)}` : null;
      const prefix = b.legs.length > 1 ? `${i + 1}. ` : '';
      const event = wrap(d, `${prefix}${leg.event}`, eventW - oddsW(odds), 6);
      const pick = leg.conditions.flatMap((c) =>
        wrap(
          d,
          `${leg.conditions.length > 1 ? '· ' : ''}${c.selection}${c.market ? ` (${c.market})` : ''}`,
          pickW,
          3,
          FONT,
        ),
      );
      return { event, odds, pick };
    });
  }

  private detail(withSelections: boolean) {
    const d = this.doc;
    const total = this.input.data.totals.bets;
    const groups = this.sortedBets();
    const cols = this.columns();
    const colX = (key: string) =>
      this.left +
      cols
        .slice(
          0,
          cols.findIndex((c) => c.key === key),
        )
        .reduce((a, c) => a + c.w, 0);
    const colW = (key: string) => cols.find((c) => c.key === key)!.w;
    const sortLabel = { date: 'fecha', amount: 'monto', odds: 'cuota', profit: 'ganancia' }[
      this.input.sortBy
    ];
    const subtitle = `Listado de todas las apuestas del periodo, ordenadas por ${sortLabel} (${this.input.direction === 'asc' ? 'ascendente' : 'descendente'}).`;

    let index = 0;
    // El título de cada página se escribe al final, con el rango real de apuestas de esa página.
    const pageTitles: { page: number; y: number; first: number; last: number }[] = [];
    const startPage = () => {
      pageTitles.push({ page: this.currentPage(), y: d.y, first: index + 1, last: index });
      d.y += TITLE_BLOCK_H;
      this.tableHeader(cols);
    };

    if (total === 0) {
      this.sectionTitle('Detalle de apuestas', subtitle);
      roundedBox(d, this.left, d.y, this.width, 60, C.zebra, C.line);
      d.font(FONT)
        .fontSize(10)
        .fillColor(C.muted)
        .text('No hay apuestas en este periodo con los filtros aplicados.', this.left, d.y + 24, {
          width: this.width,
          align: 'center',
        });
      d.y += 76;
      this.totalsBlock();
      return;
    }

    startPage();
    for (const group of groups) {
      if (group.group !== null) {
        if (d.y + 18 + 24 > this.contentBottom) {
          pageTitles.at(-1)!.last = index;
          this.newPage();
          startPage();
        }
        d.save()
          .rect(this.left, d.y + 2, this.width, 16)
          .fill(C.slateSoft)
          .restore();
        d.font(BOLD)
          .fontSize(8)
          .fillColor(C.ink)
          .text(
            `${group.group} — ${group.bets.length} ${group.bets.length === 1 ? 'apuesta' : 'apuestas'}`,
            this.left + 6,
            d.y + 6,
            { lineBreak: false },
          );
        d.y += 20;
      }
      for (const bet of group.bets) {
        const lineH = 9.2;
        const blocks = this.betBlocks(bet, withSelections, colW('event') - 8, colW('pick') - 8);
        const blockLines = blocks.map((b) => Math.max(b.event.length, b.pick.length));
        const nLines = Math.max(
          blockLines.reduce((a, n) => a + n, 0),
          2,
        );
        const rowH = 6 + nLines * lineH;
        if (d.y + rowH > this.contentBottom) {
          pageTitles.at(-1)!.last = index;
          this.newPage();
          startPage();
        }
        index++;
        const y = d.y;
        if (index % 2 === 0) d.save().rect(this.left, y, this.width, rowH).fill(C.zebra).restore();
        d.save()
          .moveTo(this.left, y + rowH)
          .lineTo(this.right, y + rowH)
          .lineWidth(0.35)
          .strokeColor(C.line)
          .stroke()
          .restore();
        const when = dateParts(bet.placedAt, this.input.timeZone);
        const cell = (
          key: string,
          text: string,
          opts: { color?: string; bold?: boolean; line?: number } = {},
        ) => {
          const col = cols.find((c) => c.key === key)!;
          d.font(opts.bold ? BOLD : FONT)
            .fontSize(7.2)
            .fillColor(opts.color ?? C.text);
          d.text(fit(d, text, col.w - 8), colX(key) + 4, y + 4 + (opts.line ?? 0) * lineH, {
            width: col.w - 8,
            align: col.align,
            lineBreak: false,
          });
        };
        cell('n', String(index), { color: C.muted });
        cell('date', when.date);
        cell('date', bet.placedTimeKnown ? when.time : 's/h', { color: C.muted, line: 1 });
        cell('house', bet.houseName);
        cell('house', BET_TYPE_LABEL[bet.betType], { color: C.muted, line: 1 });
        let line = 0;
        blocks.forEach((block, b) => {
          block.event.forEach((t, i) => {
            d.font(BOLD).fontSize(7.2).fillColor(C.ink);
            d.text(t, colX('event') + 4, y + 4 + (line + i) * lineH, { lineBreak: false });
          });
          if (block.odds) {
            d.font(BOLD).fontSize(7.2).fillColor(C.brand);
            d.text(block.odds, colX('event') + 4, y + 4 + line * lineH, {
              width: colW('event') - 8,
              align: 'right',
              lineBreak: false,
            });
          }
          block.pick.forEach((t, i) => {
            d.font(FONT).fontSize(7.2).fillColor(C.text);
            d.text(t, colX('pick') + 4, y + 4 + (line + i) * lineH, { lineBreak: false });
          });
          line += blockLines[b]!;
        });
        cell('stake', bet.stake.includes('.') ? bet.stake.replace(/\.?0+$/, '') : bet.stake);
        cell('amount', formatPEN(bet.amount));
        cell('odds', formatOdds(bet.visibleTotalOdds));
        if (bet.totalOddsSource === 'CALCULATED')
          cell('odds', 'calc.', { color: C.muted, line: 1 });
        // Resultado: píldora de color.
        const st = STATUS_STYLE[bet.status];
        const pw = colW('result') - 10;
        d.save()
          .roundedRect(colX('result') + 5, y + 3, pw, 10, 5)
          .fill(st.bg)
          .restore();
        d.font(BOLD)
          .fontSize(6.5)
          .fillColor(st.fg)
          .text(st.label, colX('result') + 5, y + 5.4, {
            width: pw,
            align: 'center',
            lineBreak: false,
          });
        cell('profit', bet.profitLoss === null ? '-' : signedPEN(bet.profitLoss), {
          bold: true,
          color: bet.profitLoss === null ? C.muted : tone(bet.profitLoss),
        });
        if (bet.provisional) cell('profit', 'provisional', { color: C.amber, line: 1 });
        d.y = y + rowH;
      }
    }
    pageTitles.at(-1)!.last = index;
    // Títulos con el rango real de cada página.
    const current = this.currentPage();
    for (const t of pageTitles) {
      this.doc.switchToPage(t.page);
      const saveY = d.y;
      d.y = t.y;
      this.sectionTitle(`Detalle de apuestas (${t.first} – ${t.last} de ${total})`, subtitle);
      d.y = saveY;
    }
    this.doc.switchToPage(current);
    d.y += 10;
    this.totalsBlock();
  }

  private currentPage(): number {
    const range = this.doc.bufferedPageRange();
    return range.start + range.count - 1;
  }

  private totalsBlock() {
    const d = this.doc;
    const { totals, analysis } = this.input.data;
    const items: [string, string, string][] = [
      ['Apuestas', String(totals.bets), C.ink],
      ['Monto apostado (liquidadas)', formatPEN(totals.stakedSettled), C.ink],
      ['Comprometido en pendientes', formatPEN(totals.stakedPending), C.ink],
      ['Retornos realizados', formatPEN(totals.returns), C.ink],
      ['Ganancia/Pérdida neta', signedPEN(totals.profitLoss), tone(totals.profitLoss)],
    ];
    const h = 50 + (analysis.unconfirmedReturns.count > 0 ? 12 : 0);
    if (d.y + h > this.contentBottom) this.newPage();
    const y = d.y;
    roundedBox(d, this.left, y, this.width, h, C.brandSoft, C.brandLine);
    d.font(BOLD)
      .fontSize(9)
      .fillColor(C.ink)
      .text('Totales del periodo', this.left + 12, y + 9, { lineBreak: false });
    const w = (this.width - 24) / items.length;
    items.forEach(([label, value, color], i) => {
      const x = this.left + 12 + i * w;
      d.font(FONT)
        .fontSize(7)
        .fillColor(C.muted)
        .text(label, x, y + 23, { width: w - 6, lineBreak: false });
      d.font(BOLD)
        .fontSize(10)
        .fillColor(color)
        .text(value, x, y + 33, { width: w - 6, lineBreak: false });
    });
    if (analysis.unconfirmedReturns.count > 0) {
      d.font(FONT)
        .fontSize(6.8)
        .fillColor(C.amber)
        .text(
          `Incluye ${analysis.unconfirmedReturns.count} retorno(s) calculado(s) sin confirmar (${signedPEN(analysis.unconfirmedReturns.profitLoss)}), provisionales hasta confirmar el retorno oficial.`,
          this.left + 12,
          y + h - 13,
          { width: this.width - 24, lineBreak: false },
        );
    }
    d.y = y + h + 8;
  }

  // --- Anexo de tickets ------------------------------------------------------------------------------
  private ticketsAnnex() {
    const d = this.doc;
    this.sectionTitle(
      'Tickets adjuntos',
      'Imágenes de los tickets originales vinculados a las apuestas del reporte.',
    );
    const images = this.input.ticketImages;
    if (images === null) {
      d.font(FONT)
        .fontSize(9)
        .fillColor(C.muted)
        .text(
          this.input.ticketsAllowed
            ? 'No se pidieron tickets.'
            : 'Tu rol no permite ver los tickets: no se incluyen en el reporte.',
          this.left,
          d.y,
          { width: this.width },
        );
      return;
    }
    if (images.length === 0) {
      d.font(FONT)
        .fontSize(9)
        .fillColor(C.muted)
        .text('Ninguna apuesta del reporte tiene tickets vinculados.', this.left, d.y, {
          width: this.width,
        });
      return;
    }
    const position = new Map(this.input.data.bets.map((b, i) => [b.id, { n: i + 1, bet: b }]));
    const boxH = (this.contentBottom - this.contentTop - 40) / 2 - 10;
    for (const image of images) {
      const ref = position.get(image.betId);
      if (d.y + boxH > this.contentBottom) this.newPage();
      const y = d.y;
      const label = ref
        ? `Apuesta del ${dateParts(ref.bet.placedAt, this.input.timeZone).date} · ${ref.bet.houseName} · ${ref.bet.legs.map((l) => l.event).join(' + ')}`
        : 'Apuesta';
      d.font(BOLD)
        .fontSize(8.5)
        .fillColor(C.ink)
        .text(fit(d, label, this.width), this.left, y, { lineBreak: false });
      roundedBox(d, this.left, y + 14, this.width, boxH - 18, C.zebra, C.line);
      if (image.buffer) {
        try {
          d.image(image.buffer, this.left + 8, y + 22, {
            fit: [this.width - 16, boxH - 34],
            align: 'center',
            valign: 'center',
          });
        } catch {
          d.font(FONT)
            .fontSize(8)
            .fillColor(C.muted)
            .text('No se pudo incrustar esta imagen.', this.left, y + boxH / 2, {
              width: this.width,
              align: 'center',
            });
        }
      } else {
        d.font(FONT)
          .fontSize(8)
          .fillColor(C.muted)
          .text(
            'Este ticket es un PDF: no se incrusta (descárgalo desde la apuesta).',
            this.left,
            y + boxH / 2,
            { width: this.width, align: 'center' },
          );
      }
      d.y = y + boxH + 6;
    }
  }
}

/**
 * Parte un texto en líneas que caben en `width` (por palabras; una palabra más larga que la línea
 * se corta). Como mucho `max` líneas: la última lleva «…» solo si aún sobrara texto.
 */
function wrap(d: Doc, text: string, width: number, max: number, font = BOLD): string[] {
  d.font(font).fontSize(7.2);
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (d.widthOfString(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    while (d.widthOfString(current) > width && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && d.widthOfString(current.slice(0, cut)) > width) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  if (lines.length <= max) return lines.length > 0 ? lines : [''];
  const kept = lines.slice(0, max);
  kept[max - 1] = fit(d, `${kept[max - 1]} ${lines.slice(max).join(' ')}`, width);
  return kept;
}

/** Sector de anillo (dona) entre dos ángulos, con arcos SVG. */
function donutSlice(
  d: Doc,
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  a0: number,
  a1: number,
  color: string,
) {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  if (full) {
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

/** Eje con pasos redondos (1, 2, 2.5, 5 × 10ⁿ) que incluye 0. Solo para dibujar. */
function niceAxis(values: number[]): { ticks: number[]; low: number; high: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max > min ? max - min : Math.max(Math.abs(max), 10);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step || step;
  const ticks: number[] = [];
  for (let i = 0; low + i * step <= high + step / 2 && i < 12; i++) ticks.push(low + i * step);
  return { ticks, low, high };
}
