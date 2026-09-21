import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { loginPathFor } from './auth/redirect.js';
import { ReauthProvider } from './auth/ReauthContext.js';
import { AppShell } from './pages/AppShell.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import { TrashPage } from './pages/TrashPage.js';

/** Solo deja pasar a usuarios con sesión; si no, redirige al inicio de sesión y vuelve después. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <p className="p-6 text-center">Cargando…</p>;
  if (status === 'anonymous') {
    return <Navigate to={loginPathFor(location.pathname + location.search)} replace />;
  }
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          element={
            <RequireAuth>
              <ReauthProvider>
                <AppShell />
              </ReauthProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/trash" element={<TrashPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
