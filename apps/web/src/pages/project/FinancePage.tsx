import {
  confirmReconciliationSchema,
  createExtraordinaryMovementSchema,
  createHouseSchema,
  createTransferSchema,
  formatPEN,
  moneyInputSchema,
  requestWithdrawalSchema,
  type HouseSummary,
  type MovementDirection,
  type MovementSummary,
  type ReconciliationCheckpointSummary,
  type ReconciliationReview,
  type WithdrawalRequestSummary,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { describeApiError } from '../../api/errors.js';
import { housesApi, movementsApi, withdrawalsApi } from '../../api/finance.js';
import { reconciliationsApi } from '../../api/reconciliations.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  formatDateTime,
  HOUSE_STATUS_LABELS,
  MOVEMENT_DIRECTION_LABELS,
  MOVEMENT_TYPE_LABELS,
  RECONCILIATION_STATUS_LABELS,
  WITHDRAWAL_STATUS_LABELS,
} from '../../labels.js';
import { Help, TermLabel } from '../../glossary.js';
import { ArrowDownLeftIcon, ArrowUpRightIcon, PlusIcon, SwapIcon } from '../../icons.js';
import {
  Badge,
  btn,
  btnDanger,
  btnPrimary,
  chipClass,
  inputClass,
  LoadingBlock,
  Notice,
  PageHeader,
  Section,
  SubNav,
} from '../../ui.js';
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
      <>
        <PageHeader title="Casas y Finanzas" />
        <Notice tone="info">
          Completa primero la{' '}
          <Link to={`/projects/${project.id}/setup`} className="font-medium underline">
            configuración inicial del proyecto
          </Link>
          .
        </Notice>
      </>
    );
  }

  const showMovementForm =
    can('movements.deposit') || can('movements.transfer') || can('movements.extraordinary');
  const showReconciliation = can('reconciliations.view') && houses.data && houses.data.length > 0;
  // Navegación interna (Fase 11, §17): solo ofrece un ancla a lo que de verdad va a existir en
  // esta pantalla para esta persona — nunca un salto a una sección que su rol no muestra.
  const subNavItems = [
    { id: 'casas', label: 'Casas' },
    ...(showMovementForm ? [{ id: 'movimientos', label: 'Movimientos' }] : []),
    { id: 'retiros', label: 'Retiros' },
    ...(showReconciliation ? [{ id: 'conciliacion', label: 'Conciliación' }] : []),
    { id: 'historial', label: 'Historial' },
  ];

  return (
    <>
      <PageHeader
        title="Casas y Finanzas"
        description="El saldo de cada casa, sus movimientos y la conciliación con la realidad."
        help={{
          label: 'Casas y Finanzas',
          text: 'El dinero del proyecto está repartido en casas de apuestas. Aquí ves cuánto hay en cada una, registras entradas y salidas, y compruebas que LetFer coincide con lo que muestra cada casa.',
        }}
      />
      <SubNav items={subNavItems} />
      {notice && <Notice tone="success">{notice}</Notice>}
      {/* `scroll-mt` despeja la barra superior + el `SubNav`, ambos fijos (QA responsiva, Fase
          11 §8): a menos de 640px esa pila mide ~135px, más que a 640px en adelante (~107px). */}
      <div id="casas" className="scroll-mt-[140px] sm:scroll-mt-28">
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
      </div>
      {showMovementForm && (
        <div id="movimientos" className="scroll-mt-[140px] sm:scroll-mt-28">
          <NewMovementSection
            houses={houses.data ?? []}
            onChanged={(message) => {
              setNotice(message);
              reloadAll();
            }}
          />
        </div>
      )}
      <div id="retiros" className="scroll-mt-[140px] sm:scroll-mt-28">
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
      </div>
      {showReconciliation && (
        <div id="conciliacion" className="scroll-mt-[140px] sm:scroll-mt-28">
          <ReconciliationSection houses={houses.data!} />
        </div>
      )}
      <Section
        id="historial"
        title="Historial de movimientos"
        description="Cada entrada (+) y salida (-) de dinero, de la más reciente a la más antigua. Nada se edita: una corrección es un movimiento nuevo."
        className="scroll-mt-[140px] sm:scroll-mt-28"
      >
        {movements.error && <Notice tone="error">{movements.error}</Notice>}
        {movements.loading && !movements.data && (
          <LoadingBlock lines={4} label="Cargando historial…" />
        )}
        {movements.data && movements.data.length === 0 && (
          <Notice tone="info">Todavía no hay movimientos.</Notice>
        )}
        {movements.data && movements.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
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
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <MovementAmount movement={movement} />
                    </td>
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
    <Section
      title="Casas"
      description="Cada casa es una cuenta con su propio saldo. Una casa nunca se borra: se desactiva."
      action={
        canCreate &&
        !showForm && (
          <button type="button" className={btnPrimary} onClick={() => setShowForm(true)}>
            <PlusIcon className="h-4 w-4" />
            Nueva casa
          </button>
        )
      }
    >
      {showForm && (
        <form
          onSubmit={(event) => void onCreate(event)}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
          noValidate
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Nombre de la casa
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? 'Creando…' : 'Crear casa'}
          </button>
          <button type="button" className={btn} onClick={() => setShowForm(false)}>
            Cancelar
          </button>
          {formError && <Notice tone="error">{formError}</Notice>}
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {rowError && <Notice tone="error">{rowError}</Notice>}
      {loading && houses.length === 0 && <LoadingBlock lines={2} label="Cargando casas…" />}
      {!loading && houses.length === 0 && <Notice tone="info">Todavía no hay casas.</Notice>}
      {houses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Casa</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">
                  <TermLabel term="balance" />
                </th>
                <th className="py-2 pr-3 font-medium">
                  <TermLabel term="committed" />
                </th>
                <th className="py-2 pr-3 font-medium">
                  <TermLabel term="available" />
                </th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {houses.map((house) => (
                <tr key={house.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium">{house.name}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={house.status === 'ACTIVE' ? 'green' : 'slate'}>
                      {HOUSE_STATUS_LABELS[house.status]}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatPEN(house.balance)}</td>
                  <td className="py-2 pr-3 text-slate-600 tabular-nums">
                    {formatPEN(house.committed)}
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {formatPEN(house.available)}
                  </td>
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
  const kinds: { key: MovementKind; label: string; hint: string }[] = [
    ...(can('movements.deposit')
      ? [
          {
            key: 'deposit' as const,
            label: 'Depósito',
            hint: 'Dinero nuevo que entra al proyecto en una casa. Aumenta el capital.',
          },
        ]
      : []),
    ...(can('movements.transfer')
      ? [
          {
            key: 'transfer' as const,
            label: 'Transferencia',
            hint: 'Mover dinero de una casa a otra del proyecto. El capital total no cambia y no es ganancia.',
          },
        ]
      : []),
    ...(can('movements.extraordinary')
      ? [
          {
            key: 'extraordinary' as const,
            label: 'Extraordinario',
            hint: 'Un cambio real de saldo que no es apuesta: bono, cashback, comisión. Pide tu contraseña.',
          },
        ]
      : []),
  ];
  const [kind, setKind] = useState<MovementKind>(kinds[0]?.key ?? 'deposit');

  return (
    <Section
      title="Registrar movimiento"
      description="Para dinero que entra o se mueve entre casas. Las apuestas mueven el saldo solas; los retiros van en su propia sección."
    >
      <div role="group" aria-label="Tipo de movimiento" className="flex flex-wrap gap-2">
        {kinds.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={kind === option.key}
            onClick={() => setKind(option.key)}
            className={chipClass(kind === option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-500">{kinds.find((option) => option.key === kind)?.hint}</p>
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
  const chosen = houses.find((house) => house.id === value);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
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
      {chosen && (
        <p className="text-xs text-slate-500">
          Disponible ahora:{' '}
          <strong className="text-slate-800">{formatPEN(chosen.available)}</strong>
        </p>
      )}
    </div>
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
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Monto
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
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
      <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium">
        Monto
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
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
      <Notice tone="warning">
        Solo para hechos reales de la casa (cashback, bonificación, comisión, corrección oficial):
        nunca un ajuste genérico para cuadrar un saldo.
      </Notice>
      <div className="grid gap-3 sm:grid-cols-3">
        <HouseSelect houses={houses} value={houseId} onChange={setHouseId} label="Casa" />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Monto
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
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
      <label className="flex flex-col gap-1.5 text-sm font-medium">
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
    <Section
      title="Retiros"
      description="Sacar dinero del proyecto. Al solicitarlo el monto queda reservado; se descuenta del saldo cuando alguien lo aprueba."
      action={
        can('withdrawals.request') &&
        !showForm && (
          <button type="button" className={btn} onClick={() => setShowForm(true)}>
            Solicitar retiro
          </button>
        )
      }
    >
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
      {loading && withdrawals.length === 0 && <LoadingBlock lines={2} label="Cargando retiros…" />}
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
      {project.status === 'CLOSED' && (
        <p className="text-xs text-slate-500">
          El proyecto está cerrado: los retiros de cierre siguen disponibles.
        </p>
      )}
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
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-label="Solicitar retiro"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <HouseSelect houses={houses} value={houseId} onChange={setHouseId} label="Casa" />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Monto
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
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
          {submitting ? 'Enviando…' : 'Enviar solicitud'}
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
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium tabular-nums">
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
                title="Descuenta el monto del saldo de la casa. Pide tu contraseña."
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
                Cancelar solicitud
              </button>
            )}
          </div>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

/** Conciliación por casa (§32, §80, §109.1): un registro de comparación, nunca un ajuste. */
function ReconciliationSection({ houses }: { houses: HouseSummary[] }) {
  const { project, can } = useProject();
  const [houseId, setHouseId] = useState(houses[0]?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

  const status = useLoad(`reconciliation-status:${project.id}:${houseId}`, () =>
    reconciliationsApi.status(project.id, houseId),
  );
  const history = useLoad(`reconciliation-history:${project.id}:${houseId}`, () =>
    reconciliationsApi.list(project.id, houseId),
  );
  const review = useLoad(`reconciliation-review:${project.id}:${houseId}:${showReview}`, () =>
    showReview
      ? reconciliationsApi.review(project.id, houseId)
      : Promise.resolve<ReconciliationReview>({ since: null, bets: [], movements: [] }),
  );

  if (houses.length === 0) return null;
  const selected = houses.find((house) => house.id === houseId);

  return (
    <Section
      title="Conciliación"
      description={
        <>
          Compara el disponible que calcula LetFer con el que muestra la casa.{' '}
          <Help term="reconciliation" />
        </>
      }
    >
      {notice && <Notice tone="success">{notice}</Notice>}
      <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium">
        Casa
        <select
          value={houseId}
          onChange={(event) => {
            setHouseId(event.target.value);
            setShowReview(false);
          }}
          className={inputClass}
        >
          {houses.map((house) => (
            <option key={house.id} value={house.id}>
              {house.name}
            </option>
          ))}
        </select>
      </label>

      {status.error && <Notice tone="error">{status.error}</Notice>}
      {status.data && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {status.data.requiresReconciliation ? (
            <Badge tone="amber">Requiere nueva conciliación</Badge>
          ) : (
            <Badge tone="green">Al día</Badge>
          )}
          {selected && (
            <span className="text-slate-600">
              Disponible según LetFer:{' '}
              <strong className="text-slate-900 tabular-nums">
                {formatPEN(selected.available)}
              </strong>
            </span>
          )}
        </div>
      )}

      {can('reconciliations.confirm') && (
        <ConfirmReconciliationForm
          houseId={houseId}
          onDone={(message) => {
            setNotice(message);
            status.reload();
            history.reload();
          }}
        />
      )}

      <button
        type="button"
        className={`${btn} self-start`}
        onClick={() => setShowReview((v) => !v)}
      >
        {showReview ? 'Ocultar' : 'Revisar desde última conciliación'}
      </button>
      {showReview && review.data && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-slate-500">
            {review.data.since
              ? `Desde ${formatDateTime(review.data.since)}`
              : 'Sin conciliación previa: se muestra todo desde el origen.'}
          </p>
          <p>
            {review.data.bets.length} apuesta(s) y {review.data.movements.length} movimiento(s)
            posteriores.
          </p>
        </div>
      )}

      <h3 className="text-sm font-semibold text-slate-800">Historial de conciliaciones</h3>
      {history.error && <Notice tone="error">{history.error}</Notice>}
      {history.data && history.data.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no hay conciliaciones para esta casa.</p>
      )}
      {history.data && history.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Fecha</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">LetFer</th>
                <th className="py-2 pr-3 font-medium">Oficial</th>
                <th className="py-2 pr-3 font-medium">Diferencia</th>
                <th className="py-2 font-medium">Conciliado por</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((row: ReconciliationCheckpointSummary) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{formatDateTime(row.occurredAt)}</td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={
                        row.status === 'MATCHED'
                          ? 'green'
                          : row.status === 'INVALIDATED'
                            ? 'slate'
                            : 'red'
                      }
                    >
                      {RECONCILIATION_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.status === 'INVALIDATED' && row.invalidatedReason && (
                      <p className="text-xs text-slate-500">{row.invalidatedReason}</p>
                    )}
                  </td>
                  <td className="py-2 pr-3">{formatPEN(row.letferAvailable)}</td>
                  <td className="py-2 pr-3">{formatPEN(row.officialAvailable)}</td>
                  <td className="py-2 pr-3">{formatPEN(row.difference)}</td>
                  <td className="py-2">{row.performedBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ConfirmReconciliationForm({
  houseId,
  onDone,
}: {
  houseId: string;
  onDone: (message: string) => void;
}) {
  const { project } = useProject();
  const [officialAvailable, setOfficialAvailable] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = confirmReconciliationSchema.safeParse({
      officialAvailable,
      note: note.trim() === '' ? undefined : note,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ingresa un saldo válido.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await reconciliationsApi.confirm(project.id, houseId, parsed.data);
      setOfficialAvailable('');
      setNote('');
      onDone(
        result.status === 'MATCHED'
          ? 'Coincide: se registró la conciliación.'
          : `Discrepancia registrada: diferencia de ${formatPEN(result.difference)}.`,
      );
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-label="Conciliar"
      noValidate
    >
      <p className="text-sm text-slate-600">
        Escribe el saldo disponible que muestra la casa ahora. Si coincide, queda un punto de
        control; si no, se registra la diferencia (nunca se ajusta el saldo).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Saldo disponible oficial
          <input
            value={officialAvailable}
            onChange={(event) => setOfficialAvailable(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nota (opcional)
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={submitting} className={`${btnPrimary} self-start`}>
        {submitting ? 'Conciliando…' : 'Conciliar'}
      </button>
    </form>
  );
}

/**
 * Importe de un movimiento con su signo, igual que lo aplica el ledger: en una casa, una salida
 * (`DEBIT`) resta y una entrada suma; una transferencia mueve dinero entre casas sin cambiar el
 * total. El signo y la flecha se leen sin depender del color.
 */
function MovementAmount({ movement }: { movement: MovementSummary }) {
  if (movement.houseId === null) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-700 tabular-nums">
        <SwapIcon className="h-3.5 w-3.5" />
        {formatPEN(movement.amount)}
      </span>
    );
  }
  const out = movement.direction === 'DEBIT';
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium tabular-nums ${out ? 'text-red-700' : 'text-green-700'}`}
    >
      {out ? (
        <ArrowDownLeftIcon className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpRightIcon className="h-3.5 w-3.5" />
      )}
      {out ? '-' : '+'}
      {formatPEN(movement.amount)}
    </span>
  );
}
