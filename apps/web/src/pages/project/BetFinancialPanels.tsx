import {
  compareMoney,
  confirmBetReturnSchema,
  correctSettlementSchema,
  ErrorCode,
  formatPEN,
  reopenBetSchema,
  subtractMoney,
  type BetSummary,
  type CorrectionPreview,
  type CorrectSettlementInput,
  type ReturnMismatchDetails,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { betsApi } from '../../api/bets.js';
import { ApiError } from '../../api/client.js';
import { describeApiError } from '../../api/errors.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  BET_CORRECTION_KIND_LABELS,
  BET_STATUS_LABELS,
  formatDateTime,
  MOVEMENT_DIRECTION_LABELS,
  MOVEMENT_TYPE_LABELS,
} from '../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice } from '../../ui.js';
import { useProject } from './ProjectContext.js';

const panelClass = 'mt-3 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3';

/** `datetime-local` (hora local) a partir de un instante ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const money = (value: string | null) => (value === null ? '—' : formatPEN(value));

// --- Impacto de una corrección --------------------------------------------------------------------

/**
 * Impacto financiero de una corrección o reapertura, tal como lo calculó la API con el mismo código
 * que la aplicaría (§112.3): filas del ledger, saldo de cada casa antes y después, ganancia o
 * pérdida y conciliaciones que se invalidarían. Si la operación se rechazaría, explica por qué.
 */
