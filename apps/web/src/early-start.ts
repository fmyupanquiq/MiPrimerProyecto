/**
 * Primer módulo que importa `main.tsx`: se evalúa ANTES que React y el resto de la aplicación, para que las
 * peticiones del Dashboard salgan en paralelo en vez de esperar a que la interfaz se monte (ver `api/early.ts`).
 */
import { startEarlyLoads } from './api/early.js';
import { loadDashboardPage } from './route-loaders.js';

const { dashboardOf } = startEarlyLoads(window.location.pathname);
// El código del Dashboard (y Recharts) también se descarga ya, no después de conocer el proyecto.
if (dashboardOf) loadDashboardPage().catch(() => undefined);
