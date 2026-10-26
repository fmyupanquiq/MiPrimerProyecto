import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STATE, renderApp, stubApi, UNAUTHENTICATED } from '../test-utils.js';
import { dashboardPaths, rememberSession, startEarlyLoads, takeEarly } from './early.js';

/**
 * Lo adelantado nunca debe sobrevivir a un cambio de sesión: se pidió con la sesión de una persona y no
 * puede entregarse a otra, ni aunque pase muy poco tiempo (caduca a los 15 s).
 */
let counter = 0;
const nextProjectId = () => `sesion-${String(++counter).padStart(8, '0')}`;
const empty = { status: 200, body: {} };
const earlyRoutes = (id: string) =>
  Object.fromEntries(dashboardPaths(id).map((path) => [`GET ${path}`, empty]));

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('lo adelantado y los cambios de sesión', () => {
  it('cerrar sesión descarta lo adelantado (otra persona no puede recibirlo)', async () => {
    const id = nextProjectId();
    rememberSession(true);
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      'POST /auth/logout': { status: 204 },
      ...earlyRoutes(id),
    });
    startEarlyLoads(`/projects/${id}`);
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    for (const path of dashboardPaths(id)) expect(takeEarly(path), path).toBeNull();
  });

  it('iniciar sesión descarta lo que hubiera quedado de una sesión anterior', async () => {
    const id = nextProjectId();
    stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/login': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      ...earlyRoutes(id),
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    // Residuo de una sesión anterior (p. ej. cerrada sin pasar por «Cerrar sesión»).
    rememberSession(true);
    startEarlyLoads(`/projects/${id}`);

    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'otra@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'otra-clave-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByText('Ana Pérez');

    for (const path of dashboardPaths(id)) expect(takeEarly(path), path).toBeNull();
  });

  it('si la sesión no es válida (401) se descarta lo adelantado y no se muestra nada del proyecto', async () => {
    const id = nextProjectId();
    rememberSession(true);
    const { calls } = stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      ...earlyRoutes(id),
    });
    startEarlyLoads(`/projects/${id}`);
    renderApp(`/projects/${id}`);

    // Sin sesión se redirige al inicio de sesión: ninguna pantalla del proyecto llega a pintarse.
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
    expect(screen.queryByText('Dashboard')).toBeNull();
    for (const path of dashboardPaths(id)) expect(takeEarly(path), path).toBeNull();
    // La marca de sesión se retira: la próxima visita no adelantará nada.
    expect(window.localStorage.getItem('letfer.session')).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
  });
});