export function ImpactPreview({ preview }: { preview: CorrectionPreview }) {
  const lines = [...preview.reversals, ...preview.inserts];
  return (
    <div className="flex flex-col gap-3" aria-label="Impacto financiero">
      {!preview.valid && (
        <Notice tone="error">
          Esta operación se rechazaría con el historial actual y no se aplicará.
        </Notice>
      )}
      {preview.conflicts.map((conflict) => (
        <Notice key={`${conflict.houseId}:${conflict.occurredAt}`} tone="error">
          El {formatDateTime(conflict.occurredAt)}, la casa {conflict.houseName} quedaría con un
          saldo de {formatPEN(conflict.balance)}
          {conflict.pendingIds.length > 0 &&
            ` (hay ${conflict.pendingIds.length} ${conflict.pendingIds.length === 1 ? 'apuesta o retiro pendiente' : 'apuestas o retiros pendientes'} cuyo dinero ya estaba comprometido en ese momento)`}
          . Corrige primero el historial real.
        </Notice>
      ))}
      {preview.availabilityProblems.map((problem) => (
        <Notice key={problem.houseId} tone="error">
          La casa {problem.houseName} quedaría con un disponible de {formatPEN(problem.available)}.
        </Notice>
      ))}

      {!preview.ledgerChanged ? (
        <p className="text-sm text-slate-600">
          Este cambio no modifica el ledger: solo queda registrado en el historial y la auditoría.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-left text-sm"
            aria-label="Filas del ledger que se registrarían"
          >
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-1 pr-3 font-medium">Movimiento</th>
                <th className="py-1 pr-3 font-medium">Casa</th>
                <th className="py-1 pr-3 font-medium">Sentido</th>
                <th className="py-1 pr-3 font-medium">Monto</th>
                <th className="py-1 font-medium">Fecha efectiva</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.type}:${index}`} className="border-b border-slate-100">
                  <td className="py-1 pr-3">
                    {line.type === 'REVERSAL'
                      ? `Reversión de ${MOVEMENT_TYPE_LABELS[line.reverses ?? 'BET_PLACEMENT'].toLowerCase()}`
                      : MOVEMENT_TYPE_LABELS[line.type]}
                  </td>
                  <td className="py-1 pr-3">{line.houseName}</td>
                  <td className="py-1 pr-3">{MOVEMENT_DIRECTION_LABELS[line.direction]}</td>
                  <td className="py-1 pr-3">{formatPEN(line.amount)}</td>
                  <td className="py-1">{formatDateTime(line.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-label="Saldo antes y después">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="py-1 pr-3 font-medium">Casa</th>
              <th className="py-1 pr-3 font-medium">Saldo antes</th>
              <th className="py-1 pr-3 font-medium">Saldo después</th>
              <th className="py-1 pr-3 font-medium">Disponible antes</th>
              <th className="py-1 font-medium">Disponible después</th>
            </tr>
          </thead>
          <tbody>
            {preview.balances.map((balance) => (
              <tr key={balance.houseId} className="border-b border-slate-100">
                <td className="py-1 pr-3">{balance.houseName}</td>
                <td className="py-1 pr-3">{formatPEN(balance.balanceBefore)}</td>
                <td className="py-1 pr-3 font-medium">{formatPEN(balance.balanceAfter)}</td>
                <td className="py-1 pr-3">{formatPEN(balance.availableBefore)}</td>
                <td className="py-1 font-medium">{formatPEN(balance.availableAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        Ganancia/pérdida de la apuesta: {money(preview.profitLossBefore)} →{' '}
        <strong>{money(preview.profitLossAfter)}</strong>
      </p>

      {preview.checkpointsToInvalidate.length > 0 ? (
        <Notice tone="info">
          <strong>Afecta a la conciliación:</strong> se invalidará{' '}
          {preview.checkpointsToInvalidate.length === 1
            ? '1 conciliación ya confirmada'
            : `${preview.checkpointsToInvalidate.length} conciliaciones ya confirmadas`}{' '}
          (
          {preview.checkpointsToInvalidate
            .map(
              (checkpoint) => `${checkpoint.houseName}, ${formatDateTime(checkpoint.occurredAt)}`,
            )
            .join('; ')}
          ). Habrá que volver a conciliar esas casas.
        </Notice>
      ) : (
        <p className="text-sm text-slate-600">No afecta a ninguna conciliación confirmada.</p>
      )}
    </div>
  );
}

// --- Confirmar el retorno oficial -------------------------------------------------------------------

/**
 * Confirma el retorno oficial de una ganada liquidada con retorno calculado (§77, §112.2). Compara
 * calculado, oficial y diferencia; si difieren, exige una confirmación explícita y la contraseña
 * (D-A12). La API decide siempre: si detecta una diferencia que la web no vio (409
 * `RETURN_MISMATCH`), muestra sus valores.
 */
export function ConfirmReturnPanel({
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
  const [official, setOfficial] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [serverMismatch, setServerMismatch] = useState<ReturnMismatchDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const calculated = bet.calculatedRealizedReturn ?? '0.00';
  const parsed = confirmBetReturnSchema.safeParse({
    officialRealizedReturn: official,
    acknowledgeDifference: acknowledged,
    reason: reason.trim() === '' ? undefined : reason,
    version: bet.version,
  });
  const comparison = parsed.success
    ? {
        official: parsed.data.officialRealizedReturn,
        delta: subtractMoney(parsed.data.officialRealizedReturn, calculated),
        differs: compareMoney(parsed.data.officialRealizedReturn, calculated) !== 0,
      }
    : null;
  const shown = serverMismatch ?? (comparison?.differs ? { calculated, ...comparison } : null);
  const needsAcknowledgement = serverMismatch !== null || comparison?.differs === true;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!parsed.success) {
      setError('Indica el retorno oficial (un monto mayor que cero).');
      return;
    }
    if (needsAcknowledgement && !acknowledged) {
      setError('Confirma explícitamente la diferencia para continuar.');
      return;
    }
    setSubmitting(true);
    try {
      await runWithReauth(() => betsApi.confirmReturn(project.id, bet.id, parsed.data));
      onDone('Se confirmó el retorno oficial.');
    } catch (caught) {
      if (isReauthCancelled(caught)) {
        setSubmitting(false);
        return;
      }
      if (caught instanceof ApiError && caught.code === ErrorCode.RETURN_MISMATCH) {
        setServerMismatch(caught.body.details as ReturnMismatchDetails);
        setError(null);
      } else {
        setError(describeApiError(caught));
      }
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className={panelClass}
      aria-label={`Confirmar retorno oficial de la apuesta de ${bet.houseName}`}
      noValidate
    >
      <p className="text-sm text-slate-700">
        Esta apuesta se liquidó con un retorno <strong>calculado</strong> ({formatPEN(calculated)}
        ). Indica el retorno oficial que muestra la casa.
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Retorno oficial
        <input
          value={official}
          onChange={(event) => {
            setOfficial(event.target.value);
            setAcknowledged(false);
            setServerMismatch(null);
          }}
          className={inputClass}
          placeholder={calculated}
          inputMode="decimal"
        />
      </label>

      {shown && (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
          <dl className="grid gap-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-600">Retorno calculado</dt>
              <dd className="font-medium">{formatPEN(shown.calculated)}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Retorno oficial</dt>
              <dd className="font-medium">{formatPEN(shown.official)}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Diferencia</dt>
              <dd
                className={`font-medium ${shown.delta.startsWith('-') ? 'text-red-700' : 'text-green-700'}`}
              >
                {formatPEN(shown.delta)}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-amber-900">
            El retorno oficial es la autoridad: reemplazará al calculado, se corregirá el ledger con
            una reversión de la liquidación calculada y se invalidarán las conciliaciones afectadas.
            Se te pedirá la contraseña.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            Confirmo la diferencia y que se corregirá el ledger
          </label>
        </div>
      )}
      {!shown && comparison && (
        <p className="text-sm text-green-700">
          Coincide con el retorno calculado: solo se marcará como confirmado.
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo (opcional)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button
          type="submit"
          className={btnPrimary}
          disabled={submitting || (needsAcknowledgement && !acknowledged)}
        >
          Confirmar retorno oficial
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// --- Corregir la liquidación ---------------------------------------------------------------------

/**
 * Corrige una apuesta ya liquidada (§112.3, D-A8). Motivo obligatorio; muestra el impacto (filas
 * del ledger, saldo antes y después, conciliaciones) y solo permite aplicar lo que se revisó.
 */
export function CorrectSettlementPanel({
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
  const initial = {
    status: bet.status,
    official: bet.officialRealizedReturn ?? '',
    settledAt: toLocalInput(bet.settledAt),
    placedAt: toLocalInput(bet.placedAt),
  };
  const [status, setStatus] = useState<'WON' | 'LOST' | 'VOID' | 'CASHOUT'>(
    bet.status === 'PENDING' ? 'WON' : bet.status,
  );
  const [official, setOfficial] = useState(initial.official);
  const [amount, setAmount] = useState('');
  const [settledAt, setSettledAt] = useState(initial.settledAt);
  const [placedAt, setPlacedAt] = useState(initial.placedAt);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: CorrectionPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Solo se envía lo que cambia respecto de la apuesta (la API lo exige: al menos un cambio). */
  function buildInput(): { input: CorrectSettlementInput } | { message: string } {
    const draft: Record<string, unknown> = { reason, version: bet.version };
    if (status !== bet.status) draft.status = status;
    if (
      status !== 'LOST' &&
      official.trim() !== '' &&
      (official.trim() !== initial.official || status !== bet.status)
    ) {
      draft.officialRealizedReturn = official.trim();
    }
    if (amount.trim() !== '') draft.officialAmount = amount.trim();
    if (settledAt !== initial.settledAt && settledAt !== '') {
      draft.settledAt = new Date(settledAt).toISOString();
    }
    if (placedAt !== initial.placedAt && placedAt !== '') {
      draft.placedAt = new Date(placedAt).toISOString();
    }
    const result = correctSettlementSchema.safeParse(draft);
    if (!result.success) {
      return { message: result.error.issues[0]?.message ?? 'Revisa los datos ingresados.' };
    }
    return { input: result.data };
  }

  const built = buildInput();
  const currentKey = 'input' in built ? JSON.stringify(built.input) : null;
  const previewIsCurrent = preview !== null && preview.key === currentKey;

  async function showImpact() {
    setError(null);
    if (!('input' in built)) {
      setError(built.message);
      return;
    }
    setBusy(true);
    try {
      const data = await betsApi.previewCorrection(project.id, bet.id, built.input);
      setPreview({ key: JSON.stringify(built.input), data });
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!('input' in built) || !previewIsCurrent || !preview.data.valid) return;
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() => betsApi.correct(project.id, bet.id, built.input));
      onDone('Se corrigió la liquidación.');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void apply(event)}
      className={panelClass}
      aria-label={`Corregir liquidación de la apuesta de ${bet.houseName}`}
      noValidate
    >
      <Notice tone="info">
        Corregir una liquidada reescribe su efecto en el ledger: no se borra nada, se registran
        reversiones y filas nuevas. Exige un motivo, revisar el impacto y tu contraseña.
      </Notice>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Resultado
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className={inputClass}
          >
            {(['WON', 'LOST', 'VOID', 'CASHOUT'] as const).map((value) => (
              <option key={value} value={value}>
                {BET_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {status !== 'LOST' && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Retorno oficial
            <input
              value={official}
              onChange={(event) => setOfficial(event.target.value)}
              className={inputClass}
              inputMode="decimal"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Monto oficial (opcional)
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
            placeholder={bet.effectiveAmount}
            inputMode="decimal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Fecha de liquidación
          <input
            type="datetime-local"
            value={settledAt}
            onChange={(event) => setSettledAt(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Fecha de colocación
          <input
            type="datetime-local"
            value={placedAt}
            onChange={(event) => setPlacedAt(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo de la corrección (obligatorio)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
          rows={2}
        />
      </label>

      {preview && !previewIsCurrent && (
        <Notice tone="info">
          Cambiaste los datos después de calcular el impacto: vuelve a calcularlo para poder
          aplicar.
        </Notice>
      )}
      {preview && previewIsCurrent && <ImpactPreview preview={preview.data} />}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={() => void showImpact()}>
          Ver impacto
        </button>
        <button
          type="submit"
          className={btnPrimary}
          disabled={busy || !previewIsCurrent || !preview.data.valid}
        >
          Aplicar corrección
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// --- Reabrir --------------------------------------------------------------------------------------

/** Reabre una apuesta liquidada a pendiente, advirtiendo que revierte sus efectos en el ledger (D-A4). */
export function ReopenPanel({
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
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: CorrectionPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = reopenBetSchema.safeParse({ reason, version: bet.version });
  const currentKey = parsed.success ? JSON.stringify(parsed.data) : null;
  const previewIsCurrent = preview !== null && preview.key === currentKey;

  async function showImpact() {
    setError(null);
    if (!parsed.success) {
      setError('Indica el motivo de la reapertura.');
      return;
    }
    setBusy(true);
    try {
      const data = await betsApi.previewReopen(project.id, bet.id, parsed.data);
      setPreview({ key: JSON.stringify(parsed.data), data });
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.success || !previewIsCurrent || !preview.data.valid) return;
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() => betsApi.reopen(project.id, bet.id, parsed.data));
      onDone('Se reabrió la apuesta.');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void apply(event)}
      className={panelClass}
      aria-label={`Reabrir la apuesta de ${bet.houseName}`}
      noValidate
    >
      <Notice tone="info">
        <strong>Reabrir revierte los efectos financieros de esta apuesta.</strong> Se registran
        reversiones de su colocación y de su liquidación, y la apuesta vuelve a comprometer su
        monto. Los valores anteriores (retorno calculado y oficial) quedan en el historial. Exige un
        motivo y tu contraseña.
      </Notice>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo de la reapertura (obligatorio)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
          rows={2}
        />
      </label>
      {preview && !previewIsCurrent && (
        <Notice tone="info">
          Cambiaste el motivo: vuelve a calcular el impacto para poder reabrir.
        </Notice>
      )}
      {preview && previewIsCurrent && <ImpactPreview preview={preview.data} />}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={() => void showImpact()}>
          Ver impacto
        </button>
        <button
          type="submit"
          className={btnDanger}
          disabled={busy || !previewIsCurrent || !preview.data.valid}
        >
          Reabrir apuesta
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// --- Papelera y restauración de una liquidada -------------------------------------------------------

/**
 * Enviar a la papelera o restaurar una apuesta **liquidada** (D-A7, D-A11): revierte o vuelve a
 * registrar su efecto en el ledger; exige motivo y contraseña.
 */
export function SettledTrashPanel({
  action,
  label,
  onSubmit,
  onCancel,
}: {
  action: 'trash' | 'restore';
  label: string;
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const runWithReauth = useReauth();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('Indica el motivo.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() => onSubmit(reason.trim()));
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={panelClass}
      aria-label={`${action === 'trash' ? 'Enviar a la papelera' : 'Restaurar'} ${label}`}
      noValidate
    >
      <Notice tone="info">
        {action === 'trash' ? (
          <>
            <strong>Esta apuesta ya está liquidada.</strong> Enviarla a la papelera revierte todo su
            efecto en el ledger: el saldo de la casa cambia y las conciliaciones posteriores a su
            colocación quedarán invalidadas. Sus valores se conservan y se podrá restaurar.
          </>
        ) : (
          <>
            <strong>Esta apuesta estaba liquidada.</strong> Restaurarla vuelve a registrar su efecto
            en el ledger con filas nuevas. Se rechaza si el saldo de la casa ya no lo permite en
            algún punto del historial.
          </>
        )}{' '}
        Exige un motivo y tu contraseña.
      </Notice>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo (obligatorio)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button
          type="submit"
          className={action === 'trash' ? btnDanger : btnPrimary}
          disabled={busy}
        >
          {action === 'trash' ? 'Enviar a la papelera' : 'Restaurar apuesta'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// --- Historial financiero ------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  status: 'Resultado',
  officialAmount: 'Monto oficial',
  calculatedRealizedReturn: 'Retorno calculado',
  officialRealizedReturn: 'Retorno oficial',
  placedAt: 'Colocación',
  settledAt: 'Liquidación',
  trashed: 'En la papelera',
};
const MONEY_FIELDS = new Set([
  'officialAmount',
  'calculatedRealizedReturn',
  'officialRealizedReturn',
]);
const DATE_FIELDS = new Set(['placedAt', 'settledAt']);

function formatField(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (MONEY_FIELDS.has(key)) return formatPEN(text);
  if (DATE_FIELDS.has(key)) return formatDateTime(text);
  if (key === 'status') return BET_STATUS_LABELS[text as BetSummary['status']] ?? text;
  return text;
}

/** Qué campos financieros cambiaron en una corrección, con su valor anterior (que se conserva). */
function changesOf(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(FIELD_LABELS)
    .filter((key) => before[key] !== after[key])
    .map(
      (key) =>
        `${FIELD_LABELS[key]}: ${formatField(key, before[key])} → ${formatField(key, after[key])}`,
    );
}

/**
 * Historial financiero de una apuesta (§112.1): cada fila del ledger con su estado (vigente,
 * anulada o reversión) y cada corrección con sus valores anteriores. Nada se borra.
 */
export function BetLedgerPanel({ betId }: { betId: string }) {
  const { project } = useProject();
  const history = useLoad(`bet-ledger:${betId}`, () => betsApi.ledger(project.id, betId));

  if (history.loading && !history.data) {
    return <p className="mt-3 text-xs text-slate-500">Cargando el historial financiero…</p>;
  }
  if (history.error) return <Notice tone="error">{history.error}</Notice>;
  if (!history.data) return null;
  const { movements, corrections } = history.data;

  return (
    <div className="mt-3 flex flex-col gap-3" aria-label="Historial financiero">
      <h3 className="text-sm font-medium">Historial financiero</h3>
      {movements.length === 0 ? (
        <p className="text-sm text-slate-600">Esta apuesta todavía no tiene efecto en el ledger.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Movimientos de la apuesta">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-1 pr-3 font-medium">Movimiento</th>
                <th className="py-1 pr-3 font-medium">Casa</th>
                <th className="py-1 pr-3 font-medium">Monto</th>
                <th className="py-1 pr-3 font-medium">Fecha efectiva</th>
                <th className="py-1 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id} className="border-b border-slate-100">
                  <td className="py-1 pr-3">
                    {MOVEMENT_TYPE_LABELS[movement.type]}
                    {movement.direction && ` · ${MOVEMENT_DIRECTION_LABELS[movement.direction]}`}
                  </td>
                  <td className="py-1 pr-3">{movement.houseName ?? '—'}</td>
                  <td className="py-1 pr-3">{formatPEN(movement.amount)}</td>
                  <td className="py-1 pr-3">{formatDateTime(movement.occurredAt)}</td>
                  <td className="py-1">
                    {movement.type === 'REVERSAL' ? (
                      <Badge tone="amber">Reversión</Badge>
                    ) : movement.live ? (
                      <Badge tone="green">Vigente</Badge>
                    ) : (
                      <Badge tone="slate">Anulada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {corrections.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Correcciones de la apuesta">
          {corrections.map((correction) => {
            const changes = changesOf(correction.before, correction.after);
            return (
              <li key={correction.id} className="rounded border border-slate-200 p-2 text-sm">
                <p className="font-medium">
                  {BET_CORRECTION_KIND_LABELS[correction.kind]}{' '}
                  <span className="font-normal text-slate-500">
                    · {correction.createdBy.name} · {formatDateTime(correction.createdAt)}
                  </span>
                </p>
                {correction.reason && <p className="text-slate-600">Motivo: {correction.reason}</p>}
                {changes.length > 0 && (
                  <ul className="list-disc pl-5 text-slate-600">
                    {changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
