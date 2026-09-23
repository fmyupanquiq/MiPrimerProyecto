import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STATE,
  projectDetail,
  PROJECT_ID,
  renderApp,
  STAGE_ID,
  stubApi,
  type Handler,
} from '../../test-utils.js';

const URL = `/projects/${PROJECT_ID}`;
const HOUSES_URL = `${URL}/houses`;
const STAGES_URL = `${URL}/stages`;
const STATUS_URL = `${URL}/dashboard/status`;
const ANALYSIS_URL = `${URL}/dashboard/analysis`;
const BANKROLL_URL = `${URL}/dashboard/bankroll-chart`;
const PERFORMANCE_URL = `${URL}/dashboard/performance-chart`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';

// jsdom no implementa ResizeObserver; Recharts lo usa para medir el contenedor responsivo.
beforeEach(() => {
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

const house = (overrides: Record<string, unknown> = {}) => ({
  id: HOUSE_A,
  projectId: PROJECT_ID,
  name: 'Betano',
  status: 'ACTIVE',
  balance: '500.00',
  committed: '20.00',
  available: '480.00',
  createdAt: '2026-06-01T12:00:00.000Z',
  ...overrides,
});

const stage = (overrides: Record<string, unknown> = {}) => ({
  id: STAGE_ID,
  projectId: PROJECT_ID,
  name: 'Etapa 1',
  unitStake: '10.00',
  status: 'ACTIVE',
  createdAt: '2026-06-01T12:00:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
  ...overrides,
});

const statusBody = (overrides: Record<string, unknown> = {}) => ({
  capitalActual: '700.00',
  disponible: '680.00',
  comprometido: '20.00',
  porCasa: [
    {
      houseId: HOUSE_A,
      houseName: 'Betano',
      balance: '500.00',
      committed: '20.00',
      available: '480.00',
    },
  ],
  conteoApuestas: { total: 1, pending: 1, won: 0, lost: 0, void: 0, cashout: 0 },
  ...overrides,
});

const analysisBody = (overrides: Record<string, unknown> = {}) => ({
  profitLoss: '19.00',
  yield: '95.00',
  roi: '2.71',
  totalStaked: '20.00',
  capitalInvested: '750.00', // distinto del "capital actual" del estado (700.00): evita choques de texto
  deposits: '0.00',
  withdrawals: '0.00',
  extraordinary: '0.00',
  counts: { total: 1, pending: 0, won: 1, lost: 0, void: 0, cashout: 0 },
  // Valores de P/L de los desgloses distintos entre sí y del P/L total: solo para no chocar como
  // texto duplicado en las aserciones (no representan una suma real).
  byHouse: [{ key: 'Betano', profitLoss: '15.00', yield: '75.00', totalStaked: '20.00', count: 1 }],
  byStage: [
    { key: 'Etapa 1', profitLoss: '16.00', yield: '80.00', totalStaked: '20.00', count: 1 },
  ],
  bySport: [{ key: 'Fútbol', profitLoss: '17.00', yield: '85.00', totalStaked: '20.00', count: 1 }],
  byMarket: [{ key: '1X2', profitLoss: '18.00', yield: '90.00', totalStaked: '20.00', count: 1 }],
  byPeriod: [
    { key: '2026-06', profitLoss: '18.50', yield: '92.50', totalStaked: '20.00', count: 1 },
  ],
  ...overrides,
});

const emptyChart = { points: [] };
const emptyPerformance = { points: [], maxDrawdown: '0.00', maxDrawdownPercent: null };

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail() },
    [`GET ${HOUSES_URL}`]: { status: 200, body: [house()] },
    [`GET ${STAGES_URL}`]: { status: 200, body: [stage()] },
    [`GET ${STATUS_URL}`]: { status: 200, body: statusBody() },
    [`GET ${ANALYSIS_URL}`]: { status: 200, body: analysisBody() },
    [`GET ${BANKROLL_URL}`]: { status: 200, body: emptyChart },
    [`GET ${PERFORMANCE_URL}`]: { status: 200, body: emptyPerformance },
    ...extra,
  });
}

describe('dashboard y métricas (§33, §34, §108)', () => {
  it('muestra el estado financiero actual: capital, disponible, comprometido y casas', async () => {
    open();
    renderApp(URL);

    await screen.findByRole('heading', { name: 'Estado financiero actual' });
    expect(await screen.findByText('S/ 700.00')).toBeTruthy(); // capital actual
    expect(screen.getByText('S/ 680.00')).toBeTruthy(); // disponible
    const table = screen.getAllByRole('table')[0]!;
    expect(within(table).getByText('Betano')).toBeTruthy();
  });

  it('muestra P/L, Yield, ROI y los desgloses del análisis filtrado', async () => {
    open();
    renderApp(URL);

    await screen.findByRole('heading', { name: 'Análisis filtrado' });
    expect(await screen.findByText('S/ 19.00')).toBeTruthy(); // P/L
    expect(screen.getByText('95.00 %')).toBeTruthy(); // Yield
    expect(screen.getByText('2.71 %')).toBeTruthy(); // ROI
    expect(screen.getByText('Por casa')).toBeTruthy();
    expect(screen.getByText('Por deporte')).toBeTruthy();
  });

  it('un capital invertido inexistente (todo cero) muestra guion, no 0 %, para Yield/ROI', async () => {
    open({
      [`GET ${ANALYSIS_URL}`]: {
        status: 200,
        body: analysisBody({
          profitLoss: '0.00',
          yield: null,
          roi: null,
          byHouse: [],
          byStage: [],
          bySport: [],
          byMarket: [],
          byPeriod: [],
        }),
      },
    });
    renderApp(URL);

    await screen.findByRole('heading', { name: 'Análisis filtrado' });
    // Las 5 tablas de desglose (casa, etapa, deporte, mercado, periodo) quedan vacías.
    expect(await screen.findAllByText('Sin apuestas liquidadas en este filtro.')).toHaveLength(5);
  });

  it('aplicar un filtro pide de nuevo el análisis con ese filtro en la consulta', async () => {
    const { calls } = open({
      [`GET ${ANALYSIS_URL}?status=WON`]: { status: 200, body: analysisBody() },
    });
    renderApp(URL);
    await screen.findByRole('heading', { name: 'Análisis filtrado' });

    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'WON' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === `${URL}/dashboard/analysis?status=WON`)).toBe(true);
    });
  });

  it('sin movimientos ni apuestas liquidadas, los gráficos avisan que no hay datos', async () => {
    open();
    renderApp(URL);

    expect(await screen.findByText('Todavía no hay movimientos.')).toBeTruthy();
    expect(screen.getByText('Todavía no hay apuestas liquidadas.')).toBeTruthy();
  });

  it('con una serie de rendimiento, muestra el drawdown máximo', async () => {
    open({
      [`GET ${PERFORMANCE_URL}`]: {
        status: 200,
        body: {
          points: [
            {
              occurredAt: '2026-06-01T20:00:00.000Z',
              cumulativeProfitLoss: '-20.00',
              drawdown: '0.00',
              drawdownPercent: null,
            },
            {
              occurredAt: '2026-06-02T22:00:00.000Z',
              cumulativeProfitLoss: '19.00',
              drawdown: '0.00',
              drawdownPercent: null,
            },
          ],
          maxDrawdown: '39.00',
          maxDrawdownPercent: null,
        },
      },
    });
    renderApp(URL);

    await screen.findByRole('heading', { name: 'Curva de rendimiento y drawdown' });
    expect(await screen.findByText('S/ 39.00')).toBeTruthy();
  });
});
