import type {
  AuthState,
  LoginInput,
  PermissionCode,
  PublicUser,
  RegisterInput,
} from '@letfer/shared';
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
  /** Permisos GLOBALES del usuario (los del proyecto vienen con cada proyecto). */
  permissions: readonly PermissionCode[];
  /** ¿Tiene este permiso global? Solo mejora la interfaz: la autoridad es siempre la API. */
  can: (permission: PermissionCode) => boolean;
  login: (input: LoginInput) => Promise<void>;
  /** Crea la cuenta desde una invitación y abre sesión (§84, §105.7). */
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Estado de autenticación de la web: consulta la sesión al cargar y expone login y logout. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [permissions, setPermissions] = useState<readonly PermissionCode[]>([]);

  const apply = useCallback((state: AuthState) => {
    setUser(state.user);
    setPermissions(state.permissions);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setPermissions([]);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((state) => {
        if (!cancelled) apply(state);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 401 = no hay sesión (caso normal). Cualquier otro fallo también deja la web en el login.
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.error('No se pudo consultar la sesión', error);
        }
        clear();
      });
    return () => {
      cancelled = true;
    };
  }, [apply, clear]);

  const login = useCallback(
    async (input: LoginInput) => {
      apply(await authApi.login(input));
    },
    [apply],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      apply(await authApi.register(input));
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Aunque la llamada falle, la web deja de mostrar la sesión.
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      permissions,
      can: (permission) => permissions.includes(permission),
      login,
      register,
      logout,
    }),
    [status, user, permissions, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
