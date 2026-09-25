import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STATE,
  OWNER_PERMISSIONS,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  type Handler,
} from '../../test-utils.js';

beforeEach(() => {
  // jsdom no implementa ResizeObserver; Recharts lo usa para medir el contenedor responsivo.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';

const emptyChart = { points: [] };
const emptyPerformance = { points: [], maxDrawdown: '0.00', maxDrawdownPercent: null };

const status = (retornosPorConfirmar: number) => ({
  retornosPorConfirmar,
  capitalActual: '538.00',
  disponible: '538.00',
  comprometido: '0.00',
  porCasa: [],
  conteoApuestas: { total: 2, pending: 0, won: 2, lost: 0, void: 0, cashout: 0 },
});

const analysis = (unconfirmed: { count: number; profitLoss: string }) => ({
  profitLoss: '38.00',
  yield: '95.00',
  roi: '7.60',
  totalStaked: '40.00',
  unconfirmedReturns: unconfirmed,
  capitalInvested: '500.00',
  deposits: '0.00',
  withdrawals: '0.00',
  extraordinary: '0.00',
  counts: { total: 2, pending: 0, won: 2, lost: 0, void: 0, cashout: 0 },
  byHouse: [],
  byStage: [],
  bySport: [],
  byMarket: [],
  byPeriod: [],
});

function openDashboard(
  retornos: number,
  unconfirmed: { count: number; profitLoss: string },
  permissions: string[] = OWNER_PERMISSIONS,
) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail({ myPermissions: permissions }) },
    [`GET ${URL}/houses`]: { status: 200, body: [] },
    [`GET ${URL}/stages`]: { status: 200, body: [] },
    [`GET ${URL}/dashboard/status`]: { status: 200, body: status(retornos) },
    [`GET ${URL}/dashboard/analysis`]: { status: 200, body: analysis(unconfirmed) },
    [`GET ${URL}/dashboard/bankroll-chart`]: { status: 200, body: emptyChart },
    [`GET ${URL}/dashboard/performance-chart`]: { status: 200, body: emptyPerformance },
  });
}

describe('aviso de retornos no confirmados en el dashboard (D-A6, §112.6)', () => {
  it('avisa, en el estado y en el análisis, de las ganadas con retorno solo calculado', async () => {
    openDashboard(2, { count: 2, profitLoss: '38.00' });
    renderApp(URL);
    const alerts = await screen.findAllByText(/con retorno calculado/);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Hay 2 apuestas ganadas con retorno calculado, sin confirmar/),
    ).toBeTruthy();
    expect(screen.getByText(/Ya cuentan en la ganancia, el Yield y el ROI/)).toBeTruthy();
    expect(screen.getByText(/ganancia provisional de S\/ 38\.00/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Ver retornos por confirmar' });
    expect(link.getAttribute('href')).toBe(`${URL}/returns`);
  });

  it('con una sola apuesta usa el singular', async () => {
    openDashboard(1, { count: 1, profitLoss: '19.00' });
    renderApp(URL);
    expect(
      await screen.findByText(/Hay 1 apuesta ganada con retorno calculado, sin confirmar/),
    ).toBeTruthy();
  });

  it('sin retornos provisionales no muestra ningún aviso', async () => {
    openDashboard(0, { count: 0, profitLoss: '0.00' });
    renderApp(URL);
    await screen.findByText('Estado financiero actual');
    expect(screen.queryByText(/con retorno calculado/)).toBeNull();
  });
});

const pendingItem = {
  betId: 'b1',
  houseName: 'Betano',
  stageName: 'Etapa 1',
  settledAt: '2026-06-01T22:00:00.000Z',
  effectiveAmount: '20.00',
  calculatedRealizedReturn: '39.00',
  provisionalProfit: '19.00',
};

const differences = {
  compared: 3,
  differing: 2,
  totalDelta: '-0.48',
  byHouse: [
    { houseId: HOUSE_A, houseName: 'Betano', compared: 3, differing: 2, totalDelta: '-0.48' },
  ],
  items: [
    {
      betId: 'b2',
      houseId: HOUSE_A,
      houseName: 'Betano',
      betType: 'SIMPLE',
      settledAt: '2026-06-01T22:00:00.000Z',
      effectiveAmount: '20.00',
      visibleTotalOdds: '1.950000',
      calculatedRealizedReturn: '39.00',
      officialRealizedReturn: '38.50',
      delta: '-0.50',
    },
  ],
};

