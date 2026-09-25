import { useState } from 'react';
import { accountDeletionsApi } from '../api/admin.js';
import { describeApiError } from '../api/errors.js';
import { useLoad } from '../hooks/useLoad.js';
import { ACCOUNT_DELETION_STATUS_LABELS, formatDateTime } from '../labels.js';
import { Badge, btn, btnDanger, inputClass, Notice, Section } from '../ui.js';

/** Mi cuenta: la persona gestiona su propia cuenta (§8, §111.3). */
export function AccountPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Mi cuenta</h1>
      <DeletionSection />
    </>
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
