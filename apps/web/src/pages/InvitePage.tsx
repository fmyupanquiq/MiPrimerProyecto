import { ErrorCode, registerSchema, type InvitationPreview } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { describeApiError } from '../api/errors.js';
import { invitationsApi } from '../api/projects.js';
import { useAuth } from '../auth/AuthContext.js';
import { useLoad } from '../hooks/useLoad.js';
import { formatDateTime, roleLabel } from '../labels.js';
import { AuthLayout, buttonClass, FormError, inputClass, linkClass } from './AuthLayout.js';

const secondaryButton = 'w-full rounded border border-slate-300 px-4 py-2 disabled:opacity-50';

/**
 * Página de una invitación (§84, §105.7). Quien recibe el enlace ve a qué proyecto y con qué rol lo
 * invitan; si no tiene sesión puede iniciar sesión o crear su cuenta aquí mismo; y después acepta o
 * rechaza. Crear la cuenta NO acepta la invitación: es un paso posterior y explícito.
 */
export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const preview = useLoad<InvitationPreview | null>(`invite:${token}`, () =>
    token ? invitationsApi.preview(token) : Promise.resolve(null),
  );

  if (token === '')
    return <InvalidInvitation message="El enlace no contiene ninguna invitación." />;
  if (preview.loading && !preview.data) {
    return (
      <AuthLayout title="Invitación a un proyecto">
        <p className="text-center">Cargando invitación…</p>
      </AuthLayout>
    );
  }
  if (!preview.data) {
    // 400 INVALID_TOKEN cubre cualquier enlace inválido: usado, vencido, deshabilitado, etc.
    if (preview.errorStatus === 400 || preview.errorStatus === 404) {
      return (
        <InvalidInvitation message="Esta invitación no es válida: puede haber caducado, haberse usado o haberse deshabilitado. Pide a quien te invitó que cree una nueva." />
      );
    }
    return (
      <AuthLayout title="Invitación a un proyecto">
        <FormError message={preview.error ?? 'No se pudo cargar la invitación.'} />
        <button type="button" className={buttonClass} onClick={preview.reload}>
          Reintentar
        </button>
      </AuthLayout>
    );
  }

  return <InvitationCard token={token} preview={preview.data} />;
}

function InvalidInvitation({ message }: { message: string }) {
  return (
    <AuthLayout title="Invitación no válida">
      <FormError message={message} />
      <p className="text-center">
        <Link to="/" className={linkClass}>
          Ir a LetFer
        </Link>
      </p>
    </AuthLayout>
  );
}

function InvitationCard({ token, preview }: { token: string; preview: InvitationPreview }) {
  const { status } = useAuth();
  // Se recuerda aquí (y no en el formulario, que desaparece al iniciar sesión) para avisar después.
  const [registered, setRegistered] = useState(false);
  return (
    <AuthLayout title="Invitación a un proyecto">
      <section
        aria-label="Invitación"
        className="flex flex-col gap-1 rounded border border-slate-200 bg-white p-4"
      >
        <p>
          <strong>{preview.invitedBy}</strong> te invitó al proyecto{' '}
          <strong>«{preview.projectName}»</strong>.
        </p>
        <p className="text-sm text-slate-600">
          Ingresarás con el rol de <strong>{roleLabel(null, preview.roleName)}</strong>.
        </p>
        {preview.restrictedEmailHint && (
          <p className="text-sm text-slate-600">
            Esta invitación es solo para la cuenta <strong>{preview.restrictedEmailHint}</strong>.
          </p>
        )}
        <p className="text-xs text-slate-500">
          {preview.expiresAt
            ? `Vigente hasta el ${formatDateTime(preview.expiresAt)}.`
            : 'No tiene fecha de vencimiento.'}
        </p>
      </section>
      {status === 'loading' && <p className="text-center">Comprobando sesión…</p>}
      {status === 'authenticated' && <Decision token={token} justRegistered={registered} />}
      {status === 'anonymous' && (
        <SignInOrRegister
          token={token}
          hint={preview.restrictedEmailHint}
          onRegistered={() => setRegistered(true)}
        />
      )}
    </AuthLayout>
  );
}