function openReturns(extra: Record<string, Handler> = {}, permissions = OWNER_PERMISSIONS) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail({ myPermissions: permissions }) },
    [`GET ${URL}/bets/unconfirmed-returns`]: { status: 200, body: [pendingItem] },
    [`GET ${URL}/bets/return-differences`]: { status: 200, body: differences },
    ...extra,
  });
}

describe('retornos calculados y oficiales (§77, §112.2)', () => {
  it('lista los retornos por confirmar y compara calculado y oficial', async () => {
    openReturns();
    renderApp(`${URL}/returns`);

    const pending = await screen.findByRole('table', { name: 'Retornos por confirmar' });
    expect(within(pending).getByText('Betano')).toBeTruthy();
    expect(within(pending).getByText('S/ 39.00')).toBeTruthy();
    expect(within(pending).getByText('S/ 19.00')).toBeTruthy();

    expect(await screen.findByText('Ganadas comparadas')).toBeTruthy();
    const byHouse = screen.getByRole('table', { name: 'Diferencias por casa' });
    expect(within(byHouse).getByText('Betano')).toBeTruthy();
    const items = screen.getByRole('table', { name: 'Apuestas con diferencia' });
    expect(within(items).getByText('S/ 38.50')).toBeTruthy();
    expect(within(items).getByText('1.950000')).toBeTruthy();
    expect(screen.getByText(/no cambia ningún dato/)).toBeTruthy();
  });

  it('sin datos, lo dice con claridad', async () => {
    openReturns({
      [`GET ${URL}/bets/unconfirmed-returns`]: { status: 200, body: [] },
      [`GET ${URL}/bets/return-differences`]: {
        status: 200,
        body: { compared: 0, differing: 0, totalDelta: '0.00', byHouse: [], items: [] },
      },
    });
    renderApp(`${URL}/returns`);
    expect(await screen.findByText('No hay retornos pendientes de confirmar.')).toBeTruthy();
    expect(
      await screen.findByText(/Todavía no hay ganadas con retorno calculado y oficial/),
    ).toBeTruthy();
  });

  it('la pestaña Retornos aparece para quien puede ver apuestas', async () => {
    openReturns();
    renderApp(`${URL}/returns`);
    const nav = await screen.findByRole('navigation', { name: 'Proyecto' });
    expect(within(nav).getByRole('link', { name: 'Retornos' })).toBeTruthy();
  });
});

describe('restaurar una apuesta liquidada desde la papelera del proyecto (D-A11)', () => {
  const settledBet = {
    kind: 'BET',
    id: 'b1',
    label: 'Real vs. Barça — Real gana',
    detail: 'Casa Uno · stake 2.0000',
    deletedAt: '2026-04-01T00:00:00.000Z',
    deletedBy: { id: 'u1', name: 'Olga Pérez' },
    deletionReason: 'Registrada por error',
    purgeEligibleAt: '2026-06-30T00:00:00.000Z',
    purgeEligible: false,
    settled: true,
  };

  it('pide motivo y avisa que vuelve a registrar el ledger', async () => {
    const { calls } = stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      [`GET ${URL}`]: { status: 200, body: projectDetail() },
      [`GET ${URL}/trash`]: { status: 200, body: [settledBet] },
      [`POST ${URL}/bets/b1/restore`]: { status: 200, body: { id: 'b1' } },
    });
    renderApp(`${URL}/trash`);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restaurar Real vs. Barça — Real gana' }),
    );
    const form = await screen.findByRole('form', { name: 'Restaurar Real vs. Barça — Real gana' });
    expect(within(form).getByText(/vuelve a registrar su efecto en el ledger/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Restaurar apuesta' }));
    expect(await within(form).findByText('Indica el motivo.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(within(form).getByLabelText(/Motivo/), { target: { value: 'Era correcta' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Restaurar apuesta' }));
    expect(
      await screen.findByText('«Real vs. Barça — Real gana» se restauró correctamente.'),
    ).toBeTruthy();
    expect(calls.find((c) => c.path === `${URL}/bets/b1/restore`)!.body).toEqual({
      reason: 'Era correcta',
    });
  });

  it('quien no puede corregir liquidadas no ve el botón para restaurarla', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          myPermissions: OWNER_PERMISSIONS.filter((p) => p !== 'bets.correct'),
        }),
      },
      [`GET ${URL}/trash`]: { status: 200, body: [settledBet] },
    });
    renderApp(`${URL}/trash`);
    await screen.findByText('Real vs. Barça — Real gana');
    expect(screen.queryByRole('button', { name: /Restaurar Real vs\. Barça/ })).toBeNull();
  });
});
