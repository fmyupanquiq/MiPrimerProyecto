import type { HouseSummary, ReportSection, StageSummary } from '@letfer/shared';
import type { ReactNode } from 'react';
import {
  CalendarIcon,
  ChartBarsIcon,
  ChevronDownIcon,
  FilterIcon,
  LayersIcon,
  ListIcon,
  TicketIcon,
  TrashIcon,
  TrendIcon,
  DonutIcon,
  TagIcon,
  SoccerBallIcon,
} from '../../../icons.js';
import {
  MORE_SHORTCUTS,
  type RangeShortcut,
  type ReportDraft,
  type ReportOptions,
} from './report-query.js';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
const fieldClass = `h-10 w-full min-w-0 appearance-none rounded-lg border border-slate-200 bg-surface-2 pr-8 text-sm text-slate-800 transition-colors hover:border-violet-300 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30`;

/** Select con chevron e icono opcional (estilo del constructor). */
export function Field({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  icon?: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[0.8125rem] font-semibold text-slate-800">
      {label}
      <span className="relative flex items-center">
        {icon && (
          <span
            className="pointer-events-none absolute left-3 text-slate-500 [&>svg]:h-4 [&>svg]:w-4"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldClass} ${icon ? 'pl-9' : 'pl-3'} font-normal`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500" />
      </span>
    </label>
  );
}

function StepTitle({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="text-lg font-bold text-violet-600 tabular-nums">{n}.</span>
      <div>
        <h3 className="text-[0.9375rem] font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{text}</p>
      </div>
    </div>
  );
}

const SECTION_CARDS: { key: ReportSection; title: string; text: string; icon: ReactNode }[] = [
  {
    key: 'summary',
    title: 'Resumen ejecutivo',
    text: 'Métricas principales y resumen del periodo.',
    icon: <ChartBarsIcon />,
  },
  {
    key: 'metrics',
    title: 'Métricas de rendimiento',
    text: 'ROI, Yield y win rate por tipo; montos por casa.',
    icon: <DonutIcon />,
  },
  {
    key: 'table',
    title: 'Tabla de apuestas',
    text: 'Listado completo de las apuestas incluidas.',
    icon: <ListIcon />,
  },
  {
    key: 'selections',
    title: 'Selecciones detalladas',
    text: 'Cada leg con su cuota y sus condiciones.',
    icon: <LayersIcon />,
  },
  {
    key: 'tickets',
    title: 'Tickets adjuntos',
    text: 'Imágenes de los tickets (si están disponibles).',
    icon: <TicketIcon />,
  },
  {
    key: 'charts',
    title: 'Gráficos y tendencias',
    text: 'Rendimiento acumulado y distribución por resultado.',
    icon: <TrendIcon />,
  },
];

/**
 * Constructor de reporte (§108.11; referencia «Panel de reportes»): 1. filtros, 2. contenido del
 * PDF y 3. agrupación/orden. Los filtros se aplican con «Aplicar filtros»: el panel y el PDF usan
 * siempre los filtros aplicados.
 */
export function ReportBuilder({
  draft,
  onDraft,
  options,
  onOptions,
  houses,
  stages,
  sports,
  markets,
  onApply,
  onClear,
  found,
  dirty,
  rangeError,
  ticketsAllowed,
  onShortcut,
  activeShortcut,
}: {
  draft: ReportDraft;
  onDraft: (draft: ReportDraft) => void;
  options: ReportOptions;
  onOptions: (options: ReportOptions) => void;
  houses: readonly HouseSummary[];
  stages: readonly StageSummary[];
  sports: readonly string[];
  markets: readonly string[];
  onApply: () => void;
  onClear: () => void;
  /** Apuestas del alcance aplicado (`null` mientras carga). */
  found: number | null;
  dirty: boolean;
  rangeError: boolean;
  ticketsAllowed: boolean;
  onShortcut: (key: RangeShortcut) => void;
  activeShortcut: RangeShortcut | null;
}) {
  const set = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) =>
    onDraft({ ...draft, [key]: value });
  const toggle = (key: ReportSection) =>
    onOptions({
      ...options,
      sections: options.sections.includes(key)
        ? options.sections.filter((s) => s !== key)
        : [...options.sections, key],
    });

  return (
    <section
      aria-labelledby="report-builder-title"
      className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-slate-200/70 bg-surface p-4 shadow-sm @[40rem]:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <FilterIcon className="mt-0.5 h-7 w-7 shrink-0 text-violet-500" />
          <div className="min-w-0">
            <h2 id="report-builder-title" className="text-lg font-semibold text-slate-900">
              Constructor de reporte
            </h2>
            <p className="text-sm text-slate-500">
              Configura los filtros, el contenido y el formato de tu reporte PDF.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:border-violet-300 hover:text-violet-700 ${focusRing}`}
        >
          <TrashIcon className="h-4 w-4" /> Limpiar todo
        </button>
      </div>

      {/* 1. Filtros */}
      <div className="flex flex-col gap-3">
        <StepTitle
          n={1}
          title="Filtros de apuestas"
          text="Selecciona el subconjunto de apuestas que deseas incluir en el reporte."
        />
        <div className="grid gap-x-3 gap-y-2.5 @[30rem]:grid-cols-2 @[52rem]:grid-cols-[minmax(16.5rem,1.6fr)_repeat(3,minmax(0,1fr))]">
          <fieldset className="flex min-w-0 flex-col gap-1.5 @[52rem]:col-span-1">
            <legend className="mb-1.5 text-[0.8125rem] font-semibold text-slate-800">
              Rango de fechas
            </legend>
            <div className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-surface-2 px-2.5 focus-within:border-violet-500">
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <input
                type="date"
                aria-label="Desde"
                value={draft.from}
                max={draft.to || undefined}
                onChange={(e) => set('from', e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 tabular-nums focus:outline-none"
              />
              <span className="text-slate-500" aria-hidden="true">
                →
              </span>
              <input
                type="date"
                aria-label="Hasta"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(e) => set('to', e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 tabular-nums focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-x-2.5 text-xs" aria-label="Más periodos">
              {MORE_SHORTCUTS.map((sc) => (
                <button
                  key={sc.key}
                  type="button"
                  aria-pressed={activeShortcut === sc.key}
                  onClick={() => onShortcut(sc.key)}
                  className={`rounded underline-offset-2 hover:underline ${focusRing} ${activeShortcut === sc.key ? 'font-semibold text-violet-700' : 'text-slate-500'}`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field
            label="Casa de apuestas"
            value={draft.houseId}
            onChange={(v) => set('houseId', v)}
            options={[
              { value: '', label: 'Todas' },
              ...houses.map((h) => ({ value: h.id, label: h.name })),
            ]}
          />
          <Field
            label="Tipo de apuesta"
            value={draft.betType}
            onChange={(v) => set('betType', v as ReportDraft['betType'])}
            options={[
              { value: '', label: 'Todos' },
              { value: 'SIMPLE', label: 'Simple' },
              { value: 'CREATED', label: 'Creada' },
              { value: 'MULTIPLE', label: 'Múltiple' },
            ]}
          />
          <Field
            label="Resultado"
            value={draft.status}
            onChange={(v) => set('status', v as ReportDraft['status'])}
            options={[
              { value: '', label: 'Todos' },
              { value: 'WON', label: 'Ganada' },
              { value: 'LOST', label: 'Perdida' },
              { value: 'PENDING', label: 'Pendiente' },
              { value: 'VOID', label: 'Anulada' },
              { value: 'CASHOUT', label: 'Cash Out' },
            ]}
          />
          <Field
            label="Origen del registro"
            value={draft.origin}
            onChange={(v) => set('origin', v as ReportDraft['origin'])}
            options={[
              { value: '', label: 'Todos' },
              { value: 'MANUAL', label: 'Manual' },
              { value: 'IMPORTED', label: 'Importada' },
            ]}
          />
          <Field
            label="Deporte"
            icon={<SoccerBallIcon />}
            value={draft.sport}
            onChange={(v) => set('sport', v)}
            options={[
              { value: '', label: 'Todos' },
              ...sports.map((s) => ({ value: s, label: s })),
            ]}
          />
          <Field
            label="Mercado"
            icon={<TagIcon />}
            value={draft.market}
            onChange={(v) => set('market', v)}
            options={[
              { value: '', label: 'Todos' },
              ...markets.map((m) => ({ value: m, label: m })),
            ]}
          />
          <Field
            label="Etapa"
            icon={<LayersIcon />}
            value={draft.stageId}
            onChange={(v) => set('stageId', v)}
            options={[
              { value: '', label: 'Todas' },
              ...stages.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={onApply}
            disabled={rangeError}
            className={`inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-[0_0_18px_-6px_rgba(124,58,237,0.9)] hover:bg-violet-500 disabled:opacity-50 ${focusRing}`}
          >
            <FilterIcon className="h-4 w-4" /> Aplicar filtros
          </button>
          <p className="text-sm text-slate-500" aria-live="polite">
            {rangeError
              ? 'El «desde» no puede ser posterior al «hasta».'
              : found === null
                ? 'Buscando apuestas…'
                : `${found} ${found === 1 ? 'apuesta encontrada' : 'apuestas encontradas'}`}
            {dirty && !rangeError && (
              <span className="ml-2 text-amber-700">· Hay cambios sin aplicar</span>
            )}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Fechas en la zona horaria del proyecto: una apuesta liquidada cuenta por su fecha de
          liquidación; una pendiente, por la de colocación.
        </p>
      </div>

      <hr className="border-slate-200/70" />

      {/* 2. Contenido */}
      <div className="flex flex-col gap-3">
        <StepTitle
          n={2}
          title="Contenido del reporte"
          text="Selecciona las secciones que deseas incluir en el PDF."
        />
        <ul className="grid gap-2.5 @[30rem]:grid-cols-2 @[52rem]:grid-cols-3">
          {SECTION_CARDS.map((card) => {
            const disabled = card.key === 'tickets' && !ticketsAllowed;
            const checked = options.sections.includes(card.key) && !disabled;
            return (
              <li key={card.key}>
                <label
                  className={`flex h-full cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${checked ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 bg-surface-2'} ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-violet-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(card.key)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-violet-600"
                  />
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 [&>svg]:h-5 [&>svg]:w-5"
                    aria-hidden="true"
                  >
                    {card.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{card.title}</span>
                    <span className="block text-xs text-slate-500">
                      {disabled ? 'Tu rol no permite ver tickets.' : card.text}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <hr className="border-slate-200/70" />

      {/* 3. Agrupar / ordenar */}
      <div className="flex flex-col gap-3">
        <StepTitle
          n={3}
          title="Agrupar / ordenar"
          text="Define cómo se organizará la información del reporte."
        />
        <div className="grid gap-3 @[40rem]:grid-cols-3">
          <Field
            label="Agrupar por"
            value={options.groupBy}
            onChange={(v) => onOptions({ ...options, groupBy: v as ReportOptions['groupBy'] })}
            options={[
              { value: 'none', label: 'Sin agrupar' },
              { value: 'date', label: 'Fecha (mes)' },
              { value: 'house', label: 'Casa de apuestas' },
              { value: 'status', label: 'Resultado' },
              { value: 'betType', label: 'Tipo de apuesta' },
            ]}
          />
          <Field
            label="Ordenar por"
            value={options.sortBy}
            onChange={(v) => onOptions({ ...options, sortBy: v as ReportOptions['sortBy'] })}
            options={[
              { value: 'date', label: 'Fecha' },
              { value: 'amount', label: 'Monto' },
              { value: 'odds', label: 'Cuota' },
              { value: 'profit', label: 'Ganancia' },
            ]}
          />
          <Field
            label="Dirección"
            value={options.direction}
            onChange={(v) => onOptions({ ...options, direction: v as ReportOptions['direction'] })}
            options={[
              { value: 'desc', label: 'Descendente' },
              { value: 'asc', label: 'Ascendente' },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
