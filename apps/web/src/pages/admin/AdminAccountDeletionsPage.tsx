import {
  ACCOUNT_DELETION_STATUSES,
  type AccountDeletionRequestSummary,
  type AccountDeletionStatus,
} from '@letfer/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { accountDeletionsApi } from '../../api/admin.js';
import { describeApiError } from '../../api/errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { isReauthCancelled, useReauth } from '../../auth/ReauthContext.js';
import { useLoad } from '../../hooks/useLoad.js';
import { ACCOUNT_DELETION_STATUS_LABELS, formatDateTime } from '../../labels.js';
import { Badge, btn, btnDanger, btnPrimary, inputClass, Notice, Section } from '../../ui.js';

type Decision = { id: string; kind: 'approve' | 'reject' };

/**
 * Solicitudes de eliminación de cuenta (§8, §111.3): solo el Administrador Global las aprueba o
 * rechaza. Aprobar exige confirmar la contraseña y deja la cuenta eliminada lógicamente.
 */
export function AdminAccountDeletionsPage() {
  const { can } = useAuth();
  const runWithReauth = useReauth();
  const [filter, setFilter] = useState<AccountDeletionStatus | ''>('PENDING');
  const allowed = can('system.account_deletions.decide');
  const requests = useLoad(`admin-deletions:${filter}`, () =>
    allowed ? accountDeletionsApi.list(filter || undefined) : Promise.resolve([]),
  );
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!allowed) {
    return <Notice tone="info">No tienes permiso para decidir sobre estas solicitudes.</Notice>;
  }

  async function submit(request: AccountDeletionRequestSummary, kind: Decision['kind']) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input = { version: request.version, ...(reason.trim() && { reason: reason.trim() }) };
      if (kind === 'approve') {
        await runWithReauth(() => accountDeletionsApi.approve(request.id, input));
        setNotice(`La cuenta de ${request.userName} se eliminó.`);
      } else {
        await accountDeletionsApi.reject(request.id, input);
        setNotice(`Se rechazó la solicitud de ${request.userName}.`);
      }
      setDecision(null);
      setReason('');
      requests.reload();
    } catch (caught) {
      if (!isReauthCancelled(caught)) setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Solicitudes de eliminación de cuenta">
      <p className="text-sm text-slate-600">
        Aprobar deja la cuenta eliminada: se cierran sus sesiones y no podrá volver a iniciar
        sesión. El historial financiero y operativo se conserva. No se puede aprobar si la persona
        es propietaria de proyectos o el último Administrador Global.
      </p>
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        Estado
        <select
          className={inputClass}
          value={filter}
          onChange={(event) => setFilter(event.target.value as AccountDeletionStatus | '')}
        >
          <option value="">Todas</option>
          {ACCOUNT_DELETION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ACCOUNT_DELETION_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {requests.error && <Notice tone="error">{requests.error}</Notice>}
      {requests.loading && !requests.data && <p>Cargando solicitudes…</p>}
      {requests.data && requests.data.length === 0 && (
        <Notice tone="info">No hay solicitudes con ese estado.</Notice>
      )}

      <ul className="flex flex-col gap-3" aria-label="Solicitudes de eliminación">
        {requests.data?.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-4"
          >
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <Link to={`/admin/users/${request.userId}`} className="underline">
                {request.userName}
              </Link>
              <Badge tone={request.status === 'PENDING' ? 'amber' : 'slate'}>
                {ACCOUNT_DELETION_STATUS_LABELS[request.status]}
              </Badge>
            </p>
            <p className="text-xs text-slate-500">
              {request.userEmail} · Solicitada el {formatDateTime(request.requestedAt)}
              {request.reason && ` · Motivo: ${request.reason}`}
            </p>
            {request.decidedAt && (
              <p className="text-xs text-slate-500">
                Decidida el {formatDateTime(request.decidedAt)}
                {request.decidedBy && ` por ${request.decidedBy.name}`}
                {request.decisionReason && ` · ${request.decisionReason}`}
              </p>
            )}

            {request.status === 'PENDING' &&
              (decision?.id === request.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit(request, decision.kind);
                  }}
                >
                  <label className="flex flex-col gap-1 text-sm">
                    Motivo de la decisión (opcional)
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
                      className={decision.kind === 'approve' ? btnDanger : btnPrimary}
                    >
                      {decision.kind === 'approve'
                        ? `Confirmar eliminación de ${request.userName}`
                        : `Confirmar rechazo de ${request.userName}`}
                    </button>
                    <button
                      type="button"
                      className={btn}
                      onClick={() => {
                        setDecision(null);
                        setReason('');
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnDanger}
                    aria-label={`Aprobar la eliminación de ${request.userName}`}
                    onClick={() => setDecision({ id: request.id, kind: 'approve' })}
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    className={btn}
                    aria-label={`Rechazar la solicitud de ${request.userName}`}
                    onClick={() => setDecision({ id: request.id, kind: 'reject' })}
                  >
                    Rechazar
                  </button>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </Section>
  );
}
