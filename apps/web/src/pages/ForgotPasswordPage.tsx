import { forgotPasswordSchema } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { authApi } from '../api/auth.js';
import { describeApiError } from '../api/errors.js';
import { AuthLayout, buttonClass, FormError, inputClass, linkClass } from './AuthLayout.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.forgotPassword(parsed.data);
      setSent(true);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Recuperar contraseña">
      {sent ? (
        // El mensaje es el mismo exista o no el correo: la API tampoco lo revela (§104.4).
        <p role="status" className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
          Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. El
          enlace es válido durante 1 hora.
        </p>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Correo electrónico
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <FormError message={error} />
          <button type="submit" disabled={submitting} className={buttonClass}>
            {submitting ? 'Enviando…' : 'Enviar enlace'}
          </button>
        </form>
      )}
      <p className="text-center">
        <Link to="/login" className={linkClass}>
          Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
