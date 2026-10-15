import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { endOfDayInstant, startOfDayInstant } from '../../date-inputs.js';
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
import { addCalendarDays, todayInZone, zonedParts } from '../../time-zone.js';

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
const DAY = 24 * 60 * 60 * 1000;
const ZONE = 'America/Lima';
// Rango fijo en la URL: nunca coincide con el mes actual (el del rendimiento del mes).
const RANGED = `${URL}?desde=2026-05-01&hasta=2026-05-20`;

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

const counts = (total: number, won: number, lost: number, pending: number, cashout = 0) => ({
  total,
  pending,
  won,
  lost,
  void: total - won - lost - pending - cashout,
  cashout,
});

const statusBody = (overrides: Record<string, unknown> = {}) => ({
  retornosPorConfirmar: 0,
  capitalActual: '700.00',
  disponible: '680.00',
  comprometido: '20.00',
  porCasa: [],
  conteoApuestas: counts(5, 3, 1, 1),
  ...overrides,
});

const analysisBody = (overrides: Record<string, unknown> = {}) => ({
  profitLoss: '19.00',
  yield: '95.00',
  roi: '2.71',
  totalStaked: '20.00',
  winRate: '75.00',
  averageOdds: '1.950000',
  unconfirmedReturns: { count: 0, profitLoss: '0.00' },
  capitalInvested: '750.00',
  deposits: '0.00',
  withdrawals: '0.00',
  extraordinary: '0.00',
  counts: counts(5, 3, 1, 1),
  byHouse: [],
  byStage: [],
  bySport: [],
  byMarket: [],
  byPeriod: [],
  ...overrides,
});

/** Análisis del rango (distinto del histórico, para distinguirlos en pantalla). */
const RANGE_BODY = analysisBody({
  profitLoss: '-4.00',
  roi: '-1.25',
  yield: '-3.44',
  counts: counts(4, 1, 2, 1),
});
/** Análisis del mes actual. */
const MONTH_BODY = analysisBody({
  profitLoss: '12.50',
  roi: '1.67',
  yield: '8.62',
  winRate: '50.00',
  averageOdds: '2.150000',
  counts: counts(3, 1, 1, 1),
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
  houseId: '0195f7c0-0000-7000-8000-0000000000a1',
  houseName: 'Betano',
  betType: 'SIMPLE',
  stake: '2.0000',
  officialAmount: null,
  effectiveAmount: '20.00',
  amountSource: 'CALCULATED',
  visibleTotalOdds: '1.95',
  totalOddsSource: 'OFFICIAL',
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
  externalReference: null,
  createdBy: { id: ANA.id, name: 'Ana Pérez' },
  createdAt: '2026-06-01T20:05:00.000Z',
  updatedAt: '2026-06-01T20:05:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
  events: ['Arsenal vs Manchester City'],
  sports: ['Fútbol'],
  ticketCount: 0,
  headline: { market: '1X2', selection: 'Arsenal' },
  ...overrides,
});

const betsBody = () => [
  bet({
    events: ['Real Madrid vs Barcelona'],
    headline: { market: '1X2', selection: 'Real Madrid' },
    placedAt: '2026-06-03T20:00:00.000Z',
  }),
  bet({
    events: ['Nadal vs Alcaraz', 'Sinner vs Medvedev'],
    sports: ['Tenis'],
    betType: 'MULTIPLE',
    headline: null,
    status: 'WON',
    profitLoss: '19.00',
    effectiveReturn: '39.00',
    returnSource: 'CALCULATED',
    placedAt: '2026-06-02T20:00:00.000Z',
  }),
  bet({ events: ['Arsenal vs Manchester City'], placedAt: '2026-06-01T20:00:00.000Z' }),
];

type AnalysisHandler = (query: URLSearchParams) => { status: number; body: unknown };

/** Instantes del mes `AAAA-MM` en la zona del proyecto, como los pide la página. */
const monthQuery = (month: string) => {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return {
    from: zonedStart(`${month}-01`),
    to: zonedEnd(`${month}-${String(last).padStart(2, '0')}`),
  };
};
const zonedStart = (date: string) => startOfDayInstant(date);
const zonedEnd = (date: string) => endOfDayInstant(date);

/**
 * Análisis por defecto según lo que se pide: sin `from`, el histórico; con el mes actual, el del
 * mes; cualquier otro rango, el del rango.
 */
