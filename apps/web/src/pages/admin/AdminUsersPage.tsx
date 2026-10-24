import {
  USER_STATUSES,
  type AdminUserDetail,
  type AdminUserSummary,
  type UserStatus,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { adminUsersApi } from '../../api/admin.js';
import { describeApiError } from '../../api/errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { formatDate, roleLabel, USER_STATUS_LABELS } from '../../labels.js';
import { Badge, btn, btnPrimary, inputClass, LoadingBlock, Notice, Section } from '../../ui.js';

const PAGE_SIZE = 25;

export const USER_STATUS_TONES = {
  ACTIVE: 'green',
  DISABLED: 'amber',
  DELETED: 'red',
} as const satisfies Record<UserStatus, 'green' | 'amber' | 'red'>;

/** Lista de usuarios del Administrador Global (§4.1, §111.3): buscar, filtrar y abrir su ficha. */
export function AdminUsersPage() {
  const { can } = useAuth();
  const [searchDraft, setSearchDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<UserStatus | ''>('');
  const [applied, setApplied] = useState<{ search: string; status: UserStatus | '' }>({
    search: '',
    status: '',
  });
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const allowed = can('system.users.view');
  const canCreate = can('system.users.create');
  const users = useLoad(`admin-users:${applied.search}:${applied.status}:${offset}`, () =>
    allowed
      ? adminUsersApi.list({
          search: applied.search || undefined,
          status: applied.status || undefined,
          limit: PAGE_SIZE,
          offset,
        })
      : Promise.resolve({ items: [], total: 0 }),
  );

  if (!allowed) return <Notice tone="info">No tienes permiso para ver los usuarios.</Notice>;

  function apply(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setApplied({ search: searchDraft.trim(), status: statusDraft });
  }

  const total = users.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <Section
      title="Usuarios"
      action={
        canCreate &&
        !creating && (
          <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
            Crear cuenta
          </button>
        )
      }
    >
      {notice && <Notice tone="success">{notice}</Notice>}
      {canCreate && creating && (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setNotice(
              `Cuenta creada para ${created.firstName} ${created.lastName} (${created.email}). ` +
                'Comunícale su correo y la contraseña que elegiste: ya puede iniciar sesión.',
            );
            setOffset(0);
            setApplied({ search: '', status: '' });
            users.reload();
          }}
        />
      )}
      <form onSubmit={apply} className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Buscar por nombre o correo
          <input
            className={inputClass}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Estado de la cuenta
          <select
            className={inputClass}
            value={statusDraft}
            onChange={(event) => setStatusDraft(event.target.value as UserStatus | '')}
          >
            <option value="">Todos</option>
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {USER_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className={btnPrimary}>
            Buscar
          </button>
        </div>
      </form>

      {users.error && <Notice tone="error">{users.error}</Notice>}
      {users.loading && !users.data && <LoadingBlock lines={2} label="Cargando usuarios…" />}
      {users.data && users.data.items.length === 0 && (
        <Notice tone="info">No hay usuarios con esos filtros.</Notice>
      )}

      <ul className="flex flex-col gap-2" aria-label="Usuarios">
        {users.data?.items.map((user) => (
          <UserRow key={user.id} user={user} />
        ))}
      </ul>

      {users.data && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>
            Mostrando {from}–{to} de {total}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              className={btn}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Anterior
            </button>
            <button
              type="button"
              className={btn}
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Siguiente
            </button>
          </span>
        </div>
      )}
    </Section>
  );
}

/**
 * Crear una cuenta directamente (ADR 0025): la contraseña la escribe el Administrador Global, no
 * su futuro dueño (a diferencia del registro por invitación). Nace activa, rol `USER`; comunicarle
 * el correo y la contraseña a la persona es responsabilidad de quien la crea, fuera de LetFer.
 */
function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (user: AdminUserDetail) => void;
  onCancel: () => void;
}) {
  const runWithReauth = useReauth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== repeat) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await runWithReauth(() =>
        adminUsersApi.create({ firstName, lastName, email, password }),
      );
      onCreated(created);
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Crear cuenta"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-surface-2 p-4"
      noValidate
    >
      <p className="text-sm text-slate-600">
        Elige tú la contraseña inicial y comunícasela a la persona por fuera de LetFer (no se le
        envía nada). Después podrás invitarla a un proyecto como a cualquier otro usuario.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nombre
          <input
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Apellido
          <input
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Correo electrónico
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Contraseña inicial
            <input
              type="password"
              autoComplete="new-password"
              aria-describedby="create-user-password-help"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <span id="create-user-password-help" className="text-xs text-slate-500">
            Entre 10 y 128 caracteres; no debe contener la parte local del correo.
          </span>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Repite la contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? 'Creando…' : 'Crear cuenta'}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function UserRow({ user }: { user: AdminUserSummary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-surface p-3">
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <Link to={`/admin/users/${user.id}`} className="underline">
            {user.firstName} {user.lastName}
          </Link>
          <Badge tone={USER_STATUS_TONES[user.status]}>{USER_STATUS_LABELS[user.status]}</Badge>
          {user.globalRole === 'GLOBAL_ADMIN' && (
            <Badge tone="blue">{roleLabel(user.globalRole)}</Badge>
          )}
          {user.hasPendingDeletionRequest && <Badge tone="amber">Pidió eliminar su cuenta</Badge>}
          {user.ownedProjectCount > 0 && (
            <Badge tone="slate">
              Propietaria de {user.ownedProjectCount}{' '}
              {user.ownedProjectCount === 1 ? 'proyecto' : 'proyectos'}
            </Badge>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {user.email} · Alta {formatDate(user.createdAt)}
          {user.lastLoginAt && ` · Último acceso ${formatDate(user.lastLoginAt)}`}
        </p>
      </div>
    </li>
  );
}
