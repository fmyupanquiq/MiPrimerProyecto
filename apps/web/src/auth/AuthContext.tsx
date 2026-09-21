import type { LoginInput, PublicUser } from '@letfer/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authApi } from '../api/auth.js';
import { ApiError } from '../api/client.js';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Estado de autenticación de la web: consulta la sesión al cargar y expone login y logout. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((state) => {
        if (cancelled) return;
        setUser(state.user);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 401 = no hay sesión (caso normal). Cualquier otro fallo también deja la web en el login.
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.error('No se pudo consultar la sesión', error);
        }
        setUser(null);
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const state = await authApi.login(input);
    setUser(state.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Aunque la llamada falle, la web deja de mostrar la sesión.
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