/** Aceptar o rechazar, con la sesión ya iniciada. */
function Decision({ token, justRegistered }: { token: string; justRegistered: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const result = await invitationsApi.accept(token);
      void navigate(`/projects/${result.projectId}`, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === ErrorCode.FORBIDDEN
          ? 'Esta invitación está dirigida a otra cuenta. Cambia de cuenta para aceptarla.'
          : caught instanceof ApiError && caught.code === ErrorCode.INVALID_TOKEN
            ? 'La invitación ya no es válida: puede haber caducado, haberse usado o haberse deshabilitado.'
            : describeApiError(caught),
      );
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await invitationsApi.reject(token);
      setRejected(true);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (rejected) {
    return (
      <>
        <p role="status" className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
          Rechazaste la invitación. Si cambias de opinión, el enlace seguirá funcionando mientras
          esté vigente.
        </p>
        <p className="text-center">
          <Link to="/" className={linkClass}>
            Ir a mis proyectos
          </Link>
        </p>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {justRegistered && (
        <p
          role="status"
          className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800"
        >
          Tu cuenta se creó. Para entrar al proyecto, acepta la invitación.
        </p>
      )}
      {user && (
        <p className="text-center text-sm text-slate-600">
          Sesión iniciada como{' '}
          <strong>
            {user.firstName} {user.lastName}
          </strong>{' '}
          ({user.email})
        </p>
      )}
      <FormError message={error} />
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void accept()}>
        Aceptar invitación
      </button>
      <button
        type="button"
        className={secondaryButton}
        disabled={busy}
        onClick={() => void reject()}
      >
        Rechazar
      </button>
      <button
        type="button"
        className={`${linkClass} self-center`}
        onClick={() => void logout()}
        disabled={busy}
      >
        Usar otra cuenta
      </button>
    </div>
  );
}

type Mode = 'register' | 'login';

function SignInOrRegister({
  token,
  hint,
  onRegistered,
}: {
  token: string;
  hint: string | null;
  onRegistered: () => void;
}) {
  const [mode, setMode] = useState<Mode>('register');
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Acceso" className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={mode === 'register'}
          onClick={() => setMode('register')}
          className={`rounded border px-3 py-2 text-sm ${mode === 'register' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}
        >
          Crear cuenta
        </button>
        <button
          type="button"
          aria-pressed={mode === 'login'}
          onClick={() => setMode('login')}
          className={`rounded border px-3 py-2 text-sm ${mode === 'login' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}
        >
          Ya tengo cuenta
        </button>
      </div>
      {mode === 'register' ? (
        <RegisterForm
          token={token}
          hint={hint}
          onRegistered={onRegistered}
          onHaveAccount={() => setMode('login')}
        />
      ) : (
        <LoginForm />
      )}
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (email.trim() === '' || password === '') {
      setError('Ingresa tu correo y tu contraseña.');
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: email.trim().toLowerCase(), password, keepSignedIn: false });
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Iniciar sesión"
      noValidate
    >
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
      <FormError message={error} />
      <button type="submit" disabled={submitting} className={buttonClass}>
        {submitting ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

function RegisterForm({
  token,
  hint,
  onRegistered,
  onHaveAccount,
}: {
  token: string;
  hint: string | null;
  onRegistered: () => void;
  onHaveAccount: () => void;
}) {
  const { register } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setEmailTaken(false);
    if (password !== repeat) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    const parsed = registerSchema.safeParse({
      token,
      firstName,
      lastName,
      email,
      password,
      keepSignedIn,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      await register(parsed.data);
      // El formulario ya no existe (se abrió la sesión), pero el aviso vive en la tarjeta.
      onRegistered();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === ErrorCode.EMAIL_IN_USE) setEmailTaken(true);
      setError(registerErrorMessage(caught, hint));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
      aria-label="Crear cuenta"
      noValidate
    >
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
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Contraseña nueva
          <input
            type="password"
            autoComplete="new-password"
            aria-describedby="register-password-help"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </label>
        <span id="register-password-help" className="text-xs text-slate-500">
          Entre 10 y 128 caracteres; no debe contener la parte local de tu correo.
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
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={keepSignedIn}
          onChange={(event) => setKeepSignedIn(event.target.checked)}
        />
        Mantener sesión iniciada
      </label>
      <FormError message={error} />
      {emailTaken && (
        <button type="button" onClick={onHaveAccount} className={secondaryButton}>
          Ya tengo cuenta: iniciar sesión
        </button>
      )}
      <button type="submit" disabled={submitting} className={buttonClass}>
        {submitting ? 'Creando cuenta…' : 'Crear cuenta'}
      </button>
      <p className="text-xs text-slate-500">
        Crear la cuenta no te une al proyecto: después podrás aceptar o rechazar la invitación.
      </p>
    </form>
  );
}

/** Mensaje de un fallo al registrarse; las reglas que solo conoce el servidor se muestran tal cual. */
function registerErrorMessage(error: unknown, hint: string | null): string {
  if (error instanceof ApiError) {
    if (error.code === ErrorCode.VALIDATION_FAILED) {
      const details = error.body.details;
      if (Array.isArray(details)) {
        const first = (details as { message?: unknown }[])[0];
        if (typeof first?.message === 'string') return first.message;
      }
    }
    if (error.code === ErrorCode.FORBIDDEN) {
      return hint
        ? `Esta invitación es solo para la cuenta ${hint}. Usa ese correo para registrarte.`
        : 'Esta invitación no admite ese correo.';
    }
    if (error.code === ErrorCode.INVALID_TOKEN) {
      return 'La invitación ya no es válida: puede haber caducado, haberse usado o haberse deshabilitado.';
    }
  }
  return describeApiError(error);
}
