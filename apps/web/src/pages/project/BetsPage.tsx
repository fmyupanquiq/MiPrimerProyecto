import {
  createBetSchema,
  formatPEN,
  settleBetSchema,
  updateBetSchema,
  type BetSelectionInput,
  type BetSummary,
  type HouseSummary,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { betsApi } from '../../api/bets.js';
import { housesApi, stagesApi } from '../../api/finance.js';
import { describeApiError } from '../../api/errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { BET_STATUS_LABELS, BET_TYPE_LABELS, formatDateTime } from '../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../ui.js';
import { useProject } from './ProjectContext.js';

const BADGE_TONE = {
  PENDING: 'amber',
  WON: 'green',
  LOST: 'red',
  VOID: 'slate',
  CASHOUT: 'blue',
} as const;

let nextKey = 0;

interface SelectionDraft {
  key: number;
  eventGroup: number;
  position: number;
  sport: string;
  event: string;
  market: string;
  selection: string;
  visibleOdds: string;
}

const newSelection = (eventGroup: number, position: number): SelectionDraft => ({
  key: nextKey++,
  eventGroup,
  position,
  sport: '',
  event: '',
  market: '',
  selection: '',
  visibleOdds: '',
});

/** Simple/Creada/Múltiple aproximado en el cliente, solo para orientar; el backend lo deriva (§90). */
function previewBetType(selections: SelectionDraft[]): string {
  const groups = new Set(selections.map((s) => s.eventGroup));
  if (groups.size === 1) return selections.length === 1 ? 'Simple' : 'Creada';
  return 'Múltiple';
}

function toSelectionInputs(selections: SelectionDraft[]): BetSelectionInput[] {
  return selections.map((s) => ({
    eventGroup: s.eventGroup,
    position: s.position,
    sport: s.sport.trim() === '' ? undefined : s.sport,
    event: s.event,
    market: s.market.trim() === '' ? undefined : s.market,
    selection: s.selection,
    visibleOdds: s.visibleOdds,
  }));
}

/** Apuestas, selecciones y liquidaciones (§18-§27, §90, §107). */
export function BetsPage() {
  const { project, can } = useProject();
  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const [showTrashed, setShowTrashed] = useState(false);
  const canSeeTrashed = can('bets.restore');
  const bets = useLoad(`bets:${project.id}:${showTrashed}`, () =>
    betsApi.list(project.id, showTrashed ? 'TRASHED' : undefined),
  );
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    bets.reload();
    houses.reload();
  };

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
      <Section title="Apuestas">
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
          {can('bets.create') && !showForm && (
            <button type="button" className={btnPrimary} onClick={() => setShowForm(true)}>
              Registrar apuesta
            </button>
          )}
        </div>

        {showForm && (
          <NewBetForm
            houses={houses.data ?? []}
            onDone={(message) => {
              setShowForm(false);
              setNotice(message);
              reload();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {bets.error && <Notice tone="error">{bets.error}</Notice>}
        {bets.loading && !bets.data && <p>Cargando apuestas…</p>}
        {bets.data && bets.data.length === 0 && (
          <Notice tone="info">
            {showTrashed ? 'La papelera está vacía.' : 'Todavía no hay apuestas.'}
          </Notice>
        )}
        <ul className="flex flex-col gap-3">
          {bets.data?.map((bet) => (
            <BetRow
              key={bet.id}
              bet={bet}
              houses={houses.data ?? []}
              showTrashed={showTrashed}
              onChanged={(message) => {
                setNotice(message);
                reload();
              }}
            />
          ))}
        </ul>
      </Section>
    </>
  );
}

function HouseSelect({
  houses,
  value,
  onChange,
}: {
  houses: HouseSummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      Casa
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="" disabled>
          Elige una casa
        </option>
        {houses
          .filter((house) => house.status === 'ACTIVE')
          .map((house) => (
            <option key={house.id} value={house.id}>
              {house.name}
            </option>
          ))}
      </select>
    </label>
  );
}

function SelectionsEditor({
  selections,
  onChange,
}: {
  selections: SelectionDraft[];
  onChange: (selections: SelectionDraft[]) => void;
}) {
  function update(key: number, patch: Partial<SelectionDraft>) {
    onChange(selections.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function remove(key: number) {
    onChange(selections.filter((s) => s.key !== key));
  }
  function addSameEvent() {
    const last = selections[selections.length - 1];
    const eventGroup = last?.eventGroup ?? 0;
    const position = selections.filter((s) => s.eventGroup === eventGroup).length;
    onChange([...selections, newSelection(eventGroup, position)]);
  }
  function addNewEvent() {
    const nextGroup = selections.reduce((max, s) => Math.max(max, s.eventGroup), -1) + 1;
    onChange([...selections, newSelection(nextGroup, 0)]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Selecciones</h3>
        <p className="text-xs text-slate-500">Se registrará como: {previewBetType(selections)}</p>
      </div>
      {selections.map((selection, index) => (
        <div
          key={selection.key}
          className="grid gap-2 rounded border border-slate-200 p-2 sm:grid-cols-6"
        >
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            {index === 0 ? 'Evento' : ''}
            <input
              value={selection.event}
              onChange={(event) => update(selection.key, { event: event.target.value })}
              className={inputClass}
              placeholder="Real Madrid vs. Barcelona"
              aria-label={`Evento de la selección ${index + 1}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            {index === 0 ? 'Selección' : ''}
            <input
              value={selection.selection}
              onChange={(event) => update(selection.key, { selection: event.target.value })}
              className={inputClass}
              placeholder="Real Madrid gana"
              aria-label={`Selección ${index + 1}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {index === 0 ? 'Cuota' : ''}
            <input
              value={selection.visibleOdds}
              onChange={(event) => update(selection.key, { visibleOdds: event.target.value })}
              className={inputClass}
              placeholder="1.95"
              aria-label={`Cuota de la selección ${index + 1}`}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className={btn}
              disabled={selections.length === 1}
              onClick={() => remove(selection.key)}
              aria-label={`Quitar la selección ${index + 1}`}
            >
              Quitar
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs sm:col-span-3">
            Deporte (opcional)
            <input
              value={selection.sport}
              onChange={(event) => update(selection.key, { sport: event.target.value })}
              className={inputClass}
              aria-label={`Deporte de la selección ${index + 1}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-3">
            Mercado (opcional)
            <input
              value={selection.market}
              onChange={(event) => update(selection.key, { market: event.target.value })}
              className={inputClass}
              aria-label={`Mercado de la selección ${index + 1}`}
            />
          </label>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={addSameEvent}>
          Añadir selección (mismo evento)
        </button>
        <button type="button" className={btn} onClick={addNewEvent}>
          Añadir evento nuevo
        </button>
      </div>
    </div>
  );
}

function NewBetForm({
  houses,
  onDone,
  onCancel,
}: {
  houses: HouseSummary[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const [houseId, setHouseId] = useState('');
  const [stake, setStake] = useState('1.00');
  const [visibleTotalOdds, setVisibleTotalOdds] = useState('');
  const [officialAmount, setOfficialAmount] = useState('');
  const [placedAt, setPlacedAt] = useState('');
  const [placedTimeKnown, setPlacedTimeKnown] = useState(true);
  const [reason, setReason] = useState('');
  const [selections, setSelections] = useState<SelectionDraft[]>([newSelection(0, 0)]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (houseId === '') {
      setError('Elige una casa.');
      return;
    }
    if (placedAt === '') {
      setError('Indica la fecha de colocación.');
      return;
    }
    const parsed = createBetSchema.safeParse({
      houseId,
      stake,
      visibleTotalOdds,
      officialAmount: officialAmount.trim() === '' ? undefined : officialAmount,
      placedAt: new Date(placedAt).toISOString(),
      placedTimeKnown,
      reason: reason.trim() === '' ? undefined : reason,
      selections: toSelectionInputs(selections),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await betsApi.create(project.id, parsed.data);
      onDone('Se registró la apuesta.');
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3 rounded border border-slate-200 p-3"
      aria-label="Registrar apuesta"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <HouseSelect houses={houses} value={houseId} onChange={setHouseId} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Stake
          <input
            value={stake}
            onChange={(event) => setStake(event.target.value)}
            className={inputClass}
            placeholder="1.00"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Cuota total visible
          <input
            value={visibleTotalOdds}
            onChange={(event) => setVisibleTotalOdds(event.target.value)}
            className={inputClass}
            placeholder="1.95"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Fecha y hora de colocación
            <input
              type="datetime-local"
              value={placedAt}
              onChange={(event) => setPlacedAt(event.target.value)}
              className={inputClass}
              aria-describedby="placed-at-help"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600" id="placed-at-help">
            <input
              type="checkbox"
              checked={!placedTimeKnown}
              onChange={(event) => setPlacedTimeKnown(!event.target.checked)}
            />
            No conozco la hora exacta
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Monto oficial (opcional)
          <input
            value={officialAmount}
            onChange={(event) => setOfficialAmount(event.target.value)}
            className={inputClass}
            placeholder="Si tienes el ticket"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Motivo / observaciones (opcional)
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <SelectionsEditor selections={selections} onChange={setSelections} />

      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Registrando…' : 'Registrar apuesta'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function BetRow({
  bet,
  houses,
  showTrashed,
  onChanged,
}: {
  bet: BetSummary;
  houses: HouseSummary[];
  showTrashed: boolean;
  onChanged: (message: string) => void;
}) {
  const { project, can } = useProject();
  const { user } = useAuth();
  const runWithReauth = useReauth();
  const [mode, setMode] = useState<'view' | 'edit' | 'settle' | 'move'>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwn = user?.id === bet.createdBy.id;
  const canEdit = can('bets.update_any') || (can('bets.update_own') && isOwn);
  const canTrash = can('bets.trash_any') || (can('bets.trash_own') && isOwn);

  async function trash() {
    setBusy(true);
    setError(null);
    try {
      await betsApi.trash(project.id, bet.id, {});
      onChanged('Se envió la apuesta a la papelera.');
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
      await runWithReauth(() => betsApi.restore(project.id, bet.id));
      onChanged('Se restauró la apuesta.');
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
            {BET_TYPE_LABELS[bet.betType]} · {bet.houseName}{' '}
            <Badge tone={BADGE_TONE[bet.status]}>{BET_STATUS_LABELS[bet.status]}</Badge>
          </p>
          <p className="text-sm text-slate-600">
            Stake {bet.stake} · Monto {formatPEN(bet.effectiveAmount)}
            {bet.amountSource === 'CALCULATED' && ' (calculado)'} · Cuota {bet.visibleTotalOdds}
            {bet.profitLoss !== null && (
              <>
                {' '}
                ·{' '}
                <span
                  className={bet.profitLoss.startsWith('-') ? 'text-red-700' : 'text-green-700'}
                >
                  P/L {formatPEN(bet.profitLoss)}
                </span>
              </>
            )}
          </p>
          <p className="text-xs text-slate-500">
            Colocada el {formatDateTime(bet.placedAt)} por {bet.createdBy.name}
            {bet.reason && ` · ${bet.reason}`}
          </p>
        </div>
        {!showTrashed && (
          <div className="flex flex-wrap gap-2">
            {canEdit && mode === 'view' && (
              <button type="button" className={btn} onClick={() => setMode('edit')}>
                Editar
              </button>
            )}
            {canEdit && bet.status === 'PENDING' && mode === 'view' && (
              <button type="button" className={btnPrimary} onClick={() => setMode('settle')}>
                Liquidar
              </button>
            )}
            {can('bets.move_stage') && mode === 'view' && (
              <button type="button" className={btn} onClick={() => setMode('move')}>
                Mover de etapa
              </button>
            )}
            {canTrash && mode === 'view' && (
              <button
                type="button"
                className={btnDanger}
                disabled={busy}
                onClick={() => void trash()}
              >
                Papelera
              </button>
            )}
          </div>
        )}
        {showTrashed && can('bets.restore') && (
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

      {mode === 'edit' && (
        <EditBetForm
          bet={bet}
          houses={houses}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'settle' && (
        <SettleBetForm
          bet={bet}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'move' && (
        <MoveBetStageForm
          bet={bet}
          onDone={(message) => {
            setMode('view');
            onChanged(message);
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

function EditBetForm({
  bet,
  houses,
  onDone,
  onCancel,
}: {
  bet: BetSummary;
  houses: HouseSummary[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const isPending = bet.status === 'PENDING';
  const [houseId, setHouseId] = useState(bet.houseId);
  const [stake, setStake] = useState(bet.stake);
  const [visibleTotalOdds, setVisibleTotalOdds] = useState(bet.visibleTotalOdds);
  const [officialAmount, setOfficialAmount] = useState(bet.officialAmount ?? '');
  const [reason, setReason] = useState(bet.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const input = isPending
      ? {
          houseId,
          stake,
          visibleTotalOdds,
          officialAmount: officialAmount.trim() === '' ? undefined : officialAmount,
          reason: reason.trim() === '' ? undefined : reason,
          version: bet.version,
        }
      : { reason: reason.trim() === '' ? undefined : reason, version: bet.version };
    const parsed = updateBetSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await betsApi.update(project.id, bet.id, parsed.data);
      onDone('Se guardaron los cambios.');
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="mt-3 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3"
      aria-label={`Editar apuesta de ${bet.houseName}`}
      noValidate
    >
      {!isPending && (
        <p className="text-xs text-slate-500">
          Esta apuesta ya está liquidada: solo se puede corregir el motivo.
        </p>
      )}
      {isPending && (
        <div className="grid gap-3 sm:grid-cols-3">
          <HouseSelect houses={houses} value={houseId} onChange={setHouseId} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Stake
            <input
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Cuota total visible
            <input
              value={visibleTotalOdds}
              onChange={(event) => setVisibleTotalOdds(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-3">
            Monto oficial (opcional)
            <input
              value={officialAmount}
              onChange={(event) => setOfficialAmount(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo / observaciones
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          Guardar
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SettleBetForm({
  bet,
  onDone,
  onCancel,
}: {
  bet: BetSummary;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const [status, setStatus] = useState<'WON' | 'LOST' | 'VOID' | 'CASHOUT'>('WON');
  const [officialRealizedReturn, setOfficialRealizedReturn] = useState('');
  const [settledAt, setSettledAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (settledAt === '') {
      setError('Indica la fecha de liquidación.');
      return;
    }
    const parsed = settleBetSchema.safeParse({
      status,
      officialRealizedReturn: status === 'LOST' ? undefined : officialRealizedReturn,
      settledAt: new Date(settledAt).toISOString(),
      version: bet.version,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await betsApi.settle(project.id, bet.id, parsed.data);
      onDone('Se liquidó la apuesta.');
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="mt-3 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3"
      aria-label={`Liquidar apuesta de ${bet.houseName}`}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Resultado
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className={inputClass}
          >
            <option value="WON">Ganada</option>
            <option value="LOST">Perdida</option>
            <option value="VOID">Anulada</option>
            <option value="CASHOUT">Cash Out</option>
          </select>
        </label>
        {status !== 'LOST' && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Retorno oficial
            <input
              value={officialRealizedReturn}
              onChange={(event) => setOfficialRealizedReturn(event.target.value)}
              className={inputClass}
              placeholder={status === 'VOID' ? bet.effectiveAmount : '0.00'}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Fecha y hora de liquidación
          <input
            type="datetime-local"
            value={settledAt}
            onChange={(event) => setSettledAt(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          Confirmar liquidación
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function MoveBetStageForm({
  bet,
  onDone,
  onCancel,
}: {
  bet: BetSummary;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const runWithReauth = useReauth();
  const stages = useLoad(`stages-for-move:${project.id}`, () => stagesApi.list(project.id));
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (stageId === '') {
      setError('Elige una etapa.');
      return;
    }
    setSubmitting(true);
    try {
      await runWithReauth(() =>
        betsApi.moveStage(project.id, bet.id, { stageId, version: bet.version }),
      );
      onDone('Se movió la apuesta de etapa.');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="mt-3 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3"
      aria-label={`Mover de etapa la apuesta de ${bet.houseName}`}
      noValidate
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nueva etapa
        <select
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Elige una etapa
          </option>
          {stages.data
            ?.filter((stage) => stage.id !== bet.stageId && stage.status !== 'TRASHED')
            .map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
        </select>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          Mover
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
