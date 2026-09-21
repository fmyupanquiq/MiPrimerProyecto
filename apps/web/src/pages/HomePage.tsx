import { SYSTEM_NAME } from '@letfer/shared';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { buttonClass } from './AuthLayout.js';

/** Contenedor autenticado provisional: la navegación real del proyecto llega en la Fase 2. */
export function HomePage() {
  const { user, logout } = useAuth();
  const [closing, setClosing] = useState(false);

  async function onLogout() {
    setClosing(true);
    try {
      await logout();
    } finally {
      setClosing(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">{SYSTEM_NAME}</h1>
      {user && (
        <p>
          Sesión iniciada como{' '}
          <strong>
            {user.firstName} {user.lastName}
          </strong>{' '}
          ({user.email})
        </p>
      )}
      <p className="text-slate-600">Base de la aplicación preparada (Fase 1).</p>
      <button
        type="button"
        onClick={() => void onLogout()}
        disabled={closing}
        className={`${buttonClass} max-w-xs`}
      >
        Cerrar sesión
      </button>
    </main>
  );
}
