import {
  ErrorCode,
  formatPEN,
  type HouseSummary,
  type ImportBatchSummaryRow,
  type SaveImportStagePlanInput,
  type StageCandidate,
} from '@letfer/shared';
import { cloneElement, type FormEvent, type ReactElement, useState } from 'react';
import { ApiError } from '../../../api/client.js';
import { useConfirmImportHouse, useSaveImportStagePlan } from '../../../hooks/useImportBatches.js';
import type { Loaded } from '../../../hooks/useLoad.js';
import { formatDateTime, STAGE_STATUS_LABELS } from '../../../labels.js';
import { Badge, btn, btnPrimary, inputClass, Notice, Section } from '../../../ui.js';
import { fromLocalInput, toLocalInput } from '../../../date-inputs.js';
import { useProject } from '../ProjectContext.js';
import { apiIssues, ImportActionError, isBatchOpen } from './ImportsCommon.js';

/*
 * Resolución humana de un lote (Fase 9.4.6, D-X8 y D-X7): la persona elige la casa y escribe el plan
 * de etapas; la API valida y guarda. La interfaz no deriva claves de etapa ni stakes, no crea
 * etapas reales y no repite las reglas del plan (`validateImportStagePlan`): muestra los problemas
 * que devuelve la API.
 */

/** Solo se ofrece editar con `import.run` y mientras el lote está abierto (`isBatchOpen`). */
function useCanResolve(batch: ImportBatchSummaryRow): boolean {
  const { can } = useProject();
  return can('import.run') && isBatchOpen(batch);
}

// --- Casa (D-X8) ------------------------------------------------------------------------------

