import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
  apiError,
  AUTH_STATE,
  projectDetail,
  PROJECT_ID,
  renderApp,
  STAGE_ID,
  stubApi,
  type Handler,
} from '../../test-utils.js';

// Las páginas con gráficos se cargan de forma diferida (`lazy`): se precargan para que la primera
// prueba no dependa del tiempo de transformación del módulo.
beforeAll(async () => {
  await import('./DashboardPage.js');
});

const URL = `/projects/${PROJECT_ID}`;
const STATUS_URL = `${URL}/dashboard/status`;
const ANALYSIS_URL = `${URL}/dashboard/analysis`;
const BANKROLL_URL = `${URL}/dashboard/bankroll-chart`;
const BETS_URL = `${URL}/bets`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const HOUSE_B = '0195f7c0-0000-7000-8000-0000000000a2';
const DAY = 24 * 60 * 60 * 1000;

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

const statusBody = (overrides: Record<string, unknown> = {}) => ({
  retornosPorConfirmar: 0,
  capitalActual: '700.00',
  disponible: '680.00',
  comprometido: '20.00',
  porCasa: [
    {
      houseId: HOUSE_A,
      houseName: 'Betano',
      balance: '200.00',
      committed: '20.00',
      available: '180.00',
    },
    {
      houseId: HOUSE_B,
      houseName: 'Betsafe',
      balance: '500.00',
      committed: '0.00',
      available: '500.00',
    },
  ],
  conteoApuestas: { total: 5, pending: 1, won: 3, lost: 1, void: 0, cashout: 0 },
  ...overrides,
});

const analysisBody = (overrides: Record<string, unknown> = {}) => ({
  profitLoss: '19.00',
  yield: '95.00',
  roi: '2.71',
  totalStaked: '20.00',
  unconfirmedReturns: { count: 0, profitLoss: '0.00' },
  capitalInvested: '750.00',
  deposits: '0.00',
  withdrawals: '0.00',
  extraordinary: '0.00',
  counts: { total: 5, pending: 1, won: 3, lost: 1, void: 0, cashout: 0 },
  byHouse: [],
  byStage: [],
  bySport: [
    { key: 'Fútbol', profitLoss: '17.00', yield: '85.00', totalStaked: '20.00', count: 3 },
    { key: 'Tenis', profitLoss: '2.00', yield: '10.00', totalStaked: '20.00', count: 1 },
  ],
  byMarket: [],
  byPeriod: [],
  ...overrides,
});

const point = (daysAgo: number, balance: string, stageStarted: unknown = null) => ({
  occurredAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
  balance,
  stageStarted,
});

const bankrollBody = {
  points: [point(100, '500.00', { id: STAGE_ID, name: 'Etapa 1' }), point(2, '700.00')],
};

let betCounter = 0;
const bet = (overrides: Record<string, unknown> = {}) => ({
  id: `0195f7c0-0000-7000-8000-00000000${String(++betCounter).padStart(4, '0')}`,
  projectId: PROJECT_ID,
  batchId: null,
  batchStatus: null,
  stageId: STAGE_ID,
  stageName: 'Etapa 1',
  houseId: HOUSE_A,
  houseName: 'Betano',
  betType: 'SIMPLE',
  stake: '2.0000',
  officialAmount: null,
  effectiveAmount: '20.00',
  amountSource: 'CALCULATED',
  visibleTotalOdds: '1.95',
  officialPotentialReturn: null,
  officialRealizedReturn: null,
  calculatedRealizedReturn: null,
  effectiveReturn: null,
  returnSource: null,
  effectiveOdds: null,
  profitLoss: null,
  status: 'PENDING',
  placedAt: '2026-06-01T20:00:00.000Z',
  placedTimeKnown: true,
  settledAt: null,
  settledTimeKnown: true,
  reason: null,
  createdBy: { id: ANA.id, name: 'Ana Pérez' },
  createdAt: '2026-06-01T20:05:00.000Z',
  updatedAt: '2026-06-01T20:05:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
  events: ['Arsenal vs Manchester City'],
  sports: ['Fútbol'],
  ticketCount: 0,
  ...overrides,
});

