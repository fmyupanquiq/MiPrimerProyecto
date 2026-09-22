import { createStageSchema, formatPEN, type StageStatus, type StageSummary } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { describeApiError } from '../../api/errors.js';
import { stagesApi } from '../../api/finance.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { formatDate, STAGE_STATUS_LABELS } from '../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../ui.js';
import { useProject } from './ProjectContext.js';

const TONE: Record<StageStatus, 'green' | 'slate' | 'red'> = {
  ACTIVE: 'green',
  CLOSED: 'slate',
  TRASHED: 'red',
};

/** Etapas del proyecto (§11, §12, §86). */
export function StagesPage() {
  const { project, can } = useProject();
  const [showTrashed, setShowTrashed] = useState(false);
  const canSeeTrashed = can('stages.restore');
  const stages = useLoad(`stages:${project.id}:${showTrashed}`, () =>
    stagesApi.list(project.id, showTrashed ? 'TRASHED' : undefined),
  );
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!project.setupComplete) {
    return (
      <Notice tone="info">
        Completa primero la{' '}
        <Link to={`/projects/${project.id}/setup`} className="underline">
          configuración inicial del proyecto
        </Link>
        .
      </Notice>
    );
  }

  return (
    <>
      {notice && <Notice tone="success">{notice}</Notice>}
      <Section title="Etapas">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {canSeeTrashed && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showTrashed}
                onChange={(event) => setShowTrashed(event.target.checked)}
              />
              Ver la papelera
            </label>
          )}
          {can('stages.create') && !showForm && (
            <button type="button" className={btnPrimary} onClick={() => setShowForm(true)}>
              Nueva etapa
            </button>
          )}
        </div>

        {showForm && (
          <NewStageForm
            onDone={(message) => {
              setShowForm(false);
              setNotice(message);
              stages.reload();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {stages.error && <Notice tone="error">{stages.error}</Notice>}
        {stages.loading && !stages.data && <p>Cargando etapas…</p>}
        {stages.data && stages.data.length === 0 && (
          <Notice tone="info">{showTrashed ? 'La papelera está vacía.' : 'No hay etapas.'}</Notice>
        )}
        <ul className="flex flex-col gap-3">
          {stages.data?.map((stage) => (
            <StageRow
              key={stage.id}
              stage={stage}
              showTrashed={showTrashed}
              onChanged={(message) => {
                setNotice(message);
                stages.reload();
              }}
            />
          ))}
        </ul>
      </Section>
    </>
  );
}

function NewStageForm({
  onDone,
  onCancel,
}: {
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const [name, setName] = useState('');
  const [unitStake, setUnitStake] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = createStageSchema.safeParse({
      name: name.trim() === '' ? undefined : name,
      unitStake,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await stagesApi.create(project.id, parsed.data);
      onDone(`Se activó «${created.name}»; la etapa anterior quedó cerrada.`);
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3 rounded border border-slate-200 p-3"
      aria-label="Nueva etapa"
      noValidate
    >
      <p className="text-sm text-slate-600">
        Crear una etapa nueva cierra la etapa activa actual y activa esta.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nombre (opcional)
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
            placeholder="Se autogenera si lo dejas vacío"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Unidad de stake
          <input
            value={unitStake}
            onChange={(event) => setUnitStake(event.target.value)}
            className={inputClass}
            placeholder="10.00"
          />
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Creando…' : 'Crear y activar'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function StageRow({
  stage,
  showTrashed,
  onChanged,
}: {
  stage: StageSummary;
  showTrashed: boolean;
  onChanged: (message: string) => void;
}) {
  const { project, can } = useProject();
  const runWithReauth = useReauth();
  const [correcting, setCorrecting] = useState(false);
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function trash() {
    setBusy(true);
    setError(null);
    try {
      await stagesApi.trash(project.id, stage.id);
      onChanged(`«${stage.name}» se envió a la papelera.`);
      setConfirmingTrash(false);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() => stagesApi.restore(project.id, stage.id));
      onChanged(`«${stage.name}» se restauró.`);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {stage.name}{' '}
            <Badge tone={TONE[stage.status]}>{STAGE_STATUS_LABELS[stage.status]}</Badge>
          </p>
          <p className="text-sm text-slate-600">Unidad: {formatPEN(stage.unitStake)}</p>
          <p className="text-xs text-slate-500">Creada el {formatDate(stage.createdAt)}</p>
        </div>
        <div className="flex gap-2">
          {!showTrashed && stage.status !== 'TRASHED' && can('stages.correct_unit') && (
            <button type="button" className={btn} onClick={() => setCorrecting((v) => !v)}>
              Corregir unidad
            </button>
          )}
          {!showTrashed && stage.status === 'CLOSED' && can('stages.trash') && !confirmingTrash && (
            <button type="button" className={btn} onClick={() => setConfirmingTrash(true)}>
              Enviar a la papelera
            </button>
          )}
          {showTrashed && can('stages.restore') && (
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={() => void restore()}
            >
              Restaurar
            </button>
          )}
        </div>
      </div>

      {confirmingTrash && (
        <div
          className="mt-2 flex items-center gap-2"
          role="group"
          aria-label={`Enviar ${stage.name} a la papelera`}
        >
          <p className="text-sm">¿Enviar «{stage.name}» a la papelera?</p>
          <button type="button" className={btnDanger} disabled={busy} onClick={() => void trash()}>
            Confirmar
          </button>
          <button type="button" className={btn} onClick={() => setConfirmingTrash(false)}>
            Cancelar
          </button>
        </div>
      )}

      {correcting && (
        <CorrectUnitForm
          stage={stage}
          onDone={(message) => {
            setCorrecting(false);
            onChanged(message);
          }}
          onCancel={() => setCorrecting(false)}
        />
      )}

      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

function CorrectUnitForm({
  stage,
  onDone,
  onCancel,
}: {
  stage: StageSummary;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const runWithReauth = useReauth();
  const [unitStake, setUnitStake] = useState(stage.unitStake);
  const [preview, setPreview] = useState<{
    newUnitStake: string;
    affectedBets: number;
    impact: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await stagesApi.correctUnit(project.id, stage.id, {
        unitStake,
        confirm: false,
      });
      if ('newUnitStake' in result) setPreview(result);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() =>
        stagesApi.correctUnit(project.id, stage.id, { unitStake, confirm: true }),
      );
      onDone(`Se corrigió la unidad de «${stage.name}» a ${formatPEN(unitStake)}.`);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3">
      {!preview ? (
        <form
          onSubmit={(event) => void onPreview(event)}
          className="flex flex-wrap items-end gap-2"
          noValidate
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nueva unidad
            <input
              value={unitStake}
              onChange={(event) => setUnitStake(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={busy} className={btnPrimary}>
            Ver impacto
          </button>
          <button type="button" className={btn} onClick={onCancel}>
            Cancelar
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Unidad actual: <strong>{formatPEN(stage.unitStake)}</strong> → nueva:{' '}
            <strong>{formatPEN(preview.newUnitStake)}</strong>
          </p>
          <p className="text-sm text-slate-600">
            Apuestas afectadas: {preview.affectedBets}. {preview.impact}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className={btnPrimary}
              onClick={() => void onConfirm()}
            >
              Confirmar corrección
            </button>
            <button type="button" className={btn} onClick={() => setPreview(null)}>
              Volver
            </button>
          </div>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
