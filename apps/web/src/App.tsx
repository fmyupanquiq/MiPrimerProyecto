import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';

/** Solo deja pasar a usuarios con sesión; si no, redirige al inicio de sesión. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <p className="p-6 text-center">Cargando…</p>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
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
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
