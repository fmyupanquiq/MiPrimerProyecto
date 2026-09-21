import { loginSchema } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { describeApiError } from '../api/errors.js';
import { useAuth } from '../auth/AuthContext.js';
import { AuthLayout, buttonClass, FormError, inputClass, linkClass } from './AuthLayout.js';

export function LoginPage() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // La validación del navegador ayuda al usuario; la autoridad es siempre la API (§58).
    const parsed = loginSchema.safeParse({ email, password, keepSignedIn });
    if (!parsed.success) {
      setError('Ingresa un correo válido y tu contraseña.');
      return;
    }

    setSubmitting(true);
    try {
      await login(parsed.data);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Iniciar sesión">
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
        <label className="flex flex-col gap-1 text-sm font-medium">
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(event) => setKeepSignedIn(event.target.checked)}
          />
          Mantener sesión iniciada
        </label>
        <FormError message={error} />
        <button type="submit" disabled={submitting} className={buttonClass}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="text-center">
        <Link to="/forgot-password" className={linkClass}>
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
    </AuthLayout>
  );
}
