import { ErrorCode, passwordPolicyIssues, resetPasswordSchema } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authApi } from '../api/auth.js';
import { ApiError } from '../api/client.js';
import { describeApiError } from '../api/errors.js';
import { AuthLayout, buttonClass, FormError, inputClass, linkClass } from './AuthLayout.js';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="Restablecer contraseña">
        <FormError message="El enlace no es válido. Solicita uno nuevo." />
        <p className="text-center">
          <Link to="/forgot-password" className={linkClass}>
            Solicitar un enlace nuevo
          </Link>
        </p>
      </AuthLayout>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    // Ayuda inmediata con las reglas de contraseña; la API vuelve a validarlas (§58).
    const issues = passwordPolicyIssues(newPassword);
    if (issues.length > 0) {
      setError(issues.map((issue) => issue.message).join(' '));
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, newPassword });
    if (!parsed.success) {
      setError('El enlace no es válido. Solicita uno nuevo.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword(parsed.data);
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === ErrorCode.VALIDATION_FAILED) {
        // Reglas que solo conoce el servidor (p. ej. la parte local del correo).
        const details = caught.body.details as { message: string }[] | undefined;
        setError(details?.map((detail) => detail.message).join(' ') ?? describeApiError(caught));
      } else {
        setError(describeApiError(caught));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthLayout title="Contraseña actualizada">
        <p role="status" className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
          Tu contraseña se restableció y se cerraron tus sesiones abiertas. Ya puedes iniciar
          sesión.
        </p>
        <p className="text-center">
          <Link to="/login" className={linkClass}>
            Ir a iniciar sesión
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Restablecer contraseña">
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Contraseña nueva
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Repite la contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className={inputClass}
          />
        </label>
        <p className="text-xs text-slate-500">
          Entre 10 y 128 caracteres; no puede contener la parte local de tu correo.
        </p>
        <FormError message={error} />
        <button type="submit" disabled={submitting} className={buttonClass}>
          {submitting ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </AuthLayout>
  );
}
