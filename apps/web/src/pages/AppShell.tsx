import { SYSTEM_NAME } from '@letfer/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import {
  ArchiveIcon,
  CloseIcon,
  FolderIcon,
  LogoutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from '../icons.js';
import { type ThemeMode, useTheme } from '../theme.js';
import { ADMIN_SECTION_PERMISSIONS } from './admin/AdminLayout.js';
import { btn } from '../ui.js';
import { ShellSlotsContext } from './shell-slots.js';
import { setDisplayTimeZone } from '../time-zone.js';

/** Rutas dentro de un proyecto (`/projects/:id/...`; `/projects/trash` es la papelera global). */
const PROJECT_PATH = /^\/projects\/(?!trash(?:\/|$))[^/]+/;

/**
 * ¿La ventana es más angosta que `breakpointPx`? (Fase 11, QA responsiva §8). `matchMedia` no
 * existe en jsdom (mismo cuidado que `theme.tsx`): sin él, se asume que NO es angosta — en las
 * pruebas, el único `ThemeSwitcher` que se monta es el de la barra superior, igual que antes.
 */
export function useIsNarrow(breakpointPx: number): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${breakpointPx}px)`).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [breakpointPx]);
  return narrow;
}

/** Enlace de la barra lateral oscura: activo en violeta, con foco visible. */
export const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${
    isActive
      ? 'bg-violet-600 font-medium text-white shadow-sm'
      : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
  }`;

