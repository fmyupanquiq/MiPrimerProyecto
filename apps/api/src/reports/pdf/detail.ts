import { formatOdds, formatPEN, sortReportBets, type ReportBet } from '@letfer/shared';
import { C, F, TONE_COLOR } from './theme.js';
import { dateParts, signedPEN, toneOf, wrap } from './format.js';
import type { Frame } from './frame.js';
import { STATUS } from './charts.js';
import { BET_TYPE_LABEL, type ReportPdfInput } from './input.js';

/*
 * Página 5 en adelante — Detalle de apuestas: TODAS las apuestas del alcance, sin truncar, en el
 * orden elegido (el mismo que el panel, `sortReportBets`). Una fila por apuesta; con «Selecciones
 * detalladas», sus legs (cuota UNA vez por leg) y condiciones internas, sangradas debajo. Cabecera de
 * tabla repetida en cada página; una apuesta no se parte salvo que no quepa en una página entera
 * (entonces continúa con «(continuación)»). Al final, los totales del periodo.
 */

const SIZE = 7.6;
const LINE = 10;

interface Columns {
  n: number;
  date: number;
  sport: number;
  event: number;
  type: number;
  odds: number;
  amount: number;
  result: number;
  profit: number;
}

function columns(f: Frame): { x: Columns; w: Columns } {
  const fixed = {
    n: 22,
    date: 50,
    sport: 56,
    type: 44,
    odds: 34,
    amount: 50,
    result: 52,
    profit: 56,
  };
  const event = f.width - Object.values(fixed).reduce((a, b) => a + b, 0);
  const w: Columns = { ...fixed, event };
  const order: (keyof Columns)[] = [
    'n',
    'date',
    'sport',
    'event',
    'type',
    'odds',
    'amount',
    'result',
    'profit',
  ];
  const x = {} as Columns;
  let cx = f.left;
  for (const key of order) {
    x[key] = cx;
    cx += w[key];
  }
  return { x, w };
}

/** Una línea de texto de la fila, en una columna. */
interface Cell {
  col: keyof Columns;
  text: string;
  font?: string;
  color?: string;
  align?: 'left' | 'right' | 'center';
}
/** Bloque indivisible: la cabecera de la apuesta o un leg con sus condiciones. */
interface Block {
  lines: Cell[][];
}

