import { useEffect, useMemo, useRef, useState } from 'react';
import { dashboardApi } from '../../api/dashboard.js';
import { describeApiError } from '../../api/errors.js';
import { housesApi, stagesApi } from '../../api/finance.js';
import { reportsApi } from '../../api/reports.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  DocumentIcon,
  DownloadIcon,
  EyeIcon,
  SpinnerIcon,
} from '../../icons.js';
import { todayInZone } from '../../time-zone.js';
import { Modal, Notice } from '../../ui.js';
import { AnalysisBreakdowns, PerformanceSection } from './reports/AnalysisSections.js';
import { PdfPreview, PdfSettings } from './reports/PdfPreview.js';
import { ReportBetsTable } from './reports/ReportBetsTable.js';
import { ReportBuilder } from './reports/ReportBuilder.js';
import {
  activeShortcut,
  DEFAULT_OPTIONS,
  defaultFileName,
  EMPTY_DRAFT,
  periodLabel,
  RANGE_SHORTCUTS,
  sanitizeFileName,
  shortcutRange,
  toReportFilters,
  validRange,
  type RangeShortcut,
  type ReportDraft,
  type ReportOptions,
} from './reports/report-query.js';
import { useProject } from './ProjectContext.js';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
type PdfState =
  | { kind: 'idle' }
  | { kind: 'busy'; mode: 'download' | 'preview' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const dmy = (date: string) =>
  date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—';

/**
 * Reportes (§33, §108, §108.11; referencia «Panel de reportes»): constructor de reporte con filtros
 * reales, vista previa y generación de un PDF con el resumen y TODAS las apuestas del alcance. El
 * panel, la vista previa y el PDF usan el MISMO estado aplicado (`toReportFilters(applied)`) y los
 * datos del backend (`/reports/data`, `/reports/pdf`): ninguna métrica se calcula en la web.
 */
export function ReportsPage() {
  const { project, can } = useProject();
  const today = todayInZone();
  const [draft, setDraft] = useState<ReportDraft>(() => ({
    ...EMPTY_DRAFT,
    ...shortcutRange('30D', today),
  }));
  const [applied, setApplied] = useState<ReportDraft>(draft);
  const [options, setOptions] = useState<ReportOptions>(DEFAULT_OPTIONS);
  const [customName, setCustomName] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfState>({ kind: 'idle' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const busy = useRef(false);

  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const stages = useLoad(`stages:${project.id}`, () => stagesApi.list(project.id));
  // Catálogo de deportes y mercados del proyecto (los de sus apuestas liquidadas).
  const catalog = useLoad(`report-catalog:${project.id}`, () => dashboardApi.analysis(project.id));
  const filters = useMemo(() => toReportFilters(applied), [applied]);
  const report = useLoad(`report:${project.id}:${JSON.stringify(filters)}`, () =>
    reportsApi.data(project.id, filters),
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const rangeError = !validRange(draft);
  const period = periodLabel(applied);
  const fileName = customName ?? defaultFileName(project.name, applied);
  const keys = (items: { key: string }[] | undefined) =>
    (items ?? []).map((i) => i.key).filter((k) => k !== 'Mixto' && k !== 'Sin especificar');

  useEffect(() => {
    if (pdf.kind !== 'ready') return;
    const timer = window.setTimeout(() => setPdf({ kind: 'idle' }), 3000);
    return () => window.clearTimeout(timer);
  }, [pdf]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const applyRange = (key: RangeShortcut) => {
    const next = { ...draft, ...shortcutRange(key, today) };
    setDraft(next);
    setApplied(next);
  };
  const apply = () => {
    if (!rangeError) setApplied(draft);
  };
  const clear = () => {
    const next = { ...EMPTY_DRAFT, ...shortcutRange('30D', today) };
    setDraft(next);
    setApplied(next);
    setOptions(DEFAULT_OPTIONS);
    setCustomName(null);
  };

  /** Genera el PDF con el alcance APLICADO (el mismo que muestra el panel). */
  async function generate(mode: 'download' | 'preview') {
    if (busy.current) return; // sin peticiones duplicadas por doble clic
    busy.current = true;
    setPdf({ kind: 'busy', mode });
    try {
      const blob = await reportsApi.pdf(project.id, {
        ...filters,
        sections: options.sections,
        groupBy: options.groupBy,
        sortBy: options.sortBy,
        direction: options.direction,
        orientation: options.orientation,
        paper: options.paper,
        periodLabel: period,
      });
      const url = URL.createObjectURL(blob);
      if (mode === 'preview') {
        setPreviewUrl(url);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = sanitizeFileName(fileName);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      setPdf({ kind: 'ready' });
    } catch (error) {
      setPdf({ kind: 'error', message: describeApiError(error) });
    } finally {
      busy.current = false;
    }
  }

  const shortcut = activeShortcut(applied, today);
  const generating = pdf.kind === 'busy';
  const noSections = options.sections.length === 0;

  return (
    <div data-page="reports" className="@container flex flex-col gap-4">
      {/* Encabezado: título, atajos de rango, rango aplicado y acciones del PDF. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"
            aria-hidden="true"
          >
            <DocumentIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[1.75rem] leading-tight font-bold tracking-tight text-slate-900">
              Reportes
            </h2>
            <p className="text-[0.8125rem] text-slate-500">
              Genera informes PDF con todas tus apuestas o con subconjuntos filtrados según tus
              criterios.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Atajos de periodo" className="flex flex-wrap gap-1.5">
            {RANGE_SHORTCUTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={shortcut === s.key}
                onClick={() => applyRange(s.key)}
                className={`h-9 rounded-lg px-2.5 text-xs font-medium transition-colors ${focusRing} ${
                  shortcut === s.key
                    ? 'bg-violet-600 text-white shadow-[0_0_16px_-6px_rgba(124,58,237,0.9)]'
                    : 'border border-slate-200 bg-surface text-slate-700 hover:border-violet-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p
            className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 text-xs text-slate-700 tabular-nums"
            aria-label={`Periodo aplicado: ${period}`}
          >
            <CalendarIcon className="h-4 w-4 text-slate-500" />
            {applied.from || applied.to ? (
              <>
                {dmy(applied.from)} <span className="text-slate-400">→</span> {dmy(applied.to)}
              </>
            ) : (
              'Todo el historial'
            )}
          </p>
          <button
            type="button"
            onClick={() => void generate('preview')}
            disabled={generating || noSections}
            className={`h-9 rounded-lg border border-violet-400/70 px-3.5 text-[0.8125rem] font-semibold text-slate-900 hover:bg-violet-50 disabled:opacity-50 ${focusRing}`}
          >
            {pdf.kind === 'busy' && pdf.mode === 'preview' ? 'Generando…' : 'Vista previa'}
          </button>
          <button
            type="button"
            onClick={() => void generate('download')}
            disabled={generating || noSections}
            aria-busy={generating}
            className={`inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3.5 text-[0.8125rem] font-semibold text-white shadow-[0_0_22px_-6px_rgba(124,58,237,0.95)] hover:bg-violet-500 disabled:opacity-60 ${focusRing}`}
          >
            {pdf.kind === 'busy' && pdf.mode === 'download' ? (
              <>
                <SpinnerIcon className="h-4 w-4 animate-spin" /> Generando…
              </>
            ) : pdf.kind === 'ready' ? (
              <>
                <CheckIcon className="h-4 w-4" /> PDF listo
              </>
            ) : (
              <>
                <DownloadIcon className="h-4 w-4" /> Generar PDF
              </>
            )}
          </button>
        </div>
      </div>

      {pdf.kind === 'error' && (
        <Notice tone="error">No se pudo generar el PDF: {pdf.message}</Notice>
      )}
      {noSections && (
        <Notice tone="info">Elige al menos una sección del contenido para generar el PDF.</Notice>
      )}

      <div className="grid gap-4 @[72rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ReportBuilder
          draft={draft}
          onDraft={setDraft}
          options={options}
          onOptions={setOptions}
          houses={houses.data ?? []}
          stages={stages.data ?? []}
          sports={keys(catalog.data?.bySport)}
          markets={keys(catalog.data?.byMarket)}
          onApply={apply}
          onClear={clear}
          found={report.data && !report.loading ? report.data.totals.bets : null}
          dirty={dirty}
          rangeError={rangeError}
          ticketsAllowed={can('tickets.view')}
          onShortcut={applyRange}
          activeShortcut={shortcut}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <PdfPreview
            data={report.data}
            projectName={project.name}
            period={period}
            options={options}
            loading={report.loading}
          />
          <PdfSettings
            options={options}
            onOptions={setOptions}
            fileName={fileName}
            onFileName={(name) => setCustomName(name)}
          />
        </div>
      </div>

      <ReportBetsTable
        bets={report.data?.bets ?? null}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        options={options}
        onSort={(sortBy) =>
          setOptions({
            ...options,
            sortBy,
            direction: options.sortBy === sortBy && options.direction === 'desc' ? 'asc' : 'desc',
          })
        }
        projectPath={`/projects/${project.id}`}
      />

      {report.data && (
        <AnalysisBreakdowns analysis={report.data.analysis} loading={report.loading} />
      )}
      <PerformanceSection projectId={project.id} />

      {previewUrl && (
        <Modal
          onClose={() => setPreviewUrl(null)}
          ariaLabel="Vista previa del PDF"
          widthClassName="sm:max-w-5xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <EyeIcon className="h-5 w-5 text-violet-500" /> Vista previa del PDF
            </h2>
            <div className="flex items-center gap-2">
              <a
                href={previewUrl}
                download={sanitizeFileName(fileName)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-500 ${focusRing}`}
              >
                <DownloadIcon className="h-4 w-4" /> Descargar PDF
              </a>
              <button
                type="button"
                onClick={() => setPreviewUrl(null)}
                aria-label="Cerrar"
                className={`rounded-lg p-2 text-slate-500 hover:text-slate-900 ${focusRing}`}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
          <iframe title="PDF del reporte" src={previewUrl} className="h-[78vh] w-full bg-white" />
        </Modal>
      )}
    </div>
  );
}