export function SidebarLink({
  to,
  end,
  icon,
  children,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <NavLink to={to} end={end} className={sidebarLinkClass}>
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

/**
 * Marco de las pantallas autenticadas (Fase 10.3): barra lateral oscura con la navegación
 * principal (y, dentro de un proyecto, la del proyecto), barra superior con la persona usuaria y
 * cierre de sesión. En pantallas pequeñas la barra lateral es un cajón que se abre con "Menú".
 */
export function AppShell() {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  // Fuera de un proyecto no hay zona de proyecto: fechas en la del navegador (§93, H-20).
  if (!PROJECT_PATH.test(location.pathname)) setDisplayTimeZone(undefined);
  const [closing, setClosing] = useState(false);
  // El cajón (móvil) recuerda en qué ruta se abrió: al navegar a otra queda cerrado solo.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === location.pathname;
  const setDrawerOpen = (open: boolean) => setDrawerPath(open ? location.pathname : null);
  const [sidebarSlot, setSidebarSlot] = useState<HTMLElement | null>(null);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  // "Administración" (§37, §109) solo es visible con algún permiso system.* (Administrador Global).
  const showAdmin = ADMIN_SECTION_PERMISSIONS.some((permission) => can(permission));
  // QA responsiva (Fase 11, §8): a menos de 640px, el tema junto al resto de la barra superior
  // dejaba el nombre del proyecto truncado a unas pocas letras — el dato más importante de la
  // pantalla perdiendo todo protagonismo frente a un control secundario. Por debajo de 640px el
  // selector de tema vive en el cajón (cerca del principio, nunca al fondo); de 640px en
  // adelante sigue en la barra superior, como antes. Nunca los dos a la vez.
  const themeInDrawer = useIsNarrow(639);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerPath(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  async function onLogout() {
    setClosing(true);
    try {
      await logout();
    } finally {
      setClosing(false);
    }
  }

  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
    : '';

  return (
    <ShellSlotsContext.Provider value={{ sidebar: sidebarSlot, topbar: topbarSlot }}>
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Saltar al contenido
      </a>
      <div className="min-h-screen bg-slate-50 lg:flex">
        {drawerOpen && (
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <aside
          id="app-sidebar"
          aria-label="Barra lateral"
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-text transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
            drawerOpen ? 'translate-x-0' : 'max-lg:invisible -translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between px-5 py-5">
            <Link
              to="/"
              className="flex items-center gap-2 text-lg font-bold tracking-tight text-white"
            >
              <img src="/logo-64.png" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
              {SYSTEM_NAME}
            </Link>
            <button
              type="button"
              className="rounded-lg p-1 text-sidebar-muted hover:text-white lg:hidden"
              aria-label="Cerrar menú"
              onClick={() => setDrawerOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          <nav aria-label="Principal" className="flex flex-col gap-1 px-3">
            <SidebarLink to="/" end icon={<FolderIcon />}>
              Mis proyectos
            </SidebarLink>
            <SidebarLink to="/projects/trash" icon={<ArchiveIcon />}>
              Proyectos eliminados
            </SidebarLink>
            {showAdmin && (
              <SidebarLink to="/admin" icon={<SettingsIcon />}>
                Administración
              </SidebarLink>
            )}
          </nav>
          {themeInDrawer && (
            <div className="mt-4 px-3">
              <ThemeSwitcher variant="sidebar" />
            </div>
          )}
          {/* Navegación del proyecto actual, la pinta ProjectLayout (portal). */}
          <div ref={setSidebarSlot} className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-surface/90 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <button
                type="button"
                className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
                aria-label="Abrir menú"
                aria-controls="app-sidebar"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </button>
              {/* Cabecera del proyecto actual (nombre, estado, etapa, rol), la pinta ProjectLayout. */}
              <div ref={setTopbarSlot} className="min-w-0 flex-1" />
              {!themeInDrawer && <ThemeSwitcher />}
              {user && (
                <div className="flex items-center gap-3 text-sm">
                  <Link
                    to="/account"
                    title="Mi cuenta"
                    className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-500"
                  >
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700"
                      aria-hidden="true"
                    >
                      {initials}
                    </span>
                    {/* QA responsiva (§8): a 768px (`md:`) competía con el nombre del proyecto
                        por el mismo espacio y perdía el proyecto, lo más importante de la
                        pantalla; con la barra lateral persistente (`lg:`, 1024px) ya hay sitio
                        de sobra para las dos cosas. */}
                    <span className="hidden flex-col leading-tight lg:flex">
                      <strong>
                        {user.firstName} {user.lastName}
                      </strong>{' '}
                      <span className="text-xs text-slate-500">({user.email})</span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    disabled={closing}
                    className={btn}
                    aria-label="Cerrar sesión"
                    title="Cerrar sesión"
                  >
                    <LogoutIcon className="h-4 w-4" />
                    <span className="hidden sm:inline">Cerrar sesión</span>
                  </button>
                </div>
              )}
            </div>
          </header>
          <main
            id="main-content"
            className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:p-6"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </ShellSlotsContext.Provider>
  );
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  { mode: 'dark', label: 'Oscuro', icon: <MoonIcon className="h-4 w-4" /> },
  { mode: 'light', label: 'Claro', icon: <SunIcon className="h-4 w-4" /> },
  { mode: 'system', label: 'Sistema', icon: <MonitorIcon className="h-4 w-4" /> },
];

/**
 * Selector del tema visual (Fase 11, §9 y QA responsiva §8): en la barra superior de 640px en
 * adelante; por debajo, en el cajón (nunca los dos a la vez, ver `themeInDrawer`). Un único
 * control: tres opciones con icono, sin texto, para que quepa junto al resto de la barra.
 *
 * La barra lateral/cajón es siempre oscura, pase lo que pase con el tema (§5 del sistema de
 * diseño) — por eso `variant="sidebar"` usa los tokens fijos de la barra lateral
 * (`--color-sidebar*`) en vez de los que cambian con el tema, para no verse como una caja clara
 * flotando sobre fondo oscuro cuando el tema activo es "Claro".
 */
function ThemeSwitcher({ variant = 'topbar' }: { variant?: 'topbar' | 'sidebar' }) {
  const { mode, setMode } = useTheme();
  const isSidebar = variant === 'sidebar';
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={`flex gap-0.5 rounded-lg border p-0.5 ${
        isSidebar ? 'border-sidebar-border bg-sidebar-hover/60' : 'border-slate-200 bg-surface-2'
      }`}
    >
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={mode === option.mode}
          aria-label={option.label}
          title={option.label}
          onClick={() => setMode(option.mode)}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
            isSidebar
              ? `focus-visible:outline-violet-400 ${
                  mode === option.mode
                    ? 'bg-sidebar text-white shadow-sm'
                    : 'text-sidebar-muted hover:text-white'
                }`
              : `focus-visible:outline-violet-500 ${
                  mode === option.mode
                    ? 'bg-surface text-violet-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`
          }`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