function betBlocks(
  f: Frame,
  bet: ReportBet,
  withSelections: boolean,
  cols: ReturnType<typeof columns>,
  timeZone: string,
): Block[] {
  const d = f.doc;
  const when = dateParts(bet.placedAt, timeZone);
  const sport =
    bet.legs.length > 1 && new Set(bet.legs.map((l) => l.sport ?? '')).size > 1
      ? 'Mixto'
      : (bet.legs[0]?.sport ?? 'Sin clasificar');
  const multi = bet.legs.length > 1;
  const conds = bet.legs.flatMap((l) => l.conditions);
  d.font(F.semibold).fontSize(SIZE);
  const evW = cols.w.event - 8;
  const title = multi
    ? withSelections
      ? `${BET_TYPE_LABEL[bet.betType]} de ${bet.legs.length} selecciones`
      : bet.legs.map((l) => l.event).join(' + ')
    : (bet.legs[0]?.event ?? 'Sin partido');
  const titleLines = wrap(d, title, evW, withSelections ? 4 : 5);
  d.font(F.regular).fontSize(SIZE);
  const sub = multi
    ? withSelections
      ? []
      : [`${bet.legs.length} selecciones`]
    : conds.length > 1
      ? withSelections
        ? conds.flatMap((c) =>
            wrap(d, `· ${c.selection}${c.market ? ` (${c.market})` : ''}`, evW - 8, 3),
          )
        : [`Creada · ${conds.length} pronósticos`]
      : wrap(
          d,
          conds[0] ? `${conds[0].market ? `${conds[0].market} · ` : ''}${conds[0].selection}` : '',
          evW,
          3,
        );

  const head: Cell[][] = [];
  const nLines = Math.max(2, titleLines.length + sub.length);
  for (let i = 0; i < nLines; i++) head.push([]);
  head[0]!.push(
    { col: 'n', text: '', color: C.muted },
    { col: 'date', text: when.date, color: C.text },
    { col: 'sport', text: sport, color: C.text },
    { col: 'type', text: BET_TYPE_LABEL[bet.betType], color: C.text },
    {
      col: 'odds',
      text: formatOdds(bet.visibleTotalOdds),
      font: F.semibold,
      color: C.navy,
      align: 'right',
    },
    { col: 'amount', text: formatPEN(bet.amount), color: C.text, align: 'right' },
    {
      col: 'profit',
      text: bet.profitLoss === null ? '—' : signedPEN(bet.profitLoss),
      font: F.bold,
      color: bet.profitLoss === null ? C.muted : TONE_COLOR[toneOf(bet.profitLoss)],
      align: 'right',
    },
  );
  head[1]!.push(
    { col: 'date', text: bet.placedTimeKnown ? when.time : 's/hora', color: C.muted },
    { col: 'sport', text: bet.houseName, color: C.muted },
  );
  if (bet.totalOddsSource === 'CALCULATED')
    head[1]!.push({ col: 'odds', text: 'calc.', color: C.muted, align: 'right' });
  if (bet.provisional)
    head[1]!.push({ col: 'profit', text: 'provisional', color: C.amberMid, align: 'right' });
  titleLines.forEach((t, i) =>
    head[i]!.push({ col: 'event', text: t, font: F.semibold, color: C.navy }),
  );
  sub.forEach((t, i) =>
    head[titleLines.length + i]!.push({ col: 'event', text: t, color: C.muted }),
  );
  const blocks: Block[] = [{ lines: head }];

  if (withSelections && multi) {
    bet.legs.forEach((leg, i) => {
      d.font(F.medium).fontSize(SIZE);
      const legLines = multi ? wrap(d, `${i + 1}. ${leg.event}`, evW - 8, 3) : [];
      const lines: Cell[][] = legLines.map((t, j) => [
        {
          col: 'event' as const,
          text: `${j === 0 ? '' : '   '}${t}`,
          font: F.medium,
          color: C.text,
        },
      ]);
      // Cuota del leg: UNA vez, en la primera línea del leg.
      if (multi && leg.odds !== null && lines[0])
        lines[0].push({
          col: 'odds',
          text: formatOdds(leg.odds),
          font: F.medium,
          color: C.brand,
          align: 'right',
        });
      if (multi && leg.sport && lines[0])
        lines[0].push({ col: 'sport', text: leg.sport, color: C.faint });
      for (const c of leg.conditions) {
        d.font(F.regular).fontSize(SIZE);
        const condLines = wrap(
          d,
          `${leg.conditions.length > 1 ? '· ' : ''}${c.selection}${c.market ? ` (${c.market})` : ''}`,
          evW - 16,
          3,
        );
        condLines.forEach((t) =>
          lines.push([{ col: 'event', text: `${multi ? '      ' : '   '}${t}`, color: C.muted }]),
        );
      }
      blocks.push({ lines });
    });
  }
  return blocks;
}

