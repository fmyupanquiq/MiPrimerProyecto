import { formatOdds, type DashboardAnalysis } from '@letfer/shared';
import type { ReactNode } from 'react';
import { formatPercent, signedPEN, signTone } from '../../../format.js';
import type { Loaded } from '../../../hooks/useLoad.js';
import { CalendarIcon } from '../../../icons.js';
import { CompactSelect } from './BetStatusDonut.js';
import { CardError, DashboardCard, Skeleton } from './DashboardCard.js';
import { monthLabel } from './date-range.js';

const TONE = {
  positive: 'text-green-700',
  negative: 'text-red-700',
  neutral: 'text-slate-900',
} as const;

const NO_DECIDED = 'Sin apuestas decididas este mes';

function Tile({
  label,
  value,
  valueClass = 'text-slate-900',
  caption,
}: {
  label: string;
  value: string;
  valueClass?: string;
  caption: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200/70 bg-surface-2 px-3.5 py-3">
      <p className="text-sm text-slate-600">{label}</p>
      <p
        className={`mt-0.5 truncate text-2xl font-bold tracking-tight tabular-nums ${valueClass}`}
        aria-label={`${label} del mes`}
      >
        {value}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{caption}</p>
    </div>
  );
}

/**
 * Rendimiento de un mes (§108.10): win rate, cuota media, beneficio neto (con su ROI) y Yield, del
 * análisis con `from`/`to` = inicio y fin de ese mes en la zona del proyecto. Todo viene de la API.
 */
export function MonthPerformance({
  month,
  months,
  onMonth,
  analysis,
}: {
  /** Mes elegido, `AAAA-MM`. */
  month: string;
  /** Meses que se pueden elegir, del más reciente al más antiguo. */
  months: readonly string[];
  onMonth: (month: string) => void;
  analysis: Loaded<DashboardAnalysis>;
}) {
  const a = analysis.data;
  const decided = a ? a.counts.won + a.counts.lost : 0;

  return (
    <DashboardCard
      title="Rendimiento del mes"
      icon={<CalendarIcon />}
      action={
        <CompactSelect
          ariaLabel="Mes"
          value={month}
          onChange={onMonth}
          icon={<CalendarIcon className="h-3.5 w-3.5" />}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
        />
      }
    >
      {analysis.loading && !a ? (
        <div aria-busy="true" className="grid grid-cols-2 gap-3">
          <span className="sr-only">Cargando el rendimiento del mes…</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[5.5rem] w-full rounded-xl" />
          ))}
        </div>
      ) : !a ? (
        <CardError
          message={analysis.error ?? 'No se pudo cargar el rendimiento del mes.'}
          onRetry={analysis.reload}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="Win rate"
            value={a.winRate === null ? '—' : formatPercent(a.winRate, { signed: false })}
            caption={
              a.winRate === null
                ? NO_DECIDED
                : `${a.counts.won} de ${decided} ${decided === 1 ? 'apuesta decidida' : 'apuestas decididas'}`
            }
          />
          <Tile
            label="Cuota media"
            value={a.averageOdds === null ? '—' : formatOdds(a.averageOdds)}
            caption={a.averageOdds === null ? NO_DECIDED : 'Promedio del mes'}
          />
          <Tile
            label="Beneficio neto"
            value={signedPEN(a.profitLoss)}
            valueClass={TONE[signTone(a.profitLoss)]}
            caption={
              a.roi === null ? (
                NO_DECIDED
              ) : (
                <span className={TONE[signTone(a.roi)]}>{formatPercent(a.roi)} ROI</span>
              )
            }
          />
          <Tile
            label="Yield"
            value={a.yield === null ? '—' : formatPercent(a.yield)}
            valueClass={TONE[signTone(a.yield)]}
            caption={a.yield === null ? NO_DECIDED : 'Sobre el total apostado'}
          />
        </div>
      )}
    </DashboardCard>
  );
}
