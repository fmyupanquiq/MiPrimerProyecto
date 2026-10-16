import { formatPEN, type BetStatus, type ReportData } from '@letfer/shared';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, YAxis } from 'recharts';
import { formatRate, signedPEN } from '../../../format.js';
import { DocumentIcon, EyeIcon } from '../../../icons.js';
import { BET_STATUS_LABELS } from '../../../labels.js';
import { zonedParts } from '../../../time-zone.js';
import type { ReportOptions } from './report-query.js';

/*
 * Vista previa del PDF (§108.11; referencia «Panel de reportes», columna derecha): una miniatura
 * clara, como el documento, pintada con el MISMO `ReportData` que se envía al PDF. No es una
 * captura ni un cálculo aparte: si una cifra cambia aquí, cambia igual en el PDF.
 */

// Paleta del documento (claro siempre, igual que el PDF).
const P = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  soft: '#f5f3ff',
  brand: '#7c3aed',
  green: '#15803d',
  red: '#b91c1c',
};
const STATUS_COLOR: Record<BetStatus, string> = {
  WON: '#22c55e',
  LOST: '#ef4444',
  PENDING: '#eab308',
  VOID: '#94a3b8',
  CASHOUT: '#3b82f6',
};
const pillStyle: Record<BetStatus, { bg: string; fg: string }> = {
  WON: { bg: '#dcfce7', fg: '#15803d' },
  LOST: { bg: '#fee2e2', fg: '#b91c1c' },
  PENDING: { bg: '#fef3c7', fg: '#b45309' },
  VOID: { bg: '#e2e8f0', fg: '#475569' },
  CASHOUT: { bg: '#dbeafe', fg: '#1d4ed8' },
};
const toneOf = (v: string | null) =>
  v === null || /^-?0+(\.0+)?$/.test(v) ? P.ink : v.startsWith('-') ? P.red : P.green;

function Metric({ value, label, color = P.ink }: { value: string; label: string; color?: string }) {
  return (
    <div className="rounded-md px-2 py-1.5 text-center" style={{ background: P.soft }}>
      <p className="truncate text-[13px] font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="truncate text-[9px]" style={{ color: P.muted }}>
        {label}
      </p>
    </div>
  );
}

