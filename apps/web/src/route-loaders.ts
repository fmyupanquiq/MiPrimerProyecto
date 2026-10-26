/**
 * Cargadores de las pantallas que se descargan bajo demanda. Un mismo cargador sirve para pintar la
 * ruta (`React.lazy` en `App.tsx`) y para adelantar su descarga (`prefetchRoute`, `warmDashboard`):
 * el navegador resuelve `import()` una sola vez, así que descargar antes no duplica nada.
 *
 * Solo contiene código de interfaz; nunca datos ni cifras.
 */
export const loadDashboardPage = () => import('./pages/project/DashboardPage.js');
export const loadReportsPage = () => import('./pages/project/ReportsPage.js');
export const loadBetsPage = () => import('./pages/project/BetsPage.js');
export const loadBetDetailView = () => import('./pages/project/BetDetailView.js');
export const loadFinancePage = () => import('./pages/project/FinancePage.js');
export const loadStagesPage = () => import('./pages/project/StagesPage.js');
export const loadReturnsPage = () => import('./pages/project/ReturnsPage.js');
export const loadMembersPage = () => import('./pages/project/MembersPage.js');
export const loadSettingsPage = () => import('./pages/project/SettingsPage.js');
export const loadAuditPage = () => import('./pages/project/AuditPage.js');
export const loadProjectTrashPage = () => import('./pages/project/TrashPage.js');
export const loadProjectSetupPage = () => import('./pages/project/ProjectSetupPage.js');
export const loadImportsPage = () => import('./pages/project/imports/ImportsPage.js');
export const loadImportUploadPage = () => import('./pages/project/imports/ImportUploadPage.js');
export const loadImportBatchPage = () => import('./pages/project/imports/ImportBatchPage.js');
export const loadAccountPage = () => import('./pages/AccountPage.js');
export const loadTrashPage = () => import('./pages/TrashPage.js');
export const loadAdminLayout = () => import('./pages/admin/AdminLayout.js');
export const loadAdminPage = () => import('./pages/AdminPage.js');
export const loadAdminAuditPage = () => import('./pages/admin/AdminAuditPage.js');
export const loadAdminUsersPage = () => import('./pages/admin/AdminUsersPage.js');
export const loadAdminUserDetailPage = () => import('./pages/admin/AdminUserDetailPage.js');
export const loadAdminAccountDeletionsPage = () =>
  import('./pages/admin/AdminAccountDeletionsPage.js');
export const loadAdminProjectsPage = () => import('./pages/admin/AdminProjectsPage.js');

/** Sufijo de la ruta de proyecto → cargador de su pantalla (solo las de uso frecuente). */
const projectRouteLoaders: Record<string, () => Promise<unknown>> = {
  '': loadDashboardPage,
  bets: loadBetsPage,
  reports: loadReportsPage,
  finance: loadFinancePage,
  returns: loadReturnsPage,
  stages: loadStagesPage,
};

const requested = new Set<string>();

function quietly(load: () => Promise<unknown>): void {
  // Precargar nunca debe romper nada: si falla (red), la ruta lo reintentará al abrirse.
  load().catch(() => undefined);
}

/** Adelanta la descarga del código de la pantalla a la que apunta un enlace de `/projects/:id/...`. */
export function prefetchRoute(path: string): void {
  const match = /^\/projects\/[^/?#]+\/?([^/?#]*)/.exec(path);
  if (!match) return;
  const loader = projectRouteLoaders[match[1] ?? ''];
  if (!loader || requested.has(match[1] ?? '')) return;
  requested.add(match[1] ?? '');
  quietly(loader);
}

/** ¿El usuario pidió ahorrar datos? Entonces no se precarga nada que no vaya a abrir. */
function savingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * Cuando el navegador está ocioso, adelanta las pantallas más usadas para que cambiar de sección sea
 * instantáneo. Va de una en una y no se ejecuta con "ahorro de datos".
 */
export function prefetchCommonRoutesWhenIdle(
  projectPath: string,
  prefetch: (path: string) => void = prefetchRoute,
): void {
  if (savingData()) return;
  const schedule: (callback: () => void) => void =
    typeof window.requestIdleCallback === 'function'
      ? (callback) => window.requestIdleCallback(callback, { timeout: 4000 })
      : (callback) => window.setTimeout(callback, 1500);
  const queue = ['bets', 'reports', 'finance'];
  const next = () => {
    const suffix = queue.shift();
    if (suffix === undefined) return;
    prefetch(`${projectPath}/${suffix}`);
    schedule(next);
  };
  // Se espera unos segundos tras mostrar el proyecto: la carga inicial (gráficos, listas) va primero.
  window.setTimeout(() => schedule(next), 3000);
}
