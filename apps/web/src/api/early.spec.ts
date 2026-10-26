/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client.js';
import { dashboardPaths, rememberSession, startEarlyLoads, takeEarly } from './early.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** `fetch` simulado: responde `{ url }` a cada llamada y recuerda las URLs pedidas. */
function stubFetch(handler: (url: string) => Response = (url) => json({ url })) {
  const fn = vi.fn((url: string) => Promise.resolve(handler(url)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

let counter = 0;
/** Identificador de proyecto nuevo por prueba: el registro de peticiones adelantadas es del módulo. */
const nextProjectId = () => `proyecto-${String(++counter).padStart(8, '0')}`;

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startEarlyLoads (peticiones adelantadas del Dashboard)', () => {
  it('sin marca de sesión no adelanta nada (no hay ruido de 401 para quien no ha iniciado sesión)', () => {
    const fetchMock = stubFetch();
    const id = nextProjectId();
    expect(startEarlyLoads(`/projects/${id}`)).toEqual({ dashboardOf: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('solo adelanta en la ruta exacta del Dashboard', () => {
    rememberSession(true);
    const fetchMock = stubFetch();
    const id = nextProjectId();
    for (const path of [
      '/login',
      '/',
      '/projects/trash',
      `/projects/${id}/bets`,
      `/projects/${id}/reports`,
      `/admin/projects/${id}`,
    ]) {
      expect(startEarlyLoads(path)).toEqual({ dashboardOf: null });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con sesión y en el Dashboard pide a la vez el proyecto y los datos de las tarjetas', () => {
    rememberSession(true);
    const fetchMock = stubFetch();
    const id = nextProjectId();
    expect(startEarlyLoads(`/projects/${id}`)).toEqual({ dashboardOf: id });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
      dashboardPaths(id).map((path) => `/api${path}`),
    );
    // Todas salen antes de que ninguna responda: son paralelas, no encadenadas.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('acepta la barra final y no repite la misma petición si se llama dos veces', () => {
    rememberSession(true);
    const fetchMock = stubFetch();
    const id = nextProjectId();
    startEarlyLoads(`/projects/${id}/`);
    startEarlyLoads(`/projects/${id}`);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe('apiFetch recoge lo adelantado', () => {
  it('entrega el resultado adelantado SIN pedirlo otra vez, y solo una vez', async () => {
    rememberSession(true);
    const fetchMock = stubFetch();
    const id = nextProjectId();
    startEarlyLoads(`/projects/${id}`);
    const statusPath = `/projects/${id}/dashboard/status`;

    await expect(apiFetch<{ url: string }>(statusPath)).resolves.toEqual({
      url: `/api${statusPath}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5); // ninguna petición nueva

    // Un segundo GET igual (p. ej. «Reintentar») va a la red: nunca se reutilizan datos viejos.
    await apiFetch(statusPath);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('un resultado adelantado caduca a los 15 s: se pide de nuevo', async () => {
    vi.useFakeTimers();
    rememberSession(true);
    const fetchMock = stubFetch();
    const id = nextProjectId();
    startEarlyLoads(`/projects/${id}`);
    vi.advanceTimersByTime(15_001);
    await apiFetch(`/projects/${id}/bets`);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('solo sustituye GET sin cuerpo: un POST o un GET con otra ruta van siempre a la red', async () => {
    rememberSession(true);
    const fetchMock = stubFetch();
    const id = nextProjectId();
    startEarlyLoads(`/projects/${id}`);
    await apiFetch(`/projects/${id}/bets`, { method: 'POST', body: { a: 1 } });
    await apiFetch(`/projects/${id}/bets?status=PENDING`);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    // Lo adelantado sigue disponible para quien sí lo pide tal cual.
    expect(takeEarly(`/projects/${id}/bets`)).not.toBeNull();
  });

  it('nunca entrega lo adelantado de un proyecto al pedir otro, ni con la misma ruta de otro proyecto', async () => {
    rememberSession(true);
    const fetchMock = stubFetch();
    const idA = nextProjectId();
    const idB = nextProjectId();
    startEarlyLoads(`/projects/${idA}`);
    const body = await apiFetch<{ url: string }>(`/projects/${idB}/dashboard/status`);
    expect(body.url).toBe(`/api/projects/${idB}/dashboard/status`); // fue a la red, con el id de B
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(takeEarly(`/projects/${idA}/dashboard/status`)).not.toBeNull(); // lo de A sigue siendo de A
  });

  it('un error adelantado llega igual que uno normal (ApiError con su código)', async () => {
    rememberSession(true);
    stubFetch(() =>
      json(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Se requiere iniciar sesión.' },
        401,
      ),
    );
    const id = nextProjectId();
    startEarlyLoads(`/projects/${id}`);
    const error = await apiFetch(`/projects/${id}`).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
  });

  it('un fallo de red adelantado que nadie recoge no queda como error no gestionado', async () => {
    rememberSession(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    startEarlyLoads(`/projects/${nextProjectId()}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('rememberSession', () => {
  it('guarda y borra la marca; sin almacenamiento disponible no lanza', () => {
    rememberSession(true);
    expect(window.localStorage.getItem('letfer.session')).toBe('1');
    rememberSession(false);
    expect(window.localStorage.getItem('letfer.session')).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => rememberSession(true)).not.toThrow();
    vi.restoreAllMocks();
  });
});
