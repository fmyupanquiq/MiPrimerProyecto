import { formatPEN, type DashboardAnalysis, type DashboardStatus } from '@letfer/shared';
import type { ReactNode } from 'react';
import type { Loaded } from '../../../hooks/useLoad.js';
import { BankIcon, LockIcon, TrendIcon, WalletIcon } from '../../../icons.js';
import { signedPEN } from '../../../format.js';
import { type GlossaryKey, Help } from '../../../glossary.js';
import { displayValueClass } from '../../../ui.js';
import { Skeleton } from './DashboardCard.js';

type Tone = 'violet' | 'blue' | 'orange' | 'green' | 'red' | 'slate';

const TONE: Record<Tone, string> = {
  violet: 'bg-violet-100 text-violet-700',
  blue: 'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  slate: 'bg-slate-100 text-slate-600',
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Métrica secundaria (§6.1, Fase 11): comparte la tarjeta del capital en vez de competir con ella
 * en una tarjeta propia — mismo tratamiento para las tres (Disponible, Comprometido, Ganancia),
 * claramente más pequeño que el capital, que es el dato dominante de este bloque.
 */
function SubStat({
  label,
  value,
  context,
  icon,
  tone,
  valueClass = 'text-slate-900',
  loading,
  error,
  term,
}: {
  term: GlossaryKey;
  label: string;
  value: string | null;
  context: ReactNode;
  icon: ReactNode;
  tone: Tone;
  valueClass?: string;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE[tone]}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
          {label}
          <Help term={term} />
        </p>
        {loading ? (
          <div aria-busy="true">
            <span className="sr-only">Cargando {label.toLowerCase()}…</span>
            <Skeleton className="mt-1 h-6 w-24" />
          </div>
        ) : error ? (
          <p role="alert" className="text-xs text-red-700">
            No se pudo cargar
          </p>
        ) : (
          <>
            <p
              className={`truncate text-xl font-semibold tracking-tight tabular-nums ${valueClass}`}
              aria-label={label}
            >
              {value ?? '—'}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{context}</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Estado financiero de un vistazo (§33, §92; rediseño Fase 11, §6.1): el capital es el dato
 * dominante de la pantalla — una sola composición, no cuatro tarjetas idénticas compitiendo entre
 * sí — con disponible, comprometido y ganancia como métricas secundarias dentro del mismo bloque.
 * El capital y el disponible/comprometido salen de `GET /dashboard/status`; la ganancia (con
 * Yield y ROI de contexto, nunca una comparación inventada), de `GET /dashboard/analysis` sin
 * filtros. Nada se calcula aquí: solo se presentan esas cifras.
 */
export function KpiCards({
  status,
  analysis,
}: {
  status: Loaded<DashboardStatus>;
  analysis: Loaded<DashboardAnalysis>;
}) {
  const s = status.data;
  const a = analysis.data;
  const statusLoading = status.loading && !s;
  const analysisLoading = analysis.loading && !a;
  const settledCount = a ? a.counts.total - a.counts.pending : 0;
  const profitTone =
    !a || a.profitLoss === '0.00' ? 'slate' : a.profitLoss.startsWith('-') ? 'red' : 'green';

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"
          aria-hidden="true"
        >
          <WalletIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-medium text-slate-500">
            Capital actual
            <Help term="capital" />
          </p>
          {statusLoading ? (
            <div aria-busy="true">
              <span className="sr-only">Cargando capital actual…</span>
              <Skeleton className="mt-1.5 h-10 w-52" />
            </div>
          ) : !s ? (
            <p role="alert" className="text-sm text-red-700">
              No se pudo cargar: {status.error}
            </p>
          ) : (
            <>
              <p className={displayValueClass} aria-label="Capital actual">
                {formatPEN(s.capitalActual)}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-500">
                <span>Disponible + comprometido · {plural(s.porCasa.length, 'casa', 'casas')}</span>
                {/* Yield y ROI como contexto de la cifra protagonista (Fase 11, §10.1): nunca
                    compiten con el capital, solo lo acompañan cuando ya hay algo liquidado. */}
                {a && settledCount > 0 && (a.yield !== null || a.roi !== null) && (
                  <span className="text-xs text-slate-400">
                    {a.yield !== null && `Yield ${a.yield} %`}
                    {a.yield !== null && a.roi !== null && ' · '}
                    {a.roi !== null && `ROI ${a.roi} %`}
                  </span>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <SubStat
          label="Disponible"
          term="available"
          icon={<BankIcon className="h-4.5 w-4.5" />}
          tone="blue"
          loading={statusLoading}
          error={s ? null : status.error}
          value={s ? formatPEN(s.disponible) : null}
          context="Lo que puedes usar ahora"
        />
        <SubStat
          label="Comprometido"
          term="committed"
          icon={<LockIcon className="h-4.5 w-4.5" />}
          tone="orange"
          loading={statusLoading}
          error={s ? null : status.error}
          value={s ? formatPEN(s.comprometido) : null}
          context={
            s && plural(s.conteoApuestas.pending, 'apuesta pendiente', 'apuestas pendientes')
          }
        />
        <SubStat
          label="Ganancia total"
          term="pl"
          icon={<TrendIcon className="h-4.5 w-4.5" />}
          tone={profitTone}
          loading={analysisLoading}
          error={a ? null : analysis.error}
          value={a ? signedPEN(a.profitLoss) : null}
          valueClass={
            profitTone === 'green'
              ? 'text-green-700'
              : profitTone === 'red'
                ? 'text-red-700'
                : 'text-slate-900'
          }
          context={
            a && (
              <>
                {/* Yield y ROI ya se leen junto al capital (Fase 11, §10.1): aquí no se repiten,
                    para que la misma cifra no aparezca dos veces en la misma pantalla. */}
                {settledCount === 0 && 'Sin liquidadas todavía'}
                {a.unconfirmedReturns.count > 0 && (
                  <span className="mt-0.5 block text-orange-700">
                    Incluye una ganancia provisional de {formatPEN(a.unconfirmedReturns.profitLoss)}{' '}
                    ({a.unconfirmedReturns.count} con retorno calculado, sin confirmar)
                  </span>
                )}
              </>
            )
          }
        />
      </div>
    </div>
  );
}