export function HouseResolutionPanel({
  batch,
  houses,
  houseCandidate,
  onSaved,
  onNotice,
}: {
  batch: ImportBatchSummaryRow;
  /** Casas del proyecto, cargadas por la página (también las usa la preparación de confirmación). */
  houses: Loaded<HouseSummary[]>;
  /** Nombre derivado del archivo por la API (vista previa); `null` mientras no ha cargado. */
  houseCandidate: string | null;
  onSaved: (batch: ImportBatchSummaryRow) => void;
  onNotice: (message: string) => void;
}) {
  const { project } = useProject();
  const canResolve = useCanResolve(batch);
  const { confirmHouse, loading, error } = useConfirmImportHouse(project.id, batch.id);
  const [selected, setSelected] = useState<string | null>(null);

  const current = houses.data?.find((house) => house.id === batch.houseId) ?? null;
  // Solo una sugerencia para no buscarla en la lista: la persona decide y confirma (D-X8).
  const suggested =
    houseCandidate === null
      ? undefined
      : houses.data?.find(
          (house) => house.name.trim().toLowerCase() === houseCandidate.trim().toLowerCase(),
        );
  const value = selected ?? batch.houseId ?? suggested?.id ?? '';
  const correcting = batch.houseId !== null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const updated = await confirmHouse({ houseId: value });
      setSelected(null);
      onNotice(correcting ? 'Se corrigió la casa del lote.' : 'Se confirmó la casa del lote.');
      onSaved(updated);
    } catch {
      // El hook ya dejó el mensaje en `error`.
    }
  }

  return (
    <Section title="Casa del lote">
      <p className="text-sm text-slate-600">
        Todas las apuestas del archivo se registrarán en esta casa. Confirmarla no escribe nada en
        el ledger.
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-600">Casa candidata (según el nombre del archivo)</dt>
          <dd>{houseCandidate ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Casa confirmada</dt>
          <dd>
            {batch.houseId === null ? (
              <Badge tone="amber">Sin confirmar</Badge>
            ) : (
              (current?.name ?? (houses.data ? 'Casa no disponible' : '…'))
            )}
          </dd>
        </div>
      </dl>
      {houses.error && <Notice tone="error">{houses.error}</Notice>}
      {canResolve && houses.data && (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-wrap items-end gap-3"
          aria-label="Casa del lote"
        >
          <label className="flex min-w-48 flex-col gap-1 text-sm font-medium">
            Casa
            <select
              value={value}
              onChange={(event) => setSelected(event.target.value)}
              className={inputClass}
              disabled={loading}
            >
              <option value="" disabled>
                Elige una casa
              </option>
              {houses.data.map((house: HouseSummary) => (
                <option key={house.id} value={house.id}>
                  {house.name}
                  {house.status === 'INACTIVE' ? ' (desactivada)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className={btnPrimary}
            disabled={loading || value === '' || value === batch.houseId}
          >
            {loading ? 'Guardando…' : correcting ? 'Corregir casa' : 'Confirmar casa'}
          </button>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Section>
  );
}

// --- Plan de etapas (D-X7) --------------------------------------------------------------------

type PlanStatus = SaveImportStagePlanInput['stages'][number]['status'];

/** Una etapa tal como se edita: todo texto, igual que en el formulario (se convierte al enviar). */
interface PlanRow {
  rowKey: number;
  key: string;
  name: string;
  unitStake: string;
  startsAt: string;
  status: PlanStatus;
  firstRow: string;
  lastRow: string;
}

/** El plan tal como lo guarda la API en `import_batches.stage_plan` (`serializeStagePlan`). */
interface SavedStagePlan {
  stages: {
    key: string;
    name: string;
    unitStake: string;
    startsAt: string | null;
    status: PlanStatus;
    firstRow: number;
    lastRow: number;
  }[];
}

let nextRowKey = 0;

/**
 * Las filas que se derivan al pintar (del plan guardado o de los candidatos) usan claves negativas
 * por posición, sin efectos en el render; las que añade la persona, el contador (siempre positivo),
 * así nunca coinciden.
 */
const blankRow = (rowKey: number): PlanRow => ({
  rowKey,
  key: '',
  name: '',
  unitStake: '',
  startsAt: '',
  status: 'CLOSED',
  firstRow: '',
  lastRow: '',
});

const emptyRow = (): PlanRow => blankRow(nextRowKey++);

/**
 * Un candidato solo aporta su rango de filas y su etiqueta como nombre inicial: la clave, la unidad,
 * la fecha y el estado los escribe la persona (D-X7 no está resuelta, no se deducen).
 */
const rowsFromCandidates = (candidates: StageCandidate[]): PlanRow[] =>
  candidates.map((candidate, index) => ({
    ...blankRow(-(index + 1)),
    name: candidate.label ?? '',
    firstRow: String(candidate.firstRow),
    lastRow: String(candidate.lastRow),
  }));

const rowsFromSaved = (plan: SavedStagePlan): PlanRow[] =>
  plan.stages.map((stage, index) => ({
    rowKey: -(index + 1),
    key: stage.key,
    name: stage.name,
    unitStake: stage.unitStake,
    startsAt: toLocalInput(stage.startsAt),
    status: stage.status,
    firstRow: String(stage.firstRow),
    lastRow: String(stage.lastRow),
  }));

export function savedPlan(batch: ImportBatchSummaryRow): SavedStagePlan | null {
  return (batch.stagePlan as SavedStagePlan | null) ?? null;
}

const FIELD_LABELS: Record<string, string> = {
  key: 'clave',
  name: 'nombre',
  unitStake: 'unidad',
  startsAt: 'fecha de inicio',
  status: 'estado',
  firstRow: 'primera fila',
  lastRow: 'última fila',
};

/**
 * Problemas de un plan rechazado, tal como los da la API: del esquema (`details` con `path` y
 * `message`) o de `validateImportStagePlan` (`details.issues`). Vacío si el error es de otro tipo.
 */
function planIssues(caught: unknown): string[] {
  if (!(caught instanceof ApiError) || caught.code !== ErrorCode.VALIDATION_FAILED) return [];
  const details = caught.body.details;
  if (Array.isArray(details)) {
    return (details as { path?: string; message?: string }[]).map((issue) => {
      const [, index, field] = (issue.path ?? '').split('.');
      const where =
        index === undefined
          ? ''
          : `Etapa ${Number(index) + 1}${field ? `, ${FIELD_LABELS[field] ?? field}` : ''}: `;
      return `${where}${issue.message ?? ''}`;
    });
  }
  return apiIssues(caught);
}

export function StagePlanPanel({
  batch,
  candidates,
  onSaved,
  onNotice,
}: {
  batch: ImportBatchSummaryRow;
  /** Candidatos de la vista previa; `null` mientras no ha cargado. */
  candidates: StageCandidate[] | null;
  onSaved: (batch: ImportBatchSummaryRow) => void;
  onNotice: (message: string) => void;
}) {
  const { project } = useProject();
  const canResolve = useCanResolve(batch);
  const { saveStagePlan, loading, error } = useSaveImportStagePlan(project.id, batch.id);
  const saved = savedPlan(batch);
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  // Mientras no se toca, el formulario parte del plan guardado o, si no hay, de los candidatos.
  const editing =
    rows ??
    (saved
      ? rowsFromSaved(saved)
      : candidates && candidates.length > 0
        ? rowsFromCandidates(candidates)
        : [blankRow(-1)]);

  function update(rowKey: number, patch: Partial<PlanRow>) {
    setRows(editing.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssues([]);
    const input: SaveImportStagePlanInput = {
      stages: editing.map((row) => ({
        key: row.key,
        name: row.name,
        unitStake: row.unitStake,
        startsAt: row.startsAt ? (fromLocalInput(row.startsAt) ?? row.startsAt) : null,
        status: row.status,
        firstRow: Number(row.firstRow),
        lastRow: Number(row.lastRow),
      })),
    };
    try {
      const updated = await saveStagePlan(input);
      setRows(null);
      onNotice('Se guardó el plan de etapas.');
      onSaved(updated);
    } catch (caught) {
      setIssues(planIssues(caught));
    }
  }

  return (
    <Section title="Plan de etapas">
      <p className="text-sm text-slate-600">
        Cada etapa del plan agrupa un rango de filas del archivo. Guardar el plan no crea etapas:
        solo se crean al confirmar el lote.
      </p>

      <h3 className="text-sm font-medium">Candidatos detectados en el archivo</h3>
      {candidates === null && <p className="text-sm">Cargando candidatos…</p>}
      {candidates !== null && candidates.length === 0 && (
        <p className="text-sm text-slate-600">
          La vista previa no propone etapas: define el plan a mano.
        </p>
      )}
      {candidates !== null && candidates.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Candidatos de etapa">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-1 pr-3 font-medium">Etiqueta</th>
                <th className="py-1 pr-3 font-medium">Filas</th>
                <th className="py-1 font-medium">Evidencia</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.firstRow} className="border-b border-slate-100">
                  <td className="py-1 pr-3">{candidate.label ?? '—'}</td>
                  <td className="py-1 pr-3">
                    {candidate.firstRow}–{candidate.lastRow}
                  </td>
                  <td className="py-1">{candidate.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!canResolve && <SavedPlanTable plan={saved} />}

      {canResolve && (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex flex-col gap-3"
          aria-label="Plan de etapas"
          noValidate
        >
          <h3 className="text-sm font-medium">
            {saved ? 'Plan guardado (editable)' : 'Plan propuesto'}
          </h3>
          {editing.map((row, index) => (
            <fieldset
              key={row.rowKey}
              className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-3"
            >
              <legend className="px-1 text-sm font-medium">Etapa {index + 1}</legend>
              <PlanField label={`Clave de la etapa ${index + 1}`} text="Clave">
                <input
                  value={row.key}
                  onChange={(event) => update(row.rowKey, { key: event.target.value })}
                  className={inputClass}
                />
              </PlanField>
              <PlanField label={`Nombre de la etapa ${index + 1}`} text="Nombre">
                <input
                  value={row.name}
                  onChange={(event) => update(row.rowKey, { name: event.target.value })}
                  className={inputClass}
                />
              </PlanField>
              <PlanField label={`Unidad de la etapa ${index + 1}`} text="Unidad">
                <input
                  value={row.unitStake}
                  onChange={(event) => update(row.rowKey, { unitStake: event.target.value })}
                  className={inputClass}
                  placeholder="10.00"
                />
              </PlanField>
              <PlanField label={`Inicio de la etapa ${index + 1}`} text="Fecha de inicio">
                <input
                  type="datetime-local"
                  value={row.startsAt}
                  onChange={(event) => update(row.rowKey, { startsAt: event.target.value })}
                  className={inputClass}
                />
              </PlanField>
              <PlanField label={`Estado de la etapa ${index + 1}`} text="Estado">
                <select
                  value={row.status}
                  onChange={(event) =>
                    update(row.rowKey, { status: event.target.value as PlanStatus })
                  }
                  className={inputClass}
                >
                  <option value="CLOSED">{STAGE_STATUS_LABELS.CLOSED}</option>
                  <option value="ACTIVE">{STAGE_STATUS_LABELS.ACTIVE}</option>
                </select>
              </PlanField>
              <PlanField label={`Primera fila de la etapa ${index + 1}`} text="Primera fila">
                <input
                  type="number"
                  min={1}
                  value={row.firstRow}
                  onChange={(event) => update(row.rowKey, { firstRow: event.target.value })}
                  className={inputClass}
                />
              </PlanField>
              <PlanField label={`Última fila de la etapa ${index + 1}`} text="Última fila">
                <input
                  type="number"
                  min={1}
                  value={row.lastRow}
                  onChange={(event) => update(row.rowKey, { lastRow: event.target.value })}
                  className={inputClass}
                />
              </PlanField>
              <button
                type="button"
                className={btn}
                disabled={editing.length === 1}
                onClick={() => setRows(editing.filter((other) => other.rowKey !== row.rowKey))}
                aria-label={`Quitar la etapa ${index + 1}`}
              >
                Quitar
              </button>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => setRows([...editing, emptyRow()])}>
              Añadir etapa
            </button>
            {candidates !== null && candidates.length > 0 && (
              <button
                type="button"
                className={btn}
                onClick={() => setRows(rowsFromCandidates(candidates))}
              >
                Partir de los candidatos
              </button>
            )}
          </div>

          <ImportActionError
            error={issues.length > 0 ? 'La API rechazó el plan:' : error}
            issues={issues}
          />
          <button type="submit" disabled={loading} className={`${btnPrimary} self-start`}>
            {loading ? 'Guardando…' : 'Guardar plan'}
          </button>
        </form>
      )}
    </Section>
  );
}

function PlanField({
  label,
  text,
  children,
}: {
  label: string;
  text: string;
  children: ReactElement<{ 'aria-label'?: string }>;
}) {
  // El texto visible es corto ("Clave"); el nombre accesible dice de qué etapa es cada control.
  return (
    <label className="flex w-36 flex-col gap-1 text-xs text-slate-600">
      {text}
      {cloneElement(children, { 'aria-label': label })}
    </label>
  );
}

function SavedPlanTable({ plan }: { plan: SavedStagePlan | null }) {
  if (!plan) return <p className="text-sm text-slate-600">Todavía no hay un plan guardado.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Plan de etapas guardado">
        <thead>
          <tr className="border-b border-slate-200 text-slate-600">
            <th className="py-1 pr-3 font-medium">Clave</th>
            <th className="py-1 pr-3 font-medium">Nombre</th>
            <th className="py-1 pr-3 font-medium">Unidad</th>
            <th className="py-1 pr-3 font-medium">Inicio</th>
            <th className="py-1 pr-3 font-medium">Estado</th>
            <th className="py-1 font-medium">Filas</th>
          </tr>
        </thead>
        <tbody>
          {plan.stages.map((stage) => (
            <tr key={stage.key} className="border-b border-slate-100">
              <td className="py-1 pr-3">{stage.key}</td>
              <td className="py-1 pr-3">{stage.name}</td>
              <td className="py-1 pr-3">{formatPEN(stage.unitStake)}</td>
              <td className="py-1 pr-3">{stage.startsAt ? formatDateTime(stage.startsAt) : '—'}</td>
              <td className="py-1 pr-3">{STAGE_STATUS_LABELS[stage.status]}</td>
              <td className="py-1">
                {stage.firstRow}–{stage.lastRow}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
