import {
  type ComponentType,
  lazy,
  type LazyExoticComponent,
  type ReactNode,
  Suspense,
} from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { loginPathFor } from './auth/redirect.js';
import { ReauthProvider } from './auth/ReauthContext.js';
import { AdminLayout } from './pages/admin/AdminLayout.js';
import { AppShell } from './pages/AppShell.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { InvitePage } from './pages/InvitePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { ProjectLayout } from './pages/project/ProjectLayout.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import * as loaders from './route-loaders.js';

/**
 * Pantallas bajo demanda. Login, la lista de proyectos y el shell siguen en el paquete inicial; todo lo
 * demás (Dashboard y Reportes con Recharts, el asistente de apuestas, importaciones, administración...)
 * se descarga al entrar en esa sección, así que abrir el Login o el Dashboard no paga por ellas.
 */
function lazyNamed<Module, Name extends keyof Module>(
  load: () => Promise<Module>,
  name: Name,
): LazyExoticComponent<ComponentType> {
  return lazy(() => load().then((module) => ({ default: module[name] as ComponentType })));
}

const DashboardPage = lazyNamed(loaders.loadDashboardPage, 'DashboardPage');
const ReportsPage = lazyNamed(loaders.loadReportsPage, 'ReportsPage');
const BetsPage = lazyNamed(loaders.loadBetsPage, 'BetsPage');
const BetDetailView = lazyNamed(loaders.loadBetDetailView, 'BetDetailView');
const FinancePage = lazyNamed(loaders.loadFinancePage, 'FinancePage');
const StagesPage = lazyNamed(loaders.loadStagesPage, 'StagesPage');
const ReturnsPage = lazyNamed(loaders.loadReturnsPage, 'ReturnsPage');
const MembersPage = lazyNamed(loaders.loadMembersPage, 'MembersPage');
const SettingsPage = lazyNamed(loaders.loadSettingsPage, 'SettingsPage');
const AuditPage = lazyNamed(loaders.loadAuditPage, 'AuditPage');
const ProjectTrashPage = lazyNamed(loaders.loadProjectTrashPage, 'ProjectTrashPage');
const ProjectSetupPage = lazyNamed(loaders.loadProjectSetupPage, 'ProjectSetupPage');
const ImportsPage = lazyNamed(loaders.loadImportsPage, 'ImportsPage');
const ImportUploadPage = lazyNamed(loaders.loadImportUploadPage, 'ImportUploadPage');
const ImportBatchPage = lazyNamed(loaders.loadImportBatchPage, 'ImportBatchPage');
const AccountPage = lazyNamed(loaders.loadAccountPage, 'AccountPage');
const TrashPage = lazyNamed(loaders.loadTrashPage, 'TrashPage');
const AdminPage = lazyNamed(loaders.loadAdminPage, 'AdminPage');
const AdminAuditPage = lazyNamed(loaders.loadAdminAuditPage, 'AdminAuditPage');
const AdminUsersPage = lazyNamed(loaders.loadAdminUsersPage, 'AdminUsersPage');
const AdminUserDetailPage = lazyNamed(loaders.loadAdminUserDetailPage, 'AdminUserDetailPage');
const AdminAccountDeletionsPage = lazyNamed(
  loaders.loadAdminAccountDeletionsPage,
  'AdminAccountDeletionsPage',
);
const AdminProjectsPage = lazyNamed(loaders.loadAdminProjectsPage, 'AdminProjectsPage');

/** Mientras llega una página diferida: bloques grises, sin texto ni cifras provisionales. */
function PageLoading({ page }: { page?: 'dashboard' | 'reports' }) {
  return (
    // data-page-loading hace que el contenedor ya tenga el ancho de Dashboard/Reportes (sin salto al llegar).
    <div className="flex flex-col gap-4" aria-busy="true" data-page-loading={page}>
      <p className="sr-only">Cargando…</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-200/70" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-slate-200/70" />
    </div>
  );
}

/** Pantalla diferida con su marcador de carga discreto (el shell y la navegación siguen visibles). */
function Page({ children, wide }: { children: ReactNode; wide?: 'dashboard' | 'reports' }) {
  return <Suspense fallback={<PageLoading page={wide} />}>{children}</Suspense>;
}

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
        {/* La invitación es pública: quien la recibe puede no tener cuenta todavía. */}
        <Route path="/invite" element={<InvitePage />} />
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
          <Route
            path="/projects/trash"
            element={
              <Page>
                <TrashPage />
              </Page>
            }
          />
          <Route path="/admin" element={<AdminLayout />}>
            <Route
              index
              element={
                <Page>
                  <AdminPage />
                </Page>
              }
            />
            <Route
              path="audit"
              element={
                <Page>
                  <AdminAuditPage />
                </Page>
              }
            />
            <Route
              path="users"
              element={
                <Page>
                  <AdminUsersPage />
                </Page>
              }
            />
            <Route
              path="users/:userId"
              element={
                <Page>
                  <AdminUserDetailPage />
                </Page>
              }
            />
            <Route
              path="deletions"
              element={
                <Page>
                  <AdminAccountDeletionsPage />
                </Page>
              }
            />
            <Route
              path="projects"
              element={
                <Page>
                  <AdminProjectsPage />
                </Page>
              }
            />
          </Route>
          <Route
            path="/account"
            element={
              <Page>
                <AccountPage />
              </Page>
            }
          />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route
              index
              element={
                <Page wide="dashboard">
                  <DashboardPage />
                </Page>
              }
            />
            <Route
              path="reports"
              element={
                <Page wide="reports">
                  <ReportsPage />
                </Page>
              }
            />
            <Route
              path="setup"
              element={
                <Page>
                  <ProjectSetupPage />
                </Page>
              }
            />
            <Route
              path="stages"
              element={
                <Page>
                  <StagesPage />
                </Page>
              }
            />
            <Route
              path="finance"
              element={
                <Page>
                  <FinancePage />
                </Page>
              }
            />
            <Route
              path="bets"
              element={
                <Page>
                  <BetsPage />
                </Page>
              }
            />
            <Route
              path="bets/:betId"
              element={
                <Page>
                  <BetDetailView />
                </Page>
              }
            />
            <Route
              path="returns"
              element={
                <Page>
                  <ReturnsPage />
                </Page>
              }
            />
            <Route
              path="imports"
              element={
                <Page>
                  <ImportsPage />
                </Page>
              }
            />
            <Route
              path="imports/new"
              element={
                <Page>
                  <ImportUploadPage />
                </Page>
              }
            />
            <Route
              path="imports/:batchId"
              element={
                <Page>
                  <ImportBatchPage />
                </Page>
              }
            />
            <Route
              path="members"
              element={
                <Page>
                  <MembersPage />
                </Page>
              }
            />
            <Route
              path="audit"
              element={
                <Page>
                  <AuditPage />
                </Page>
              }
            />
            <Route
              path="trash"
              element={
                <Page>
                  <ProjectTrashPage />
                </Page>
              }
            />
            <Route
              path="settings"
              element={
                <Page>
                  <SettingsPage />
                </Page>
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