const betsBody = () => [
  bet({ events: ['Real Madrid vs Barcelona'], placedAt: '2026-06-03T20:00:00.000Z' }),
  bet({
    events: ['Nadal vs Alcaraz'],
    sports: ['Tenis'],
    status: 'WON',
    profitLoss: '19.00',
    effectiveReturn: '39.00',
    placedAt: '2026-06-02T20:00:00.000Z',
  }),
  bet({ events: ['Arsenal vs Manchester City'], placedAt: '2026-06-01T20:00:00.000Z' }),
];

function open(extra: Record<string, Handler> = {}, project: Record<string, unknown> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail(project) },
    [`GET ${STATUS_URL}`]: { status: 200, body: statusBody() },
    [`GET ${ANALYSIS_URL}`]: { status: 200, body: analysisBody() },
    [`GET ${BANKROLL_URL}`]: { status: 200, body: bankrollBody },
    [`GET ${BETS_URL}`]: { status: 200, body: betsBody() },
    ...extra,
  });
}

const section = async (title: string) =>
  (await screen.findByRole('heading', { name: title })).closest('section')!;
const kpi = (label: string) => screen.getByLabelText(label).textContent;
const READER = [
  'project.view',
  'members.view',
  'stages.view',
  'houses.view',
  'movements.view',
  'bets.view',
];

describe('dashboard: métricas y carga (Fase 10.3)', () => {
  it('muestra capital, disponible, comprometido y ganancia con su contexto real', async () => {
    open();
    renderApp(URL);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    await screen.findByLabelText('Capital actual');
    expect(kpi('Capital actual')).toBe('S/ 700.00');
    expect(kpi('Disponible')).toBe('S/ 680.00');
    expect(kpi('Comprometido')).toBe('S/ 20.00');
    expect(await screen.findByLabelText('Ganancia total')).toBeTruthy();
    expect(kpi('Ganancia total')).toBe('+S/ 19.00');
    expect(screen.getByText('Disponible + comprometido · 2 casas')).toBeTruthy();
    expect(screen.getByText(/1 apuesta pendiente/)).toBeTruthy();
    expect(screen.getByText('Yield 95.00 % · ROI 2.71 %')).toBeTruthy();
  });

  it('mientras llegan los datos muestra bloques de carga, nunca un 0 provisional', async () => {
    open();
    // El estado financiero no responde todavía.
    const stubbed = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      String(input).endsWith('/dashboard/status')
        ? new Promise<Response>(() => undefined)
        : stubbed(input, init),
    );
    renderApp(URL);
    expect(await screen.findByText('Cargando capital actual…')).toBeTruthy();
    expect(screen.queryByText('S/ 0.00')).toBeNull();
    expect(screen.queryByLabelText('Capital actual')).toBeNull();
  });

  it('si falla una sección, las demás siguen funcionando', async () => {
    open({ [`GET ${STATUS_URL}`]: apiError(500, 'INTERNAL_ERROR') });
    renderApp(URL);
    // Las tarjetas que dependen del estado avisan del error…
    const houses = await section('Casas de apuestas');
    expect(await within(houses).findByRole('alert')).toBeTruthy();
    const states = await section('Estado de apuestas');
    expect(within(states).getByRole('alert')).toBeTruthy();
    // …y el resto del dashboard se ve igual.
    const recent = await section('Apuestas recientes');
    expect(await within(recent).findByText('Real Madrid vs Barcelona')).toBeTruthy();
    expect(kpi('Ganancia total')).toBe('+S/ 19.00');
  });

  it('con la configuración inicial pendiente no pide métricas y lo explica', async () => {
    const { calls } = open({}, { setupComplete: false, activeStage: null });
    renderApp(URL);
    const steps = await screen.findByRole('list', { name: 'Primeros pasos' });
    expect(within(steps).getByText('Configurar etapa, casas y banca')).toBeTruthy();
    expect(calls.some((c) => c.path.includes('/dashboard/'))).toBe(false);
  });
});

