/**
 * Peticiones GET adelantadas.
 *
 * Al abrir o recargar `/projects/:id` la web pedía la sesión, DESPUÉS el proyecto, DESPUÉS el código del
 * Dashboard y solo entonces sus datos: cuatro esperas encadenadas. Aquí se lanzan en paralelo, apenas
 * arranca el paquete principal, y `apiFetch` recoge cada resultado cuando la pantalla lo pide.
 *
 * Reglas:
 *  - Solo GET, sin cuerpo, a rutas de lectura que la pantalla pedirá exactamente igual.
 *  - Cada resultado se entrega UNA sola vez y caduca en 15 s: nunca sirve cifras viejas como actuales.
 *  - Si la persona no tiene sesión, nada se adelanta (se evita ruido de 401); la API sigue mandando.
 *  - No importa nada del paquete compartido (zod, etc.): debe poder ejecutarse lo antes posible.
 */

export interface RawResult {
  ok: boolean;
  status: number;
  payload: unknown;
}

const TTL_MS = 15_000;
const SESSION_HINT_KEY = 'letfer.session';
const pending = new Map<string, { result: Promise<RawResult>; expires: number }>();

export interface RawRequestOptions {
  method?: string;
  body?: unknown;
}

/** Hace la petición y devuelve la respuesta ya leída (sin interpretar errores: eso lo hace `apiFetch`). */
export async function rawRequest(
  path: string,
  options: RawRequestOptions = {},
): Promise<RawResult> {
  const { method = 'GET', body } = options;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return { ok: true, status: 204, payload: undefined };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return { ok: response.ok, status: response.status, payload };
}

/**
 * Descarta TODO lo adelantado. Se llama al abrir y al cerrar sesión (y si la sesión resulta inválida): un
 * resultado pedido con la sesión de una persona nunca debe poder entregarse a otra.
 */
export function clearEarly(): void {
  pending.clear();
}

function start(path: string): void {
  const current = pending.get(path);
  if (current && current.expires >= Date.now()) return;
  const result = rawRequest(path);
  // Si nadie lo recoge, el rechazo no debe quedar como error no gestionado.
  result.catch(() => undefined);
  pending.set(path, { result, expires: Date.now() + TTL_MS });
}

/** Entrega (una sola vez) el resultado adelantado de este GET, si existe y no ha caducado. */
export function takeEarly(path: string): Promise<RawResult> | null {
  const entry = pending.get(path);
  if (!entry) return null;
  pending.delete(path);
  return entry.expires >= Date.now() ? entry.result : null;
}

/** Recuerda (solo en este navegador) si hubo una sesión abierta, para decidir si adelantar peticiones. */
export function rememberSession(active: boolean): void {
  try {
    if (active) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Sin almacenamiento: simplemente no se adelanta nada.
  }
}

function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Rutas que `DashboardPage` y `ProjectLayout` piden al abrirse (sin filtros, tal cual las piden). */
export function dashboardPaths(projectId: string): string[] {
  return [
    `/projects/${projectId}`,
    `/projects/${projectId}/dashboard/status`,
    `/projects/${projectId}/dashboard/analysis`,
    `/projects/${projectId}/dashboard/bankroll-chart`,
    `/projects/${projectId}/bets`,
  ];
}

/**
 * Se llama una vez, al arrancar. La sesión (`/auth/me`) la adelanta `index.html` con un `preload`; aquí se
 * adelanta lo que depende de la URL: el proyecto y, si es el Dashboard, sus datos y su código.
 * Devuelve el identificador del proyecto cuando la URL es la del Dashboard (para precargar su código).
 */
export function startEarlyLoads(pathname: string): { dashboardOf: string | null } {
  const match = /^\/projects\/([\w-]{8,64})\/?$/.exec(pathname);
  if (!match?.[1] || !hasSessionHint()) return { dashboardOf: null };
  for (const path of dashboardPaths(match[1])) start(path);
  return { dashboardOf: match[1] };
}
