import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { adminUsersApi } from '../../api/admin.js';
import { describeApiError } from '../../api/errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import {
  ACCOUNT_DELETION_STATUS_LABELS,
  formatDateTime,
  PROJECT_STATUS_LABELS,
  roleLabel,
  USER_STATUS_LABELS,
} from '../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../ui.js';
import { USER_STATUS_TONES } from './AdminUsersPage.js';

/** Ficha de un usuario (§111.3): datos, proyectos que posee, sesiones y acciones de estado. */
export function AdminUserDetailPage() {
  const { userId = '' } = useParams();
  const { can } = useAuth();
  const runWithReauth = useReauth();
  const detail = useLoad(`admin-user:${userId}`, () => adminUsersApi.get(userId));
  const [pendingAction, setPendingAction] = useState<'disable' | 'enable' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!can('system.users.view')) {
    return <Notice tone="info">No tienes permiso para ver los usuarios.</Notice>;
  }
  if (detail.loading && !detail.data) return <p>Cargando usuario…</p>;
  if (!detail.data) {
    return (
      <>
        <Notice tone="error">
          {detail.errorStatus === 404
            ? 'No se encontró el usuario.'
            : (detail.error ?? 'No se pudo cargar el usuario.')}
        </Notice>
        <p>
          <Link to="/admin/users" className="text-sm underline">
            ← Volver a usuarios
          </Link>
        </p>
      </>
    );
  }
  const user = detail.data;
  const canManage = can('system.users.manage');

  async function submit(action: 'disable' | 'enable') {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input = { version: user.version, ...(reason.trim() && { reason: reason.trim() }) };
      const updated = await runWithReauth(() =>
        action === 'disable'
          ? adminUsersApi.disable(user.id, input)
          : adminUsersApi.enable(user.id, input),
      );
      detail.setData(updated);
      setNotice(action === 'disable' ? 'La cuenta se deshabilitó.' : 'La cuenta se reactivó.');
      setPendingAction(null);
      setReason('');
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        <Link to="/admin/users" className="text-sm text-slate-600 underline">
          ← Usuarios
        </Link>
      </p>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Section title={`${user.firstName} ${user.lastName}`}>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={USER_STATUS_TONES[user.status]}>{USER_STATUS_LABELS[user.status]}</Badge>
          <Badge tone={user.globalRole === 'GLOBAL_ADMIN' ? 'blue' : 'slate'}>
            {roleLabel(user.globalRole)}
          </Badge>
        </p>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-slate-500">Correo</dt>
          <dd>{user.email}</dd>
          <dt className="text-slate-500">Alta</dt>
          <dd>{formatDateTime(user.createdAt)}</dd>
          <dt className="text-slate-500">Último acceso</dt>
          <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca'}</dd>
          <dt className="text-slate-500">Sesiones abiertas</dt>
          <dd>{user.activeSessionCount}</dd>
          {user.deletedAt && (
            <>
              <dt className="text-slate-500">Eliminada el</dt>
              <dd>{formatDateTime(user.deletedAt)}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section title="Proyectos que posee">
        {user.ownedProjects.length === 0 ? (
          <p className="text-sm text-slate-500">No es propietaria de ningún proyecto.</p>
        ) : (
          <>
            <Notice tone="info">
              Mientras sea propietaria de proyectos, su cuenta no se puede deshabilitar ni eliminar:
              transfiere primero la propiedad desde Administración › Proyectos.
            </Notice>
            <ul className="flex flex-col gap-1 text-sm">
              {user.ownedProjects.map((project) => (
                <li key={project.id}>
                  <strong>{project.name}</strong>{' '}
                  <span className="text-slate-500">
                    (
                    {PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] ??
                      project.status}
                    )
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {user.deletionRequest && (
        <Section title="Solicitud de eliminación de cuenta">
          <p className="text-sm">
            <Badge tone={user.deletionRequest.status === 'PENDING' ? 'amber' : 'slate'}>
              {ACCOUNT_DELETION_STATUS_LABELS[user.deletionRequest.status]}
            </Badge>{' '}
            solicitada el {formatDateTime(user.deletionRequest.requestedAt)}
            {user.deletionRequest.reason && ` · Motivo: ${user.deletionRequest.reason}`}
          </p>
          {user.deletionRequest.status === 'PENDING' && can('system.account_deletions.decide') && (
            <p className="text-sm">
              <Link to="/admin/deletions" className="underline">
                Ir a las solicitudes de eliminación
              </Link>
            </p>
          )}
        </Section>
      )}

      {canManage && user.status !== 'DELETED' && (
        <Section title="Estado de la cuenta">
          {pendingAction === null ? (
            user.status === 'ACTIVE' ? (
              <button
                type="button"
                className={`${btnDanger} self-start`}
                onClick={() => setPendingAction('disable')}
              >
                Deshabilitar cuenta
              </button>
            ) : (
              <button
                type="button"
                className={`${btnPrimary} self-start`}
                onClick={() => setPendingAction('enable')}
              >
                Reactivar cuenta
              </button>
            )
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(pendingAction);
              }}
            >
              <p className="text-sm">
                {pendingAction === 'disable'
                  ? 'Al deshabilitar la cuenta se cierran todas sus sesiones y no podrá iniciar sesión. Su historial se conserva.'
                  : 'La persona podrá volver a iniciar sesión con su contraseña.'}
              </p>
              <label className="flex flex-col gap-1 text-sm">
                Motivo (opcional)
                <input
                  className={inputClass}
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className={pendingAction === 'disable' ? btnDanger : btnPrimary}
                >
                  {pendingAction === 'disable'
                    ? 'Confirmar deshabilitación'
                    : 'Confirmar reactivación'}
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    setPendingAction(null);
                    setReason('');
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </Section>
      )}
    </>
  );
}