describe('dashboard: evolución del capital', () => {
  it('muestra el capital actual y su variación real, y filtra la serie por periodo', async () => {
    open();
    renderApp(URL);
    const chart = await section('Evolución del capital');
    expect(await within(chart).findByText('S/ 700.00')).toBeTruthy();
    expect(within(chart).getByText(/\+S\/ 200\.00/)).toBeTruthy();
    expect(within(chart).getByText('desde el primer movimiento')).toBeTruthy();
    expect(
      within(chart).getByRole('img', { name: 'Gráfico de evolución del capital' }),
    ).toBeTruthy();

    // 7 días: la variación es contra el último saldo anterior al periodo (500 → 700).
    fireEvent.click(within(chart).getByRole('button', { name: '7 días' }));
    expect(within(chart).getByRole('button', { name: '7 días' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(chart).getByText('en el periodo')).toBeTruthy();
    expect(within(chart).getByText(/\+S\/ 200\.00/)).toBeTruthy();
  });

  it('un periodo sin movimientos lo dice y muestra el capital vigente, sin inventar puntos', async () => {
    open({
      [`GET ${BANKROLL_URL}`]: { status: 200, body: { points: [point(60, '700.00')] } },
    });
    renderApp(URL);
    const chart = await section('Evolución del capital');
    fireEvent.click(await within(chart).findByRole('button', { name: '7 días' }));
    expect(within(chart).getByText('Sin movimientos en este periodo')).toBeTruthy();
    expect(within(chart).getByText(/sigue en S\/ 700\.00/)).toBeTruthy();
    expect(
      within(chart).queryByRole('img', { name: 'Gráfico de evolución del capital' }),
    ).toBeNull();
  });

  it('sin movimientos muestra un estado vacío explicativo', async () => {
    open({ [`GET ${BANKROLL_URL}`]: { status: 200, body: { points: [] } } });
    renderApp(URL);
    const chart = await section('Evolución del capital');
    expect(await within(chart).findByText('Todavía no hay movimientos')).toBeTruthy();
    expect(within(chart).queryByRole('group', { name: 'Periodo del gráfico' })).toBeNull();
  });
});

describe('dashboard: estado de apuestas', () => {
  it('muestra el total, la cantidad y el porcentaje de cada estado', async () => {
    open();
    renderApp(URL);
    const card = await section('Estado de apuestas');
    expect((await within(card).findByLabelText('Total de apuestas')).textContent).toBe('5');
    const legend = within(card).getByRole('list', { name: 'Apuestas por estado' });
    const row = (label: string) => within(legend).getByText(label).closest('li')!.textContent;
    expect(row('Ganada')).toContain('3');
    expect(row('Ganada')).toContain('(60 %)');
    expect(row('Perdida')).toContain('(20 %)');
    expect(row('Pendiente')).toContain('(20 %)');
    expect(row('Anulada')).toContain('(0 %)');
    expect(row('Cash Out')).toContain('(0 %)');
  });

  it('sin apuestas ofrece añadir la primera', async () => {
    open({
      [`GET ${STATUS_URL}`]: {
        status: 200,
        body: statusBody({
          conteoApuestas: { total: 0, pending: 0, won: 0, lost: 0, void: 0, cashout: 0 },
        }),
      },
    });
    renderApp(URL);
    const card = await section('Estado de apuestas');
    expect(await within(card).findByText('Todavía no hay apuestas')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Añadir apuesta' }).getAttribute('href')).toBe(
      `${URL}/bets?nueva=1`,
    );
  });
});

describe('dashboard: apuestas recientes y pendientes', () => {
  it('lista las recientes con partido, deporte, importe, ganancia y estado (densidad reducida, Fase 11)', async () => {
    open();
    renderApp(URL);
    const card = await section('Apuestas recientes');
    const list = await within(card).findByRole('list', { name: 'Apuestas recientes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const won = rows[1]!;
    expect(within(won).getByText('Nadal vs Alcaraz')).toBeTruthy();
    expect(within(won).getByText(/Simple · Betano · Tenis/)).toBeTruthy();
    // La cuota sigue en el DOM (visible solo en pantallas muy anchas, `xl:`) pero el stake y el
    // A+G ya no son parte de este vistazo: quedan solo en "Apuestas" (Fase 11, §10.3).
    expect(within(won).getByText('1.95')).toBeTruthy();
    expect(within(won).getByText('S/ 20.00')).toBeTruthy();
    expect(within(won).getByText('+S/ 19.00')).toBeTruthy();
    expect(within(won).getByText('Ganada')).toBeTruthy();
    // En móvil cada dato lleva su rótulo (la cabecera de columnas solo se ve en escritorio).
    expect(within(won).getByText('Importe')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Ver todas' }).getAttribute('href')).toBe(
      BETS_URL,
    );
  });

  it('muestra como máximo seis', async () => {
    open({
      [`GET ${BETS_URL}`]: {
        status: 200,
        body: Array.from({ length: 8 }, (_, i) => bet({ events: [`Partido ${i + 1}`] })),
      },
    });
    renderApp(URL);
    const card = await section('Apuestas recientes');
    const list = await within(card).findByRole('list', { name: 'Apuestas recientes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
  });

  it('las pendientes aparecen de la más antigua a la más reciente, con casa, cuota e importe', async () => {
    open();
    renderApp(URL);
    const card = await section('Apuestas pendientes');
    const list = await within(card).findByRole('list', { name: 'Apuestas pendientes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getAllByText(/ vs /)[0]!.textContent)).toEqual([
      'Arsenal vs Manchester City',
      'Real Madrid vs Barcelona',
    ]);
    expect(within(rows[0]!).getByText(/Betano · cuota 1\.95/)).toBeTruthy();
    expect(within(card).getByText('2 sin liquidar')).toBeTruthy();
  });

  it('sin apuestas: estados vacíos con una acción para empezar', async () => {
    open({ [`GET ${BETS_URL}`]: { status: 200, body: [] } });
    renderApp(URL);
    const recent = await section('Apuestas recientes');
    expect(await within(recent).findByText('Todavía no hay apuestas')).toBeTruthy();
    const pending = await section('Apuestas pendientes');
    expect(within(pending).getByText('No hay apuestas pendientes')).toBeTruthy();
  });
});

describe('dashboard: casas y deportes', () => {
  it('lista las casas de mayor a menor saldo, con disponible y comprometido', async () => {
    open();
    renderApp(URL);
    const card = await section('Casas de apuestas');
    const list = await within(card).findByRole('list', { name: 'Saldo por casa' });
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Betsafe')).toBeTruthy();
    expect(within(rows[0]!).getByText('S/ 500.00')).toBeTruthy();
    expect(
      within(rows[1]!).getByText(/Disponible S\/ 180\.00 · Comprometido S\/ 20\.00/),
    ).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Ver todas' }).getAttribute('href')).toBe(
      `${URL}/finance`,
    );
  });

  it('sin casas muestra un estado vacío', async () => {
    open({ [`GET ${STATUS_URL}`]: { status: 200, body: statusBody({ porCasa: [] }) } });
    renderApp(URL);
    const card = await section('Casas de apuestas');
    expect(await within(card).findByText('Sin casas de apuestas')).toBeTruthy();
  });

  it('deportes: cantidad y porcentaje de las apuestas liquidadas', async () => {
    open();
    renderApp(URL);
    const card = await section('Deportes más jugados');
    const list = await within(card).findByRole('list', { name: 'Apuestas liquidadas por deporte' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('Fútbol');
    expect(rows[0]!.textContent).toContain('(75 %)');
    expect(rows[1]!.textContent).toContain('Tenis');
    expect(rows[1]!.textContent).toContain('(25 %)');
  });

  it('sin liquidadas, deportes muestra que aún no hay datos suficientes', async () => {
    open({ [`GET ${ANALYSIS_URL}`]: { status: 200, body: analysisBody({ bySport: [] }) } });
    renderApp(URL);
    const card = await section('Deportes más jugados');
    expect(await within(card).findByText('Aún no hay datos suficientes')).toBeTruthy();
  });
});

describe('dashboard: acciones rápidas y navegación', () => {
  it('muestra solo las acciones permitidas, con sus rutas existentes', async () => {
    open();
    renderApp(URL);
    const list = await screen.findByRole('list', { name: 'Acciones rápidas' });
    const href = (name: RegExp) => within(list).getByRole('link', { name }).getAttribute('href');
    expect(href(/Añadir apuesta/)).toBe(`${URL}/bets?nueva=1`);
    expect(href(/Importar apuestas/)).toBe(`${URL}/imports/new`);
    expect(href(/Ver reportes/)).toBe(`${URL}/reports`);
    expect(href(/Gestionar casas/)).toBe(`${URL}/finance`);
  });

  it('un Lector no ve añadir ni importar', async () => {
    open({}, { isOwner: false, myRole: 'READER', myPermissions: READER });
    renderApp(URL);
    const list = await screen.findByRole('list', { name: 'Acciones rápidas' });
    expect(within(list).queryByRole('link', { name: /Añadir apuesta/ })).toBeNull();
    expect(within(list).queryByRole('link', { name: /Importar apuestas/ })).toBeNull();
    expect(within(list).getByRole('link', { name: /Ver reportes/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Añadir apuesta' })).toBeNull();
  });

  it('"Añadir apuesta" lleva a Apuestas con el formulario abierto', async () => {
    open({
      [`GET ${URL}/houses`]: { status: 200, body: [] },
      [`GET ${URL}/stages`]: { status: 200, body: [] },
    });
    renderApp(URL);
    const list = await screen.findByRole('list', { name: 'Acciones rápidas' });
    fireEvent.click(within(list).getByRole('link', { name: /Añadir apuesta/ }));
    expect(await screen.findByRole('form', { name: 'Añadir apuesta' })).toBeTruthy();
  });

  it('"Ver todas" de las recientes lleva a Apuestas', async () => {
    open();
    renderApp(URL);
    const card = await section('Apuestas recientes');
    fireEvent.click(within(card).getByRole('link', { name: 'Ver todas' }));
    expect(await screen.findByRole('heading', { name: 'Apuestas' })).toBeTruthy();
  });
});

describe('dashboard: primeros pasos (onboarding con los datos reales)', () => {
  const zero = { total: 0, pending: 0, won: 0, lost: 0, void: 0, cashout: 0 };
  const currentStep = async () => {
    const steps = await screen.findByRole('list', { name: 'Primeros pasos' });
    return within(steps)
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('aria-current') === 'step')!;
  };

  it('sin apuestas: marca lo hecho y propone el siguiente paso, con su enlace', async () => {
    open({
      [`GET ${STATUS_URL}`]: { status: 200, body: statusBody({ conteoApuestas: zero }) },
      [`GET ${BETS_URL}`]: { status: 200, body: [] },
    });
    renderApp(URL);
    const steps = await screen.findByRole('list', { name: 'Primeros pasos' });
    const items = within(steps).getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.includes('(hecho)'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
    expect(
      within(items[2]!).getByRole('link', { name: 'Añadir apuesta' }).getAttribute('href'),
    ).toBe(`${URL}/bets?nueva=1`);
    expect(screen.getByText('2 de 4 completados')).toBeTruthy();
  });

  it('con apuestas pendientes, el siguiente paso es liquidar una', async () => {
    open({
      [`GET ${STATUS_URL}`]: {
        status: 200,
        body: statusBody({ conteoApuestas: { ...zero, total: 2, pending: 2 } }),
      },
    });
    renderApp(URL);
    expect((await currentStep()).textContent).toMatch(/Liquidar una apuesta/);
  });

  it('con apuestas ya liquidadas desaparece', async () => {
    open();
    renderApp(URL);
    await screen.findByLabelText('Capital actual');
    expect(screen.queryByRole('list', { name: 'Primeros pasos' })).toBeNull();
  });

  it('sin configuración inicial, el paso actual es configurar (con enlace si se puede)', async () => {
    open({}, { setupComplete: false, activeStage: null });
    renderApp(URL);
    const current = await currentStep();
    expect(current.textContent).toMatch(/Configurar etapa, casas y banca/);
    expect(within(current).getByRole('link', { name: 'Completar configuración' })).toBeTruthy();
  });

  it('las cifras clave explican su concepto con una ayuda', async () => {
    open();
    renderApp(URL);
    await screen.findByLabelText('Capital actual');
    fireEvent.click(screen.getByRole('button', { name: '¿Qué es Disponible?' }));
    expect(screen.getByRole('tooltip').textContent).toMatch(/usar ahora/);
  });
});
