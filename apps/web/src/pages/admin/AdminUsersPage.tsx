import { USER_STATUSES, type AdminUserSummary, type UserStatus } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { adminUsersApi } from '../../api/admin.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { formatDate, roleLabel, USER_STATUS_LABELS } from '../../labels.js';
import { Badge, btn, btnPrimary, inputClass, Notice, Section } from '../../ui.js';

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

  const allowed = can('system.users.view');
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
    <Section title="Usuarios">
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
      {users.loading && !users.data && <p>Cargando usuarios…</p>}
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

function UserRow({ user }: { user: AdminUserSummary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3">
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