export function renderDetail(f: Frame, input: ReportPdfInput, withSelections: boolean): void {
  const d = f.doc;
  const { data } = input;
  const total = data.totals.bets;
  const cols = columns(f);
  const sortLabel = { date: 'fecha', amount: 'monto', odds: 'cuota', profit: 'ganancia' }[
    input.sortBy
  ];
  const subtitle = `Registro de las operaciones incluidas en el periodo, ordenadas por ${sortLabel} (${input.direction === 'asc' ? 'ascendente' : 'descendente'}).`;

  if (total === 0) {
    f.pageTitle('Detalle de apuestas', subtitle);
    f.card(f.left, f.y, f.width, 60, { fill: C.zebra });
    f.line('No hay apuestas en este periodo con los filtros aplicados.', f.left, f.y + 25, {
      font: F.medium,
      size: 10,
      color: C.muted,
      width: f.width,
      align: 'center',
    });
    f.y += 76;
    totalsBlock(f, input);
    return;
  }

  // El título de cada página se escribe al final, con el rango real de apuestas de esa página.
  const titles: { page: number; y: number; first: number; last: number }[] = [];
  let index = 0;
  const header = () => {
    const y = f.y;
    d.save().roundedRect(f.left, y, f.width, 20, 4).fill(C.lavender2).restore();
    const h = (col: keyof Columns, label: string, align: 'left' | 'right' | 'center' = 'left') =>
      f.line(label, cols.x[col] + 4, y + 6.5, {
        font: F.bold,
        size: 7.4,
        color: C.navy,
        width: cols.w[col] - 8,
        align,
      });
    h('n', 'N.º');
    h('date', 'Fecha');
    h('sport', 'Deporte');
    h('event', 'Evento / pronóstico');
    h('type', 'Tipo');
    h('odds', 'Cuota', 'right');
    h('amount', 'Monto', 'right');
    h('result', 'Resultado', 'center');
    h('profit', 'Ganancia', 'right');
    f.y = y + 22;
  };
  const startPage = () => {
    titles.push({ page: f.page(), y: f.y, first: index + 1, last: index });
    f.y += 46;
    header();
  };
  const breakPage = () => {
    titles.at(-1)!.last = index;
    f.newPage();
    startPage();
  };
  const blockH = (b: Block) => b.lines.length * LINE;
  const drawBlock = (b: Block, y0: number) => {
    b.lines.forEach((cells, i) => {
      for (const c of cells) {
        f.line(c.text, cols.x[c.col] + 4, y0 + 4 + i * LINE, {
          font: c.font ?? F.regular,
          size: SIZE,
          color: c.color ?? C.text,
          width: cols.w[c.col] - 8,
          align: c.align ?? 'left',
        });
      }
    });
  };

  startPage();
  const groups = groupsOf(input);
  for (const group of groups) {
    if (group.label) {
      if (f.y + 20 + 30 > f.bottom) breakPage();
      d.save()
        .roundedRect(f.left, f.y + 1, f.width, 16, 3)
        .fill(C.slateSoft)
        .restore();
      f.line(
        `${group.label} — ${group.bets.length} ${group.bets.length === 1 ? 'apuesta' : 'apuestas'}`,
        f.left + 8,
        f.y + 5,
        { font: F.bold, size: 8, color: C.navy },
      );
      f.y += 20;
    }
    for (const bet of group.bets) {
      const blocks = betBlocks(f, bet, withSelections, cols, input.timeZone);
      const rowH = blocks.reduce((a, b) => a + blockH(b), 0) + 8;
      // Si no cabe entera, se parte entre legs, pero nunca deja sola la cabecera de la apuesta.
      const minimum = blockH(blocks[0]!) + (blocks[1] ? blockH(blocks[1]) + 2 : 0) + 8;
      if (f.y + rowH > f.bottom && f.y + minimum > f.bottom) breakPage();
      index++;
      const zebra = index % 2 === 0;
      let y = f.y;
      // Fondo y separador de la fila (en la parte que cabe en esta página).
      const paint = (from: number, to: number) => {
        if (zebra)
          d.save()
            .rect(f.left, from, f.width, to - from)
            .fill(C.zebra)
            .restore();
        d.save()
          .moveTo(f.left, to)
          .lineTo(f.right, to)
          .lineWidth(0.4)
          .strokeColor(C.line)
          .stroke()
          .restore();
      };
      const fits = y + rowH <= f.bottom;
      if (fits) paint(y, y + rowH);
      const st = STATUS[bet.status];
      const pill = (yy: number) => {
        const pw = cols.w.result - 8;
        d.save()
          .roundedRect(cols.x.result + 4, yy + 2.5, pw, 11, 5.5)
          .fill(st.bg)
          .restore();
        f.line(st.label, cols.x.result + 4, yy + 4.6, {
          font: F.bold,
          size: 6.6,
          color: st.fg,
          width: pw,
          align: 'center',
        });
      };
      // Número de la apuesta (siempre, aunque continúe en otra página).
      f.line(String(index), cols.x.n + 4, y + 4, {
        font: F.medium,
        size: SIZE,
        color: C.muted,
        width: cols.w.n - 6,
      });
      pill(y);
      let segStart = y;
      blocks.forEach((b, bi) => {
        if (!fits && y + blockH(b) > f.bottom) {
          paint(segStart, y + 4);
          breakPage();
          y = f.y;
          segStart = y;
          f.line(`N.º ${index} (continuación)`, cols.x.event + 4, y + 4, {
            font: F.semibold,
            size: SIZE,
            color: C.brand,
            width: cols.w.event - 8,
          });
          y += LINE;
        }
        drawBlock(b, y);
        y += blockH(b) + (bi === 0 && blocks.length > 1 ? 2 : 0);
      });
      if (!fits) paint(segStart, y + 6);
      f.y = Math.max(y + 6, fits ? f.y + rowH : y + 6);
    }
  }
  titles.at(-1)!.last = index;
  const current = f.page();
  for (const t of titles) {
    d.switchToPage(t.page);
    const keep = f.y;
    f.y = t.y;
    f.pageTitle(`Detalle de apuestas (${t.first} – ${t.last} de ${total})`, subtitle);
    f.y = keep;
  }
  d.switchToPage(current);
  f.y += 10;
  totalsBlock(f, input);
}