export function PdfPreview({
  data,
  projectName,
  period,
  options,
  loading,
}: {
  data: ReportData | null;
  projectName: string;
  period: string;
  options: ReportOptions;
  loading: boolean;
}) {
  const a = data?.analysis;
  const order: BetStatus[] = ['WON', 'LOST', 'PENDING', 'VOID', 'CASHOUT'];
  const countOf = (s: BetStatus) =>
    a
      ? a.counts[
          s === 'WON'
            ? 'won'
            : s === 'LOST'
              ? 'lost'
              : s === 'PENDING'
                ? 'pending'
                : s === 'VOID'
                  ? 'void'
                  : 'cashout'
        ]
      : 0;
  const generated = data ? zonedParts(new Date(data.generatedAt)) : null;
  const show = (s: ReportOptions['sections'][number]) => options.sections.includes(s);
  // Bloques del PDF en su orden (§108.11), según las secciones elegidas.
  const pages = [
    show('summary') && 'Resumen ejecutivo',
    (show('charts') || show('metrics')) && 'Análisis financiero',
    show('segments') && 'Segmentos',
    show('operations') && 'Control operativo',
    show('table') && 'Detalle de apuestas',
    show('tickets') && 'Tickets',
  ].filter((p): p is string => typeof p === 'string');

  return (
    <section
      aria-labelledby="pdf-preview-title"
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200/70 bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <EyeIcon className="mt-0.5 h-7 w-7 shrink-0 text-violet-500" />
        <div>
          <h2 id="pdf-preview-title" className="text-lg font-semibold text-slate-900">
            Vista previa del PDF
          </h2>
          <p className="text-sm text-slate-500">
            Así se verá tu reporte con la configuración actual.
          </p>
        </div>
      </div>
      <div
        className={`relative overflow-hidden rounded-md bg-white p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-opacity ${loading ? 'opacity-60' : ''}`}
        style={{ color: P.ink }}
        aria-label="Miniatura de la primera página del PDF"
        role="img"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-white"
              style={{ background: P.brand }}
            >
              L
            </span>
            <span className="text-lg font-bold">
              LetFer <span style={{ color: P.muted }}>/</span> {projectName}
            </span>
          </div>
          <div className="text-right text-[9px] leading-tight" style={{ color: P.muted }}>
            <p className="font-semibold" style={{ color: P.ink }}>
              Reporte ejecutivo de rendimiento
            </p>
            <p>{period}</p>
            {generated && <p>Generado el {generated.date.split('-').reverse().join('/')}</p>}
          </div>
        </div>

        {show('summary') && (
          <>
            <p className="mt-3 text-[11px] font-bold">Resumen ejecutivo</p>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              <Metric value={a ? String(data.totals.bets) : '—'} label="Apuestas" />
              <Metric
                value={a ? formatPEN(data.totals.stakedSettled) : '—'}
                label="Monto apostado"
              />
              <Metric
                value={a ? signedPEN(a.profitLoss) : '—'}
                label="Ganancia neta"
                color={toneOf(a?.profitLoss ?? null)}
              />
              <Metric
                value={formatRate(a?.roi ?? null)}
                label="ROI"
                color={toneOf(a?.roi ?? null)}
              />
            </div>
          </>
        )}

        {show('charts') && (
          <div className="mt-2.5 grid grid-cols-[1.35fr_1fr] gap-2">
            <div className="rounded-md border p-2" style={{ borderColor: P.line }}>
              <p className="text-[10px] font-bold">Evolución de la ganancia neta</p>
              <div className="h-20">
                {data && data.cumulative.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.cumulative.map((p) => ({ v: Number(p.cumulative) }))}
                      margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
                    >
                      <YAxis hide domain={['dataMin', 'dataMax']} />
                      <Area
                        type="linear"
                        dataKey="v"
                        stroke={P.brand}
                        strokeWidth={1.5}
                        fill={P.brand}
                        fillOpacity={0.12}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="pt-6 text-center text-[9px]" style={{ color: P.muted }}>
                    Sin apuestas liquidadas
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-md border p-2" style={{ borderColor: P.line }}>
              <p className="text-[10px] font-bold">Distribución por resultado</p>
              <div className="flex items-center gap-1.5">
                <div className="relative h-20 w-20 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={
                          a && a.counts.total > 0
                            ? order.filter((s) => countOf(s) > 0).map((s) => ({ s, n: countOf(s) }))
                            : [{ s: 'EMPTY', n: 1 }]
                        }
                        dataKey="n"
                        innerRadius="62%"
                        outerRadius="100%"
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {(a && a.counts.total > 0
                          ? order.filter((s) => countOf(s) > 0)
                          : ['EMPTY']
                        ).map((s) => (
                          <Cell
                            key={s}
                            fill={s === 'EMPTY' ? P.line : STATUS_COLOR[s as BetStatus]}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">
                    {a?.counts.total ?? 0}
                  </span>
                </div>
                <ul
                  className="min-w-0 flex-1 text-[8.5px] leading-[1.45]"
                  style={{ color: P.muted }}
                >
                  {order.map((s) => (
                    <li key={s} className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1 truncate">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLOR[s] }}
                        />
                        {BET_STATUS_LABELS[s]}
                      </span>
                      <span className="font-semibold" style={{ color: P.ink }}>
                        {countOf(s)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {show('table') && (
          <>
            <p className="mt-2.5 text-[11px] font-bold">Detalle de apuestas</p>
            <table className="mt-1 w-full table-fixed text-[8.5px]">
              <thead>
                <tr className="text-left" style={{ background: P.soft, color: P.muted }}>
                  <th className="w-[17%] px-1 py-0.5 font-semibold">Fecha</th>
                  <th className="w-[37%] px-1 py-0.5 font-semibold">Partido</th>
                  <th className="w-[15%] px-1 py-0.5 font-semibold">Casa</th>
                  <th className="w-[15%] px-1 py-0.5 text-center font-semibold">Resultado</th>
                  <th className="w-[16%] px-1 py-0.5 text-right font-semibold">Ganancia</th>
                </tr>
              </thead>
              <tbody>
                {(data?.bets ?? [])
                  .slice(-4)
                  .reverse()
                  .map((b) => (
                    <tr key={b.id} className="border-b" style={{ borderColor: P.line }}>
                      <td className="truncate px-1 py-1 tabular-nums">
                        {zonedParts(new Date(b.placedAt)).date.split('-').reverse().join('/')}
                      </td>
                      <td className="truncate px-1 py-1">
                        {b.legs.map((l) => l.event).join(' + ') || 'Sin partido'}
                      </td>
                      <td className="truncate px-1 py-1">{b.houseName}</td>
                      <td className="px-1 py-1 text-center">
                        <span
                          className="rounded-full px-1.5 py-px font-semibold"
                          style={{
                            background: pillStyle[b.status].bg,
                            color: pillStyle[b.status].fg,
                          }}
                        >
                          {BET_STATUS_LABELS[b.status]}
                        </span>
                      </td>
                      <td
                        className="px-1 py-1 text-right font-semibold tabular-nums"
                        style={{ color: toneOf(b.profitLoss) }}
                      >
                        {b.profitLoss === null ? '-' : signedPEN(b.profitLoss)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {data && data.bets.length === 0 && (
              <p className="py-3 text-center text-[9px]" style={{ color: P.muted }}>
                No hay apuestas en este periodo.
              </p>
            )}
          </>
        )}
        {pages.length > 0 && (
          <p
            className="mt-2.5 border-t pt-1.5 text-[8.5px]"
            style={{ borderColor: P.line, color: P.muted }}
          >
            <span className="font-semibold" style={{ color: P.ink }}>
              Páginas del informe:
            </span>{' '}
            {pages.join(' · ')}
          </p>
        )}
        {options.sections.length === 0 && (
          <p className="py-6 text-center text-xs" style={{ color: P.muted }}>
            Elige al menos una sección del contenido.
          </p>
        )}
      </div>
    </section>
  );
}

/** Configuración del PDF: orientación, tamaño de papel y nombre del archivo. */
export function PdfSettings({
  options,
  onOptions,
  fileName,
  onFileName,
}: {
  options: ReportOptions;
  onOptions: (options: ReportOptions) => void;
  fileName: string;
  onFileName: (name: string) => void;
}) {
  const radio = (
    name: string,
    value: string,
    current: string,
    label: string,
    onPick: () => void,
  ) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={onPick}
        className="h-4 w-4 accent-violet-600"
      />
      {label}
    </label>
  );
  return (
    <section
      aria-labelledby="pdf-settings-title"
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200/70 bg-surface p-4 shadow-sm"
    >
      <h2
        id="pdf-settings-title"
        className="flex items-center gap-2 text-[0.9375rem] font-semibold text-slate-900"
      >
        <DocumentIcon className="h-5 w-5 text-violet-500" /> Configuración del PDF
      </h2>
      <div className="grid gap-3 @[30rem]:grid-cols-[auto_auto_minmax(0,1fr)]">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs text-slate-500">Orientación</legend>
          <div className="flex gap-3">
            {radio('pdf-orientation', 'portrait', options.orientation, 'Vertical', () =>
              onOptions({ ...options, orientation: 'portrait' }),
            )}
            {radio('pdf-orientation', 'landscape', options.orientation, 'Horizontal', () =>
              onOptions({ ...options, orientation: 'landscape' }),
            )}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs text-slate-500">Tamaño de papel</legend>
          <div className="flex gap-3">
            {radio('pdf-paper', 'A4', options.paper, 'A4', () =>
              onOptions({ ...options, paper: 'A4' }),
            )}
            {radio('pdf-paper', 'LETTER', options.paper, 'Carta', () =>
              onOptions({ ...options, paper: 'LETTER' }),
            )}
          </div>
        </fieldset>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs text-slate-500">
          Nombre del archivo
          <span className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-surface-2 px-3 focus-within:border-violet-500">
            <DocumentIcon className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              value={fileName}
              onChange={(e) => onFileName(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 focus:outline-none"
            />
          </span>
        </label>
      </div>
    </section>
  );
}