const defaultAnalysis: AnalysisHandler = (query) => {
  if (!query.get('from')) return { status: 200, body: analysisBody() };
  const month = monthQuery(todayInZone(ZONE).slice(0, 7));
  if (query.get('from') === month.from && query.get('to') === month.to) {
    return { status: 200, body: MONTH_BODY };
  }
  return { status: 200, body: RANGE_BODY };
};

/**
 * Como `stubApi`, pero `GET /dashboard/analysis` se resuelve con un manejador que recibe los
 * filtros (`from`/`to`), y sus peticiones quedan en `analysisCalls`.
 */
function open(
  extra: Record<string, Handler> = {},
  project: Record<string, unknown> = {},
  analysis: AnalysisHandler = defaultAnalysis,
) {
  const stub = stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail(project) },
    [`GET ${STATUS_URL}`]: { status: 200, body: statusBody() },
    [`GET ${BANKROLL_URL}`]: { status: 200, body: bankrollBody },
    [`GET ${BETS_URL}`]: { status: 200, body: betsBody() },
    ...extra,
  });
  const inner = globalThis.fetch;
  const analysisCalls: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = String(input).replace(/^\/api/, '');
      if (!path.startsWith(ANALYSIS_URL)) return inner(input, init);
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      analysisCalls.push(query);
      stub.calls.push({ method: 'GET', path, body: undefined });
      const { status, body } = analysis(query);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return { ...stub, analysisCalls };
}

const section = async (title: string) =>
  (await screen.findByRole('heading', { name: title })).closest('section')!;
const text = (label: string) => screen.getByLabelText(label).textContent;
const READER = [
  'project.view',
  'members.view',
  'stages.view',
  'houses.view',
  'movements.view',
  'bets.view',
];

describe('dashboard: tarjeta de capital', () => {
  it('muestra cada cifra de la API con su formato y signo: estado, histórico y rango', async () => {
    open();
    renderApp(RANGED);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText(/Aquí tienes un resumen de tu proyecto/).textContent).toContain(
      'Grupo Norte',
    );
    await screen.findByLabelText('Capital actual');
    // `/dashboard/status`.
    expect(text('Capital actual')).toBe('S/ 700.00');
    expect(text('Disponible')).toBe('S/ 680.00');
    expect(text('Comprometido')).toBe('S/ 20.00');
    expect(screen.getByText('1 apuesta pendiente')).toBeTruthy();
    // Análisis sin filtros: desde el inicio.
    expect(await screen.findByLabelText('ROI desde el inicio: +2.7%')).toBeTruthy();
    expect(text('Ganancia / Pérdida total')).toBe('+S/ 19.00');
    expect(screen.getByText('Desde el inicio del proyecto')).toBeTruthy();
    // Análisis del rango: ROI, Yield y total de apuestas (negativos en rojo, con signo).
    await waitFor(() => expect(text('ROI del rango')).toBe('-1.3%'));
    expect(text('Yield del rango')).toBe('-3.4%');
    expect(screen.getByLabelText('Yield del rango').className).toContain('text-red-700');
    expect(text('Total de apuestas')).toBe('4');
    expect(screen.getByText('1 ganadas • 2 perdidas • 1 pendientes')).toBeTruthy();
    // Stake unitario de la etapa activa.
    expect(text('Stake unitario')).toBe('S/ 10.00');
  });

  it('mientras llegan los datos muestra esqueletos, nunca un 0 provisional', async () => {
    open();
    const stubbed = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      String(input).endsWith('/dashboard/status')
        ? new Promise<Response>(() => undefined)
        : stubbed(input, init),
    );
    renderApp(URL);
    expect(await screen.findByText('Cargando capital actual…')).toBeTruthy();
    expect(screen.getByText('Cargando el estado de las apuestas…')).toBeTruthy();
    expect(screen.queryByText('S/ 0.00')).toBeNull();
    expect(screen.queryByLabelText('Capital actual')).toBeNull();
  });

  it('un error queda en su tarjeta, con «Reintentar», y el resto sigue funcionando', async () => {
    let fail = true;
    const { calls } = open({
      [`GET ${STATUS_URL}`]: () =>
        fail ? apiError(500, 'INTERNAL_ERROR') : { status: 200, body: statusBody() },
    });
    renderApp(URL);
    const states = await section('Estado de apuestas');
    expect(await within(states).findByRole('alert')).toBeTruthy();
    // Las demás tarjetas, intactas.
    const recent = await section('Apuestas recientes');
    expect(await within(recent).findByText('Real Madrid vs Barcelona')).toBeTruthy();
    expect(await screen.findByLabelText('Ganancia / Pérdida total')).toBeTruthy();

    fail = false;
    const before = calls.filter((c) => c.path === STATUS_URL).length;
    fireEvent.click(within(states).getByRole('button', { name: 'Reintentar' }));
    expect(
      (await within(states).findByLabelText('Total de apuestas del gráfico')).textContent,
    ).toBe('5');
    expect(calls.filter((c) => c.path === STATUS_URL).length).toBe(before + 1);
  });

  it('el aviso de retornos por confirmar solo aparece si hay alguno', async () => {
    open({
      [`GET ${STATUS_URL}`]: { status: 200, body: statusBody({ retornosPorConfirmar: 2 }) },
    });
    renderApp(URL);
    const notice = await screen.findByText(/2 apuestas ganadas con retorno calculado/);
    expect(
      within(notice.closest('[role="status"]')!)
        .getByRole('link', { name: 'Ver retornos por confirmar' })
        .getAttribute('href'),
    ).toBe(`${URL}/returns`);
    cleanup();

    open();
    renderApp(URL);
    await screen.findByLabelText('Capital actual');
    expect(screen.queryByText(/con retorno calculado/)).toBeNull();
  });
});

