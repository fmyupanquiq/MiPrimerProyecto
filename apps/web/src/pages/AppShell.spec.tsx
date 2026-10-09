import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STATE,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  type Handler,
} from '../test-utils.js';
import { getDisplayTimeZone } from '../time-zone.js';

// Las páginas con gráficos se cargan de forma diferida (`lazy`): se precargan para que la primera
// prueba no dependa del tiempo de transformación del módulo.
beforeAll(async () => {
  await import('./project/DashboardPage.js');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** Simula `window.matchMedia` para un ancho angosto (QA responsiva, Fase 11, §8). */
function stubNarrowViewport() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('max-width: 639px'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const URL = `/projects/${PROJECT_ID}`;
const READER = [
  'project.view',
  'members.view',
  'stages.view',
  'houses.view',
  'movements.view',
  'bets.view',
];

function open(project: Record<string, unknown> = {}, extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail(project) },
    [`GET ${URL}/dashboard/status`]: { status: 404, body: {} },
    [`GET ${URL}/dashboard/analysis`]: { status: 404, body: {} },
    [`GET ${URL}/dashboard/bankroll-chart`]: { status: 404, body: {} },
    [`GET ${URL}/bets`]: { status: 200, body: [] },
    ...extra,
  });
}

const projectNav = () => screen.findByRole('navigation', { name: 'Proyecto' });
const linkNames = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('marco de la aplicación: barra lateral y barra superior (Fase 10.3)', () => {
  it('la barra lateral muestra la navegación principal y todo el proyecto para el propietario', async () => {
    open();
    renderApp(URL);
    const main = await screen.findByRole('navigation', { name: 'Principal' });
    expect(linkNames(main)).toEqual(['Mis proyectos', 'Proyectos eliminados']);
    // Agrupación lógica (Fase 11, §5): Apuestas/Retornos/Reportes, Finanzas, y lo administrativo
    // del proyecto, en vez de 9 enlaces sueltos sin jerarquía.
    expect(linkNames(await projectNav())).toEqual([
      'Dashboard',
      'Apuestas',
      'Retornos',
      'Reportes',
      'Casas y Finanzas',
      'Etapas',
      'Importaciones',
      'Miembros',
      'Eliminados',
      'Auditoría',
      'Configuración',
    ]);
    const reports = within(await projectNav()).getByRole('link', { name: 'Reportes' });
    expect(reports.getAttribute('href')).toBe(`${URL}/reports`);
  });

  it('respeta los permisos: un Lector no ve Importaciones, Eliminados ni Auditoría', async () => {
    open({ isOwner: false, myRole: 'READER', myPermissions: READER });
    renderApp(URL);
    const names = linkNames(await projectNav());
    expect(names).toContain('Reportes');
    expect(names).not.toContain('Importaciones');
    expect(names).not.toContain('Eliminados');
    expect(names).not.toContain('Auditoría');
  });

  it('marca la sección activa', async () => {
    open();
    renderApp(URL);
    const nav = await projectNav();
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Apuestas' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('muestra el proyecto actual al pie de la barra lateral', async () => {
    open();
    renderApp(URL);
    await projectNav();
    const sidebar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(sidebar).getByText('Proyecto actual')).toBeTruthy();
    expect(within(sidebar).getByRole('link', { name: 'Grupo Norte' }).getAttribute('href')).toBe(
      URL,
    );
    expect(
      within(sidebar).getByRole('link', { name: 'Cambiar de proyecto' }).getAttribute('href'),
    ).toBe('/');
  });

  it('la barra superior muestra proyecto, estado, etapa, rol y la persona usuaria', async () => {
    open();
    renderApp(URL);
    const banner = await screen.findByRole('banner');
    expect(await within(banner).findByRole('heading', { name: 'Grupo Norte' })).toBeTruthy();
    expect(within(banner).getByText('Activo')).toBeTruthy();
    expect(within(banner).getByText('Etapa: Etapa 1')).toBeTruthy();
    expect(
      within(banner).getByText(/Tu rol: Propietario · Administrador de proyecto/),
    ).toBeTruthy();
    const account = within(banner).getByRole('link', { name: /Ana Pérez/ });
    expect(account.getAttribute('href')).toBe('/account');
    expect(account.textContent).toContain('AP');
    expect(within(banner).getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
  });

  it('fuera de un proyecto la barra lateral no muestra navegación de proyecto', async () => {
    open();
    renderApp('/');
    await screen.findByRole('navigation', { name: 'Principal' });
    expect(screen.queryByRole('navigation', { name: 'Proyecto' })).toBeNull();
    expect(screen.queryByText('Proyecto actual')).toBeNull();
  });

  it('en móvil, el menú abre el cajón y se cierra con Escape, el fondo o al navegar', async () => {
    open();
    renderApp(URL);
    await projectNav();
    const toggle = screen.getByRole('button', { name: 'Abrir menú' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('app-sidebar');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    // El fondo oscuro y el botón del cajón comparten nombre: cualquiera de los dos lo cierra.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar menú' })[0]!);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    fireEvent.click(within(await projectNav()).getByRole('link', { name: 'Miembros' }));
    expect(screen.getByRole('button', { name: 'Abrir menú' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('el selector de tema (Oscuro, Claro, Sistema) cambia el tema al instante', async () => {
    open();
    renderApp(URL);
    const group = await screen.findByRole('radiogroup', { name: 'Tema' });
    const option = (name: string) => within(group).getByRole('radio', { name });
    expect(option('Oscuro').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(option('Claro'));
    expect(option('Claro').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(option('Oscuro'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('por debajo de 640px, el tema vive en el cajón en vez de la barra superior (QA responsiva, §8)', async () => {
    stubNarrowViewport();
    open();
    renderApp(URL);
    await projectNav();
    // Un único control (nunca los dos a la vez): vive dentro de la barra lateral/cajón, no en
    // `<header>` — así ya no compite por espacio con el nombre del proyecto en la barra superior.
    const groups = screen.getAllByRole('radiogroup', { name: 'Tema' });
    expect(groups).toHaveLength(1);
    const sidebar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(sidebar).getByRole('radiogroup', { name: 'Tema' })).toBeTruthy();
    expect(screen.getByRole('banner').querySelector('[role="radiogroup"]')).toBeNull();
  });

  it('dentro de un proyecto las fechas usan su zona; fuera, la del navegador', async () => {
    open({ timezone: 'Asia/Tokyo' });
    renderApp(URL);
    await screen.findByRole('navigation', { name: 'Proyecto' });
    expect(getDisplayTimeZone()).toBe('Asia/Tokyo');
    fireEvent.click(screen.getByRole('link', { name: 'Mis proyectos' }));
    await screen.findByRole('heading', { name: 'Mis proyectos' });
    expect(getDisplayTimeZone()).toBeUndefined();
  });
});
