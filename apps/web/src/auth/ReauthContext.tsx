import { ErrorCode } from '@letfer/shared';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { authApi } from '../api/auth.js';
import { ApiError } from '../api/client.js';
import { describeApiError } from '../api/errors.js';
import { buttonClass, FormError, inputClass } from '../pages/AuthLayout.js';

/** La persona canceló la confirmación de contraseña: no es un error que deba mostrarse. */
export class ReauthCancelledError extends Error {
  constructor() {
    super('Confirmación cancelada');
    this.name = 'ReauthCancelledError';
  }
}

type RunWithReauth = <T>(action: () => Promise<T>) => Promise<T>;

const ReauthContext = createContext<RunWithReauth | null>(null);

interface PendingReauth {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Acciones sensibles (§39): si la API responde `REAUTH_REQUIRED`, se pide la contraseña en un
 * cuadro de diálogo y, al confirmarla, la acción se reintenta una sola vez. Si se cancela, la
 * acción no se ejecuta y `runWithReauth` rechaza con `ReauthCancelledError`.
 */
export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<PendingReauth | null>(null);

  const askPassword = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setOpen(true);
      }),
    [],
  );

  const runWithReauth = useCallback<RunWithReauth>(
    async (action) => {
      try {
        return await action();
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== ErrorCode.REAUTH_REQUIRED) throw error;
        await askPassword();
        return action();
      }
    },
    [askPassword],
  );

  const finish = useCallback((error?: unknown) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    if (!current) return;
    if (error) current.reject(error);
    else current.resolve();
  }, []);

  const value = useMemo(() => runWithReauth, [runWithReauth]);
  return (
    <ReauthContext.Provider value={value}>
      {children}
      {open && (
        <ReauthDialog
          onConfirmed={() => finish()}
          onCancel={() => finish(new ReauthCancelledError())}
        />
      )}
    </ReauthContext.Provider>
  );
}

export function useReauth(): RunWithReauth {
  const context = useContext(ReauthContext);
  if (!context) throw new Error('useReauth debe usarse dentro de <ReauthProvider>');
  return context;
}

/** ¿Es la cancelación de la confirmación de contraseña? */
export const isReauthCancelled = (error: unknown): boolean => error instanceof ReauthCancelledError;

function ReauthDialog({
  onConfirmed,
  onCancel,
}: {
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError('Ingresa tu contraseña.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authApi.reauth(password);
      onConfirmed();
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        onSubmit={(event) => void onSubmit(event)}
        className="flex w-full max-w-sm flex-col gap-4 rounded bg-white p-6 shadow-lg"
        noValidate
      >
        <h2 id="reauth-title" className="text-lg font-semibold">
          Confirma tu contraseña
        </h2>
        <p className="text-sm text-slate-600">
          Por seguridad, esta acción requiere que confirmes tu contraseña.
        </p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Contraseña actual
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </label>
        <FormError message={error} />
        <div className="flex gap-2">
          <button type="submit" disabled={submitting} className={buttonClass}>
            {submitting ? 'Confirmando…' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="w-full rounded border border-slate-300 px-4 py-2"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