describe('dashboard: rango de fechas', () => {
  it('por defecto pide los últimos 30 días, en la zona del proyecto', async () => {
    const { analysisCalls } = open();
    renderApp(URL);
    await screen.findByLabelText('Capital actual');
    const today = todayInZone(ZONE);
    await waitFor(() =>
      expect(
        analysisCalls.some(
          (q) =>
            q.get('from') === zonedStart(addCalendarDays(today, -29)) &&
            q.get('to') === zonedEnd(today),
        ),
      ).toBe(true),
    );
  });

  it('lee el rango de la URL y, al elegir otro, pide sus fechas', async () => {
    const { analysisCalls } = open();
    renderApp(RANGED);
    const button = await screen.findByRole('button', {
      name: 'Rango de fechas: 1 may. 2026 - 20 may. 2026',
    });
    await waitFor(() =>
      expect(analysisCalls.some((q) => q.get('from') === zonedStart('2026-05-01'))).toBe(true),
    );

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Últimos 7 días' }));
    const today = todayInZone(ZONE);
    await waitFor(() =>
      expect(
        analysisCalls.some((q) => q.get('from') === zonedStart(addCalendarDays(today, -6))),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: /^Rango de fechas: / }).textContent).not.toContain(
      'may.',
    );
  });

  it('«Todo el proyecto» pide el análisis sin fechas', async () => {
    const { analysisCalls } = open();
    renderApp(RANGED);
    fireEvent.click(await screen.findByRole('button', { name: /^Rango de fechas/ }));
    const before = analysisCalls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Todo el proyecto' }));
    expect(
      await screen.findByRole('button', { name: 'Rango de fechas: Todo el proyecto' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(analysisCalls.slice(before).some((q) => !q.has('from') && !q.has('to'))).toBe(true),
    );
  });

  it('un rango personalizado válido se aplica; uno al revés no', async () => {
    const { analysisCalls } = open();
    renderApp(RANGED);
    fireEvent.click(await screen.findByRole('button', { name: /^Rango de fechas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-04-10' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-04-01' } });
    expect(screen.getByRole('button', { name: 'Aplicar' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-04-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() =>
      expect(
        analysisCalls.some(
          (q) =>
            q.get('from') === zonedStart('2026-04-10') && q.get('to') === zonedEnd('2026-04-30'),
        ),
      ).toBe(true),
    );
  });
});

describe('dashboard: evolución del capital', () => {
  const chartLabel = async () =>
    within(await section('Evolución del capital'))
      .getByRole('img')
      .getAttribute('aria-label');

  it('30D por defecto; los presets filtran los puntos ya calculados', async () => {
    open();
    renderApp(URL);
    const chart = await section('Evolución del capital');
    await within(chart).findByRole('img');
    const radio = (name: string) => within(chart).getByRole('radio', { name });
    expect(radio('Últimos 30 días').getAttribute('aria-checked')).toBe('true');
    // El saldo al inicio del periodo es el último punto anterior a él (no se inventa ninguno).
    expect(await chartLabel()).toBe('Capital de S/ 500.00 a S/ 700.00 en los últimos 30 días');
    fireEvent.click(radio('Todo el proyecto'));
    expect(await chartLabel()).toBe('Capital de S/ 500.00 a S/ 700.00 en todo el proyecto');
    expect(radio('Todo el proyecto').getAttribute('aria-checked')).toBe('true');
  });

  it('un periodo sin movimientos lo dice', async () => {
    open({ [`GET ${BANKROLL_URL}`]: { status: 200, body: { points: [point(60, '700.00')] } } });
    renderApp(URL);
    const chart = await section('Evolución del capital');
    expect(await within(chart).findByText('Aún no hay movimientos en este periodo.')).toBeTruthy();
    fireEvent.click(within(chart).getByRole('radio', { name: 'Últimos 3 meses' }));
    expect(within(chart).getByRole('img').getAttribute('aria-label')).toBe(
      'Capital de S/ 700.00 a S/ 700.00 en los últimos 3 meses',
    );
  });

  it('el control de periodo se maneja con las flechas', async () => {
    open();
    renderApp(URL);
    const chart = await section('Evolución del capital');
    const group = within(chart).getByRole('radiogroup', { name: 'Periodo del gráfico' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(
      within(chart).getByRole('radio', { name: 'Últimos 3 meses' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});

describe('dashboard: estado de apuestas', () => {
  it('«Todo» usa los conteos del proyecto y «Rango» los del análisis del rango', async () => {
    open();
    renderApp(RANGED);
    const card = await section('Estado de apuestas');
    const total = () => within(card).getByLabelText('Total de apuestas del gráfico').textContent;
    await within(card).findByLabelText('Total de apuestas del gráfico');
    expect(total()).toBe('5');
    const legend = within(card).getByRole('list', { name: 'Apuestas por estado' });
    const row = (label: string) => within(legend).getByText(label).closest('li')!.textContent;
    expect(row('Ganadas')).toContain('3');
    expect(row('Ganadas')).toContain('(60%)');
    expect(row('Cash Out')).toContain('(0%)');

    fireEvent.change(within(card).getByLabelText('Apuestas consideradas'), {
      target: { value: 'RANGE' },
    });
    await waitFor(() => expect(total()).toBe('4'));
    expect(row('Perdidas')).toContain('(50%)');
  });

  it('sin apuestas: anillo vacío con «0 apuestas» y el acceso para añadir', async () => {
    open({
      [`GET ${STATUS_URL}`]: {
        status: 200,
        body: statusBody({ conteoApuestas: counts(0, 0, 0, 0) }),
      },
      [`GET ${BETS_URL}`]: { status: 200, body: [] },
    });
    renderApp(URL);
    const card = await section('Estado de apuestas');
    expect(await within(card).findByRole('img', { name: '0 apuestas' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Añadir apuesta' }).getAttribute('href')).toBe(
      `${URL}/bets?nueva=1`,
    );
  });
});

describe('dashboard: rendimiento del mes', () => {
  it('pide el mes actual y muestra win rate, cuota media, beneficio y Yield', async () => {
    const { analysisCalls } = open();
    renderApp(RANGED);
    const card = await section('Rendimiento del mes');
    await waitFor(() =>
      expect(within(card).getByLabelText('Win rate del mes').textContent).toBe('50.0%'),
    );
    const month = monthQuery(todayInZone(ZONE).slice(0, 7));
    expect(
      analysisCalls.some((q) => q.get('from') === month.from && q.get('to') === month.to),
    ).toBe(true);
    expect(within(card).getByText('1 de 2 apuestas decididas')).toBeTruthy();
    expect(within(card).getByLabelText('Cuota media del mes').textContent).toBe('2.15');
    expect(within(card).getByLabelText('Beneficio neto del mes').textContent).toBe('+S/ 12.50');
    expect(within(card).getByText('+1.7% ROI')).toBeTruthy();
    expect(within(card).getByLabelText('Yield del mes').textContent).toBe('+8.6%');
  });

  it('el selector va del mes de la apuesta más antigua al actual; sin decididas, «—»', async () => {
    const { analysisCalls } = open({}, {}, (query) => {
      if (query.get('from') === monthQuery('2026-06').from) {
        return {
          status: 200,
          body: analysisBody({ winRate: null, averageOdds: null, yield: null, roi: null }),
        };
      }
      return defaultAnalysis(query);
    });
    renderApp(RANGED);
    const card = await section('Rendimiento del mes');
    const select = within(card).getByLabelText<HTMLSelectElement>('Mes');
    await waitFor(() => expect(select.options[select.options.length - 1]!.text).toBe('Junio 2026'));
    expect(select.options[0]!.value).toBe(todayInZone(ZONE).slice(0, 7));

    fireEvent.change(select, { target: { value: '2026-06' } });
    await waitFor(() =>
      expect(within(card).getByLabelText('Win rate del mes').textContent).toBe('—'),
    );
    expect(analysisCalls.some((q) => q.get('to') === monthQuery('2026-06').to)).toBe(true);
    expect(within(card).getAllByText('Sin apuestas decididas este mes').length).toBeGreaterThan(1);
  });
});

describe('dashboard: apuestas recientes y pendientes', () => {
  it('tabla de recientes: fecha, partido, tipo, monto, cuota, resultado y ganancia', async () => {
    const body = betsBody();
    open({ [`GET ${BETS_URL}`]: { status: 200, body } });
    renderApp(URL);
    const card = await section('Apuestas recientes');
    const list = await within(card).findByRole('list', { name: 'Apuestas recientes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    expect(
      within(first).getByRole('link', { name: 'Real Madrid vs Barcelona' }).getAttribute('href'),
    ).toBe(`${BETS_URL}/${body[0]!.id}`);
    expect(within(first).getByText('1X2 - Real Madrid')).toBeTruthy();
    expect(within(first).getAllByText('Pendiente').length).toBeGreaterThan(0);
    expect(within(first).getByText('-')).toBeTruthy();
    const multiple = rows[1]!;
    expect(within(multiple).getByText('Múltiple · 2 selecciones')).toBeTruthy();
    expect(within(multiple).getByText('S/ 20.00')).toBeTruthy();
    expect(within(multiple).getByText('1.95')).toBeTruthy();
    expect(within(multiple).getByText('+S/ 19.00')).toBeTruthy();
    // Retorno calculado sin confirmar: la ganancia es provisional.
    expect(within(multiple).getByText('provisional')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Ver todas' }).getAttribute('href')).toBe(
      BETS_URL,
    );
  });

  it('muestra como máximo cinco; el menú ⋮ lleva al detalle', async () => {
    const many = Array.from({ length: 8 }, (_, i) => bet({ events: [`Partido ${i + 1}`] }));
    open({
      [`GET ${BETS_URL}`]: { status: 200, body: many },
      [`GET ${BETS_URL}/${many[0]!.id}`]: apiError(404, 'NOT_FOUND'),
    });
    renderApp(URL);
    const card = await section('Apuestas recientes');
    const list = await within(card).findByRole('list', { name: 'Apuestas recientes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(list).getByRole('button', { name: 'Más acciones de Partido 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ver detalle' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull());
  });

  it('pendientes: las tres más recientes, el total de la API y la fecha relativa', async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    open({
      [`GET ${STATUS_URL}`]: {
        status: 200,
        body: statusBody({ conteoApuestas: counts(9, 2, 1, 6) }),
      },
      [`GET ${BETS_URL}`]: {
        status: 200,
        body: [
          bet({ events: ['Colombia vs Chile'], placedAt: recent }),
          bet({ events: ['Ecuador vs Paraguay'] }),
          bet({ events: ['Ganada'], status: 'WON', profitLoss: '1.00' }),
          bet({ events: ['Brasil vs Perú'], houseName: 'Betsafe' }),
          bet({ events: ['Cuarta pendiente'] }),
        ],
      },
    });
    renderApp(URL);
    const card = await section('Apuestas pendientes');
    const list = await within(card).findByRole('list', { name: 'Apuestas pendientes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual([
      'Colombia vs Chile',
      'Ecuador vs Paraguay',
      'Brasil vs Perú',
    ]);
    expect(
      within(rows[0]!).getByText(`Hoy, ${zonedParts(new Date(recent), ZONE).time}`),
    ).toBeTruthy();
    expect(within(rows[2]!).getByText('Fútbol · Betsafe')).toBeTruthy();
    expect(await within(card).findByLabelText('6 pendientes')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Ver todos' }).getAttribute('href')).toBe(
      `${BETS_URL}?estado=PENDING`,
    );
  });

  it('sin apuestas: estados vacíos', async () => {
    open({ [`GET ${BETS_URL}`]: { status: 200, body: [] } });
    renderApp(URL);
    const recent = await section('Apuestas recientes');
    expect(await within(recent).findByText(/Todavía no hay apuestas/)).toBeTruthy();
    const pending = await section('Apuestas pendientes');
    expect(within(pending).getByText('No tienes apuestas pendientes.')).toBeTruthy();
  });
});

describe('dashboard: acciones rápidas, permisos y configuración', () => {
  it('muestra solo las acciones permitidas, con sus rutas', async () => {
    open();
    renderApp(URL);
    const list = await screen.findByRole('list', { name: 'Acciones rápidas' });
    const href = (name: string) => within(list).getByRole('link', { name }).getAttribute('href');
    expect(href('Añadir apuesta')).toBe(`${URL}/bets?nueva=1`);
    expect(href('Importar apuestas')).toBe(`${URL}/imports/new`);
    expect(href('Ver historial')).toBe(BETS_URL);
    expect(href('Gestionar casas')).toBe(`${URL}/finance`);
  });

  it('un Lector no ve añadir ni importar (ni el botón del encabezado)', async () => {
    open({}, { isOwner: false, myRole: 'READER', myPermissions: READER });
    renderApp(URL);
    const list = await screen.findByRole('list', { name: 'Acciones rápidas' });
    expect(within(list).queryByRole('link', { name: 'Añadir apuesta' })).toBeNull();
    expect(within(list).queryByRole('link', { name: 'Importar apuestas' })).toBeNull();
    expect(within(list).getByRole('link', { name: 'Ver historial' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Añadir apuesta' })).toBeNull();
  });

  it('sin bets.view no pide métricas y lo explica', async () => {
    const { calls } = open(
      {},
      { isOwner: false, myRole: 'READER', myPermissions: ['project.view', 'houses.view'] },
    );
    renderApp(URL);
    expect(
      await screen.findByText('Tu rol no incluye la consulta de apuestas ni de métricas.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Rango de fechas/ })).toBeNull();
    expect(calls.some((c) => c.path.includes('/dashboard/'))).toBe(false);
  });

  it('con la configuración inicial pendiente no pide métricas y muestra los primeros pasos', async () => {
    const { calls } = open({}, { setupComplete: false, activeStage: null });
    renderApp(URL);
    const steps = await screen.findByRole('list', { name: 'Primeros pasos' });
    expect(within(steps).getByText('Configurar etapa, casas y banca')).toBeTruthy();
    expect(calls.some((c) => c.path.includes('/dashboard/'))).toBe(false);
  });

  it('«Añadir apuesta» lleva a Apuestas con el asistente abierto', async () => {
    open({
      [`GET ${URL}/houses`]: { status: 200, body: [] },
      [`GET ${URL}/stages`]: { status: 200, body: [] },
      [`GET ${URL}/bet-drafts`]: { status: 200, body: [] },
    });
    renderApp(URL);
    const list = await screen.findByRole('list', { name: 'Acciones rápidas' });
    fireEvent.click(within(list).getByRole('link', { name: 'Añadir apuesta' }));
    expect(await screen.findByRole('form', { name: 'Añadir apuesta' })).toBeTruthy();
  });

  it('las cifras clave explican su concepto con una ayuda', async () => {
    open();
    renderApp(URL);
    await screen.findByLabelText('Capital actual');
    fireEvent.click(screen.getByRole('button', { name: '¿Qué es Disponible?' }));
    expect(screen.getByRole('tooltip').textContent).toMatch(/usar ahora/);
  });
});

describe('dashboard: primeros pasos (onboarding con los datos reales)', () => {
  const zero = counts(0, 0, 0, 0);
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
    expect(screen.getByText('2 de 4 completados')).toBeTruthy();
  });

  it('con apuestas pendientes, el siguiente paso es liquidar una', async () => {
    open({
      [`GET ${STATUS_URL}`]: {
        status: 200,
        body: statusBody({ conteoApuestas: counts(2, 0, 0, 2) }),
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
});
