import { SYSTEM_NAME } from '@letfer/shared';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import { btn } from '../ui.js';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 text-sm ${isActive ? 'bg-slate-200 font-medium' : 'text-slate-600'}`;

/** Marco de las pantallas autenticadas: navegación principal, persona usuaria y cierre de sesión. */
export function AppShell() {
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
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-lg font-semibold">
              {SYSTEM_NAME}
            </Link>
            <nav aria-label="Principal" className="flex gap-1">
              <NavLink to="/" end className={navClass}>
                Mis proyectos
              </NavLink>
              <NavLink to="/projects/trash" className={navClass}>
                Papelera
              </NavLink>
            </nav>
          </div>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span>
                <strong>
                  {user.firstName} {user.lastName}
                </strong>{' '}
                <span className="text-slate-500">({user.email})</span>
              </span>
              <button
                type="button"
                onClick={() => void onLogout()}
                disabled={closing}
                className={btn}
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <Outlet />
      </main>
    </div>
  );
}
