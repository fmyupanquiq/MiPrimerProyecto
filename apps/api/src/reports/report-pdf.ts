import PDFDocument from 'pdfkit';
import { renderAnalysis } from './pdf/analysis.js';
import { renderCover } from './pdf/cover.js';
import { renderDetail } from './pdf/detail.js';
import { dateParts } from './pdf/format.js';
import { Frame } from './pdf/frame.js';
import type { ReportPdfInput } from './pdf/input.js';
import { buildInsights } from './pdf/insights.js';
import { renderOperations } from './pdf/operations.js';
import { renderSegments } from './pdf/segments.js';
import { registerFonts } from './pdf/theme.js';
import { renderTickets } from './pdf/tickets.js';

export type { ReportPdfInput, ReportTicketImage } from './pdf/input.js';

/*
 * Informe ejecutivo de rendimiento (§108.11; referencia
 * `docs/referencias/Referencias mockups/Reportes/Reporte ejecutivo.png`). Cinco bloques narrativos,
 * cada uno ligado a una sección del constructor:
 *
 *   summary    → 1. Reporte ejecutivo de rendimiento (portada)
 *   charts     → 2. Análisis financiero: evolución y resultados por estado
 *   metrics    → 2. Análisis financiero: indicadores interpretados
 *   segments   → 3. Análisis por segmentos (casa, tipo, deporte)
 *   operations → 4. Control operativo / Gestión del negocio
 *   table      → 5. Detalle de apuestas (todas, paginadas); `selections` añade legs y condiciones
 *   tickets    → Anexo de tickets (con permiso)
 *
 * Solo PRESENTA las cifras de `ReportData` (calculadas por el análisis y el ledger); las
 * observaciones salen de reglas deterministas (`pdf/insights.ts`). Texto seleccionable, fuentes
 * incrustadas (Inter, OFL) y gráficos vectoriales.
 */
export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: input.paper === 'LETTER' ? 'LETTER' : 'A4',
    layout: input.orientation,
    margin: 34,
    bufferPages: true,
    compress: input.compress ?? true,
    info: {
      Title: `Reporte ejecutivo de rendimiento — ${input.projectName}`,
      Author: 'LetFer',
      Subject: 'Reporte ejecutivo de rendimiento',
      Creator: 'LetFer',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  registerFonts(doc, input.fonts ?? 'inter');
  const period = input.periodLabel ?? defaultPeriod(input);
  const generated = dateParts(input.data.generatedAt, input.timeZone);
  const frame = new Frame(doc, {
    projectName: input.projectName,
    period,
    reportTitle: 'Reporte ejecutivo de rendimiento',
    generated: `${generated.date}, ${generated.time}`,
  });
  const insights = buildInsights(input.data);
  const has = (s: ReportPdfInput['sections'][number]) => input.sections.includes(s);

  // Cada bloque empieza en una página nueva, salvo el primero que se dibuje.
  let first = true;
  const block = (draw: () => void) => {
    if (!first) frame.newPage();
    first = false;
    draw();
  };
  if (has('summary')) block(() => renderCover(frame, input, insights, period));
  if (has('charts') || has('metrics')) {
    block(() =>
      renderAnalysis(frame, input, period, { charts: has('charts'), metrics: has('metrics') }),
    );
  }
  if (has('segments')) block(() => renderSegments(frame, input));
  if (has('operations')) block(() => renderOperations(frame, input, insights));
  if (has('table')) block(() => renderDetail(frame, input, has('selections')));
  if (has('tickets')) block(() => renderTickets(frame, input));
  if (first) renderCover(frame, input, insights, period); // sin secciones: al menos la portada

  frame.footers();
  doc.end();
  return done;
}

function defaultPeriod(input: ReportPdfInput): string {
  const { from, to } = input.filters;
  if (!from && !to) return 'Todo el historial';
  const f = from ? dateParts(from, input.timeZone).date : '…';
  const t = to ? dateParts(to, input.timeZone).date : '…';
  return `${f} - ${t}`;
}
