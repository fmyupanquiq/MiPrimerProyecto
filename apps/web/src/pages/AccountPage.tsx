import type { SessionInfo } from '@letfer/shared';
import { useState } from 'react';
import { accountDeletionsApi } from '../api/admin.js';
import { authApi } from '../api/auth.js';
import { describeApiError } from '../api/errors.js';
import { useLoad } from '../hooks/useLoad.js';
import { ACCOUNT_DELETION_STATUS_LABELS, formatDateTime } from '../labels.js';
import { Badge, btn, btnDanger, inputClass, Notice, Section } from '../ui.js';

/** Mi cuenta: la persona gestiona su propia cuenta (§8, §111.3, §111.5). */
export function AccountPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Mi cuenta</h1>
      <SessionsSection />
      <DeletionSection />
    </>
  );
}

/** Sesiones abiertas de la persona (§3, §104.7): ver desde dónde entró y cerrar las demás. */
function SessionsSection() {
  const list = useLoad('account-sessions', () => authApi.sessions());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sessions: SessionInfo[] = list.data?.sessions ?? [];
  const others = sessions.filter((session) => !session.current);

  async function revoke(session: SessionInfo) {
    setBusy(session.id);
    setError(null);
    setNotice(null);
    try {
      await authApi.revokeSession(session.id);
      setNotice('Se cerró la sesión.');
      list.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy('others');
    setError(null);
    setNotice(null);
    try {
      const { revoked } = await authApi.revokeOtherSessions();
      setNotice(revoked === 1 ? 'Se cerró 1 sesión.' : `Se cerraron ${revoked} sesiones.`);
      list.reload();
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Sesiones abiertas">
      <p className="text-sm text-slate-600">
        Si no reconoces alguna sesión, ciérrala y cambia tu contraseña.
      </p>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {list.error && <Notice tone="error">{list.error}</Notice>}
      {list.loading && !list.data && <p>Cargando sesiones…</p>}
      <ul className="flex flex-col gap-2" aria-label="Sesiones abiertas">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 text-sm"
          >
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {session.userAgent ?? 'Dispositivo desconocido'}
                {session.current && <Badge tone="green">Esta sesión</Badge>}
                {session.persistent && <Badge tone="slate">Sesión persistente</Badge>}
              </p>
              <p className="text-xs text-slate-500">
                {session.ip ? `IP ${session.ip} · ` : ''}Inició el{' '}
                {formatDateTime(session.createdAt)} · Última actividad{' '}
                {formatDateTime(session.lastSeenAt)}
              </p>
            </div>
            {!session.current && (
              <button
                type="button"
                className={btn}
                disabled={busy !== null}
                aria-label={`Cerrar la sesión iniciada el ${formatDateTime(session.createdAt)}`}
                onClick={() => void revoke(session)}
              >
                Cerrar sesión
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <button
          type="button"
          className={`${btn} self-start`}
          disabled={busy !== null}
          onClick={() => void revokeOthers()}
        >
          Cerrar las demás sesiones
        </button>
      )}
    </Section>
  );
}

/**
 * Solicitar la eliminación de la propia cuenta (§8). Solo el Administrador Global la aprueba; la
 * persona puede retirar la solicitud mientras siga pendiente. No se borra nada de inmediato.
 */
function DeletionSection() {
  const state = useLoad('account-deletion', () => accountDeletionsApi.mine());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = state.data?.request ?? null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await accountDeletionsApi.request(reason.trim() || undefined);
      state.setData({ request: created });
      setConfirming(false);
      setReason('');
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
      const cancelled = await accountDeletionsApi.cancel();
      state.setData({ request: cancelled });
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Eliminar mi cuenta">
      {error && <Notice tone="error">{error}</Notice>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.loading && !state.data && <p>Cargando…</p>}

      {request?.status === 'PENDING' ? (
        <>
          <Notice tone="info">
            Pediste eliminar tu cuenta el {formatDateTime(request.requestedAt)}. Un Administrador
            Global debe aprobarlo; mientras tanto puedes seguir usando LetFer.
          </Notice>
          <button
            type="button"
            className={`${btn} self-start`}
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancelar solicitud
          </button>
        </>
      ) : (
        state.data && (
          <>
            {request && (
              <p className="text-sm text-slate-600">
                Tu última solicitud (
                <Badge tone="slate">{ACCOUNT_DELETION_STATUS_LABELS[request.status]}</Badge>
                {request.decisionReason ? `: ${request.decisionReason}` : ''}) ya está cerrada.
              </p>
            )}
            <p className="text-sm text-slate-600">
              Al eliminar tu cuenta pierdes el acceso a LetFer. El historial financiero y operativo
              de tus proyectos permanece, atribuido a tu nombre. Si eres propietario de algún
              proyecto, la propiedad debe transferirse antes de aprobar la solicitud.
            </p>
            {confirming ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
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
                  <button type="submit" className={btnDanger} disabled={busy}>
                    Enviar solicitud de eliminación
                  </button>
                  <button type="button" className={btn} onClick={() => setConfirming(false)}>
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className={`${btnDanger} self-start`}
                onClick={() => setConfirming(true)}
              >
                Solicitar eliminación de mi cuenta
              </button>
            )}
          </>
        )
      )}
    </Section>
  );
}