function groupsOf(input: ReportPdfInput): { label: string | null; bets: ReportBet[] }[] {
  const bets = sortReportBets(input.data.bets, input.sortBy, input.direction);
  if (input.groupBy === 'none') return [{ label: null, bets }];
  const label = (b: ReportBet) =>
    input.groupBy === 'house'
      ? b.houseName
      : input.groupBy === 'status'
        ? STATUS[b.status].plural
        : input.groupBy === 'betType'
          ? BET_TYPE_LABEL[b.betType]
          : `Mes ${dateParts(b.placedAt, input.timeZone).date.slice(3)}`;
  const groups = new Map<string, ReportBet[]>();
  for (const b of bets) groups.set(label(b), [...(groups.get(label(b)) ?? []), b]);
  return [...groups.entries()].map(([g, list]) => ({ label: g, bets: list }));
}

/** Totales del periodo (las mismas cifras que el resumen). */
function totalsBlock(f: Frame, input: ReportPdfInput): void {
  const { totals, analysis } = input.data;
  const items: [string, string, string][] = [
    ['Apuestas', String(totals.bets), C.navy],
    ['Monto apostado (liquidadas)', formatPEN(totals.stakedSettled), C.navy],
    ['Comprometido en pendientes', formatPEN(totals.stakedPending), C.navy],
    ['Retornos realizados', formatPEN(totals.returns), C.navy],
    [
      'Ganancia / pérdida neta',
      signedPEN(totals.profitLoss),
      TONE_COLOR[toneOf(totals.profitLoss)],
    ],
  ];
  const h = 52 + (analysis.unconfirmedReturns.count > 0 ? 12 : 0);
  f.ensure(h);
  const y = f.y;
  f.card(f.left, y, f.width, h, { fill: C.lavender, stroke: C.lavender2, radius: 10 });
  f.line('Totales del periodo', f.left + 14, y + 10, { font: F.bold, size: 9.5, color: C.navy });
  const w = (f.width - 28) / items.length;
  items.forEach(([label, value, color], i) => {
    const x = f.left + 14 + i * w;
    f.line(label, x, y + 25, { font: F.medium, size: 7, color: C.muted, width: w - 8 });
    f.line(value, x, y + 35, { font: F.black, size: 10.5, color, width: w - 8 });
  });
  if (analysis.unconfirmedReturns.count > 0) {
    f.line(
      `Incluye ${analysis.unconfirmedReturns.count} retorno(s) calculado(s) sin confirmar (${signedPEN(analysis.unconfirmedReturns.profitLoss)}), provisionales hasta confirmar el retorno oficial.`,
      f.left + 14,
      y + h - 13,
      { size: 6.8, color: C.amber, width: f.width - 28 },
    );
  }
  f.y = y + h + 8;
}
