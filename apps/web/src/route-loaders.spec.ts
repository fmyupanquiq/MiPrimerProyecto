import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cada pantalla diferida se sustituye por un módulo vacío que cuenta cuántas veces se importó.
const loads = vi.hoisted((): { counts: Record<string, number> } => ({ counts: {} }));
const count = (name: string) => {
  loads.counts[name] = (loads.counts[name] ?? 0) + 1;
  return {};
};
vi.mock('./pages/project/DashboardPage.js', () => count('dashboard'));
vi.mock('./pages/project/BetsPage.js', () => count('bets'));
vi.mock('./pages/project/ReportsPage.js', () => count('reports'));
vi.mock('./pages/project/FinancePage.js', () => count('finance'));
vi.mock('./pages/project/StagesPage.js', () => count('stages'));
vi.mock('./pages/project/ReturnsPage.js', () => count('returns'));
vi.mock('./pages/project/MembersPage.js', () => count('members'));

type Loaders = typeof import('./route-loaders.js');
/** Módulo recién cargado: `prefetchRoute` recuerda lo ya pedido a nivel de módulo. */
async function fresh(): Promise<Loaders> {
  vi.resetModules();
  return import('./route-loaders.js');
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  loads.counts = {};
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('prefetchRoute', () => {
  it('adelanta la pantalla de una sección de uso diario, una sola vez', async () => {
    const { prefetchRoute } = await fresh();
    prefetchRoute('/projects/abc/bets');
    prefetchRoute('/projects/abc/bets');
    prefetchRoute('/projects/otro/bets?status=WON');
    await flush();
    expect(loads.counts).toEqual({ bets: 1 });
  });

  it('el Dashboard es la ruta sin sufijo (con o sin barra, consulta o ancla)', async () => {
    const { prefetchRoute } = await fresh();
    prefetchRoute('/projects/abc?desde=2026-01-01');
    await flush();
    expect(loads.counts).toEqual({ dashboard: 1 });
  });

  it('no descarga nada para rutas fuera de la lista ni para enlaces que no son de proyecto', async () => {
    const { prefetchRoute } = await fresh();
    for (const path of [
      '/',
      '/admin',
      '/account',
      '/projects/trash',
      '/projects/abc/members',
      '',
    ]) {
      prefetchRoute(path);
    }
    await flush();
    expect(loads.counts).toEqual({});
  });
});

describe('prefetchCommonRoutesWhenIdle', () => {
  it('espera unos segundos y luego adelanta Apuestas, Reportes y Finanzas de una en una', async () => {
    vi.useFakeTimers();
    const { prefetchCommonRoutesWhenIdle } = await fresh();
    const prefetch = vi.fn<(path: string) => void>();
    prefetchCommonRoutesWhenIdle('/projects/abc', prefetch);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(prefetch).not.toHaveBeenCalled(); // la carga inicial va primero

    await vi.advanceTimersByTimeAsync(1_501);
    expect(prefetch.mock.calls).toEqual([['/projects/abc/bets']]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(prefetch.mock.calls).toEqual([['/projects/abc/bets'], ['/projects/abc/reports']]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(prefetch.mock.calls.map(([path]) => path)).toEqual([
      '/projects/abc/bets',
      '/projects/abc/reports',
      '/projects/abc/finance',
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(prefetch).toHaveBeenCalledTimes(3); // no hay nada más que adelantar
  });

  it('con «ahorro de datos» activado no descarga nada por adelantado', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
    const { prefetchCommonRoutesWhenIdle } = await fresh();
    const prefetch = vi.fn<(path: string) => void>();
    prefetchCommonRoutesWhenIdle('/projects/abc', prefetch);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(prefetch).not.toHaveBeenCalled();
  });
});
