import {
  createExtraordinaryMovementSchema,
  createHouseSchema,
  createTransferSchema,
  formatPEN,
  moneyInputSchema,
  requestWithdrawalSchema,
  type HouseSummary,
  type MovementDirection,
  type WithdrawalRequestSummary,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { describeApiError } from '../../api/errors.js';
import { housesApi, movementsApi, withdrawalsApi } from '../../api/finance.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  formatDateTime,
  HOUSE_STATUS_LABELS,
  MOVEMENT_DIRECTION_LABELS,
  MOVEMENT_TYPE_LABELS,
  WITHDRAWAL_STATUS_LABELS,
} from '../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../ui.js';
import { useProject } from './ProjectContext.js';

/** Casas y Finanzas del proyecto (§13-§17, §49). */
export function FinancePage() {
  const { project, can } = useProject();
  const houses = useLoad(`houses:${project.id}`, () => housesApi.list(project.id));
  const movements = useLoad(`movements:${project.id}`, () => movementsApi.list(project.id));
  const withdrawals = useLoad(`withdrawals:${project.id}`, () => withdrawalsApi.list(project.id));
  const [notice, setNotice] = useState<string | null>(null);

  const reloadAll = () => {
    houses.reload();
    movements.reload();
    withdrawals.reload();
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
      <HousesSection
        houses={houses.data ?? []}
        loading={houses.loading}
        error={houses.error}
        canCreate={can('houses.create')}
        canDeactivate={can('houses.deactivate')}
        onChanged={(message) => {
          setNotice(message);
          reloadAll();
        }}
      />
      {can('movements.deposit') || can('movements.transfer') || can('movements.extraordinary') ? (
        <NewMovementSection
          houses={houses.data ?? []}
          onChanged={(message) => {
            setNotice(message);
            reloadAll();
          }}
        />
      ) : null}
      <WithdrawalsSection
        houses={houses.data ?? []}
        withdrawals={withdrawals.data ?? []}
        loading={withdrawals.loading}
        error={withdrawals.error}
        onChanged={(message) => {
          setNotice(message);
          reloadAll();
        }}
      />
      <Section title="Historial de movimientos">
        {movements.error && <Notice tone="error">{movements.error}</Notice>}
        {movements.loading && !movements.data && <p>Cargando historial…</p>}
        {movements.data && movements.data.length === 0 && (
          <Notice tone="info">Todavía no hay movimientos.</Notice>
        )}
        {movements.data && movements.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Fecha</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Casa</th>
                  <th className="py-2 pr-3 font-medium">Monto</th>
                  <th className="py-2 pr-3 font-medium">Motivo</th>
                  <th className="py-2 font-medium">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.map((movement) => (
                  <tr key={movement.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{formatDateTime(movement.occurredAt)}</td>
                    <td className="py-2 pr-3">
                      {MOVEMENT_TYPE_LABELS[movement.type]}
                      {movement.direction && ` (${MOVEMENT_DIRECTION_LABELS[movement.direction]})`}
                    </td>
                    <td className="py-2 pr-3">
                      {movement.houseName ?? `${movement.fromHouseName} → ${movement.toHouseName}`}
                    </td>
                    <td className="py-2 pr-3">{formatPEN(movement.amount)}</td>
                    <td className="py-2 pr-3">{movement.reason ?? '—'}</td>
                    <td className="py-2">{movement.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function HousesSection({
  houses,
  loading,
  error,
  canCreate,
  canDeactivate,
  onChanged,
}: {
  houses: HouseSummary[];
  loading: boolean;
  error: string | null;
  canCreate: boolean;
  canDeactivate: boolean;
  onChanged: (message: string) => void;
}) {
  const { project } = useProject();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = createHouseSchema.safeParse({ name });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Ingresa un nombre.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await housesApi.create(project.id, parsed.data);
      setName('');
      setShowForm(false);
      onChanged(`Se añadió la casa «${created.name}».`);
    } catch (caught) {
      setFormError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(house: HouseSummary) {
    setBusyId(house.id);
    setRowError(null);
    try {
      if (house.status === 'ACTIVE') await housesApi.deactivate(project.id, house.id);
      else await housesApi.activate(project.id, house.id);
      onChanged(
        house.status === 'ACTIVE'
          ? `Se desactivó «${house.name}».`
          : `Se reactivó «${house.name}».`,
      );
    } catch (caught) {
      setRowError(describeApiError(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section title="Casas">
      {canCreate && !showForm && (
        <button
          type="button"
          className={`${btnPrimary} self-start`}
          onClick={() => setShowForm(true)}
        >
          Nueva casa
        </button>
      )}
      {showForm && (
        <form
          onSubmit={(event) => void onCreate(event)}
          className="flex flex-wrap items-end gap-2"
          noValidate
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            Crear
          </button>
          <button type="button" className={btn} onClick={() => setShowForm(false)}>
            Cancelar
          </button>
          {formError && <Notice tone="error">{formError}</Notice>}
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {rowError && <Notice tone="error">{rowError}</Notice>}
      {loading && houses.length === 0 && <p>Cargando casas…</p>}
      {!loading && houses.length === 0 && <Notice tone="info">Todavía no hay casas.</Notice>}
      {houses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Casa</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Saldo</th>
                <th className="py-2 pr-3 font-medium">Comprometido</th>
                <th className="py-2 pr-3 font-medium">Disponible</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {houses.map((house) => (
                <tr key={house.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{house.name}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={house.status === 'ACTIVE' ? 'green' : 'slate'}>
                      {HOUSE_STATUS_LABELS[house.status]}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">{formatPEN(house.balance)}</td>
                  <td className="py-2 pr-3">{formatPEN(house.committed)}</td>
                  <td className="py-2 pr-3">{formatPEN(house.available)}</td>
                  <td className="py-2">
                    {canDeactivate && (
                      <button
                        type="button"
                        className={btn}
                        disabled={busyId === house.id}
                        onClick={() => void toggle(house)}
                        aria-label={
                          house.status === 'ACTIVE'
                            ? `Desactivar ${house.name}`
                            : `Reactivar ${house.name}`
                        }
                      >
                        {house.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

type MovementKind = 'deposit' | 'transfer' | 'extraordinary';

function NewMovementSection({
  houses,
  onChanged,
}: {
  houses: HouseSummary[];
  onChanged: (message: string) => void;
}) {
  const { can } = useProject();
  const kinds: { key: MovementKind; label: string }[] = [
    ...(can('movements.deposit') ? [{ key: 'deposit' as const, label: 'Depósito' }] : []),
    ...(can('movements.transfer') ? [{ key: 'transfer' as const, label: 'Transferencia' }] : []),
    ...(can('movements.extraordinary')
      ? [{ key: 'extraordinary' as const, label: 'Extraordinario' }]
      : []),
  ];
  const [kind, setKind] = useState<MovementKind>(kinds[0]?.key ?? 'deposit');

  return (
    <Section title="Registrar movimiento">
      <div role="group" aria-label="Tipo de movimiento" className="flex flex-wrap gap-2">
        {kinds.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={kind === option.key}
            onClick={() => setKind(option.key)}
            className={`rounded border px-3 py-1.5 text-sm ${
              kind === option.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {kind === 'deposit' && <DepositForm houses={houses} onChanged={onChanged} />}
      {kind === 'transfer' && <TransferForm houses={houses} onChanged={onChanged} />}
      {kind === 'extraordinary' && <ExtraordinaryForm houses={houses} onChanged={onChanged} />}
    </Section>
  );
}

function HouseSelect({
  houses,
  value,
  onChange,
  label,
  exclude,
}: {
  houses: HouseSummary[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  exclude?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="" disabled>
          Elige una casa
        </option>
        {houses
          .filter((house) => house.status === 'ACTIVE' && house.id !== exclude)
          .map((house) => (
            <option key={house.id} value={house.id}>
              {house.name}
            </option>
          ))}
      </select>
    </label>
  );
}

function DepositForm({
  houses,
  onChanged,
}: {
  houses: HouseSummary[];
  onChanged: (message: string) => void;
}) {
  const { project } = useProject();
  const [houseId, setHouseId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (houseId === '') {
      setError('Elige una casa.');
      return;
    }
    const amountResult = moneyInputSchema({ positive: true }).safeParse(amount);
    if (!amountResult.success) {
      setError(amountResult.error.issues[0]?.message ?? 'Ingresa un monto válido.');
      return;
    }
    setSubmitting(true);
    try {
      await movementsApi.deposit(project.id, {
        houseId,
        amount: amountResult.data,
        reason: reason.trim() === '' ? undefined : reason,
      });
      setAmount('');
      setReason('');
      onChanged('Se registró el depósito.');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Depósito"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <HouseSelect houses={houses} value={houseId} onChange={setHouseId} label="Casa" />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Monto
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo (opcional)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={submitting} className={`${btnPrimary} self-start`}>
        Registrar depósito
      </button>
    </form>
  );
}

function TransferForm({
  houses,
  onChanged,
}: {
  houses: HouseSummary[];
  onChanged: (message: string) => void;
}) {
  const { project } = useProject();
  const [fromHouseId, setFromHouseId] = useState('');
  const [toHouseId, setToHouseId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = createTransferSchema.safeParse({
      fromHouseId,
      toHouseId,
      amount,
      reason: reason.trim() === '' ? undefined : reason,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await movementsApi.transfer(project.id, parsed.data);
      setAmount('');
      setReason('');
      onChanged('Se registró la transferencia.');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Transferencia"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <HouseSelect
          houses={houses}
          value={fromHouseId}
          onChange={setFromHouseId}
          label="Desde"
          exclude={toHouseId}
        />
        <HouseSelect
          houses={houses}
          value={toHouseId}
          onChange={setToHouseId}
          label="Hacia"
          exclude={fromHouseId}
        />
      </div>
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Monto
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo (opcional)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={submitting} className={`${btnPrimary} self-start`}>
        Registrar transferencia
      </button>
    </form>
  );
}

function ExtraordinaryForm({
  houses,
  onChanged,
}: {
  houses: HouseSummary[];
  onChanged: (message: string) => void;
}) {
  const { project } = useProject();
  const runWithReauth = useReauth();
  const [houseId, setHouseId] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<MovementDirection>('CREDIT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = createExtraordinaryMovementSchema.safeParse({
      houseId,
      amount,
      direction,
      reason,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await runWithReauth(() => movementsApi.extraordinary(project.id, parsed.data));
      setAmount('');
      setReason('');
      onChanged('Se registró el movimiento extraordinario.');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Extraordinario"
      noValidate
    >
      <p className="text-xs text-slate-500">
        Solo para hechos reales de la casa (cashback, bonificación, comisión, corrección oficial):
        nunca un ajuste genérico.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <HouseSelect houses={houses} value={houseId} onChange={setHouseId} label="Casa" />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Monto
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Sentido
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as MovementDirection)}
            className={inputClass}
          >
            <option value="CREDIT">Suma (a favor)</option>
            <option value="DEBIT">Resta (en contra)</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={submitting} className={`${btnPrimary} self-start`}>
        Registrar movimiento
      </button>
    </form>
  );
}

function WithdrawalsSection({
  houses,
  withdrawals,
  loading,
  error,
  onChanged,
}: {
  houses: HouseSummary[];
  withdrawals: WithdrawalRequestSummary[];
  loading: boolean;
  error: string | null;
  onChanged: (message: string) => void;
}) {
  const { project, can } = useProject();
  const [showForm, setShowForm] = useState(false);

  return (
    <Section title="Retiros">
      {can('withdrawals.request') && !showForm && (
        <button
          type="button"
          className={`${btnPrimary} self-start`}
          onClick={() => setShowForm(true)}
        >
          Solicitar retiro
        </button>
      )}
      {showForm && (
        <RequestWithdrawalForm
          houses={houses}
          onDone={(message) => {
            setShowForm(false);
            onChanged(message);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {loading && withdrawals.length === 0 && <p>Cargando retiros…</p>}
      {!loading && withdrawals.length === 0 && <Notice tone="info">Todavía no hay retiros.</Notice>}
      <ul className="flex flex-col gap-3">
        {withdrawals.map((item) => (
          <WithdrawalRow
            key={item.id}
            item={item}
            canApprove={can('withdrawals.approve')}
            onChanged={onChanged}
          />
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        {project.status === 'CLOSED' &&
          'El proyecto está cerrado: los retiros de cierre siguen disponibles.'}
      </p>
    </Section>
  );
}

function RequestWithdrawalForm({
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
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = requestWithdrawalSchema.safeParse({ houseId, amount, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await withdrawalsApi.request(project.id, parsed.data);
      onDone('Se solicitó el retiro; el monto ya está reservado.');
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Solicitar retiro"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <HouseSelect houses={houses} value={houseId} onChange={setHouseId} label="Casa" />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Monto
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          Solicitar
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function WithdrawalRow({
  item,
  canApprove,
  onChanged,
}: {
  item: WithdrawalRequestSummary;
  canApprove: boolean;
  onChanged: (message: string) => void;
}) {
  const { project } = useProject();
  const { user } = useAuth();
  const runWithReauth = useReauth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await runWithReauth(() =>
        withdrawalsApi.approve(project.id, item.id, { version: item.version }),
      );
      onChanged(`Se aprobó el retiro de ${formatPEN(item.amount)}.`);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await withdrawalsApi.reject(project.id, item.id, {
        version: item.version,
        reason: rejectReason.trim() === '' ? undefined : rejectReason,
      });
      onChanged('Se rechazó el retiro.');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await withdrawalsApi.cancel(project.id, item.id, { version: item.version });
      onChanged('Se canceló el retiro.');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  const badgeTone = {
    PENDING: 'amber',
    APPROVED: 'green',
    REJECTED: 'red',
    CANCELLED: 'slate',
  } as const;

  return (
    <li className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {formatPEN(item.amount)} de {item.houseName}{' '}
            <Badge tone={badgeTone[item.status]}>{WITHDRAWAL_STATUS_LABELS[item.status]}</Badge>
          </p>
          <p className="text-sm text-slate-600">{item.reason}</p>
          <p className="text-xs text-slate-500">
            Solicitado por {item.requestedBy.name} el {formatDateTime(item.requestedAt)}
            {item.decidedBy &&
              ` · ${item.status === 'APPROVED' ? 'Aprobado' : item.status === 'REJECTED' ? 'Rechazado' : 'Cancelado'} por ${item.decidedBy.name}`}
          </p>
        </div>
        {item.status === 'PENDING' && (
          <div className="flex flex-wrap items-center gap-2">
            {canApprove && (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void approve()}
              >
                Aprobar
              </button>
            )}
            {canApprove &&
              (rejecting ? (
                <>
                  <input
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="Motivo (opcional)"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy}
                    onClick={() => void reject()}
                  >
                    Confirmar rechazo
                  </button>
                </>
              ) : (
                <button type="button" className={btn} onClick={() => setRejecting(true)}>
                  Rechazar
                </button>
              ))}
            {(canApprove || user?.id === item.requestedBy.id) && (
              <button type="button" className={btn} disabled={busy} onClick={() => void cancel()}>
                Cancelar
              </button>
            )}
          </div>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}
