import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  AUTH_STATE,
  OWNER_PERMISSIONS,
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
  await Promise.all([import('./ReportsPage.js'), import('./DashboardPage.js')]);
});

const URL = `/projects/${PROJECT_ID}`;
const REPORTS_URL = `${URL}/reports`;
const DATA_URL = `${URL}/reports/data`;
const PDF_URL = `${URL}/reports/pdf`;
const ANALYSIS_URL = `${URL}/dashboard/analysis`;
const PERFORMANCE_URL = `${URL}/dashboard/performance-chart`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const HOUSE_B = '0195f7c0-0000-7000-8000-0000000000a2';

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
  vi.useRealTimers();
});

const house = (id: string, name: string) => ({
  id,
  projectId: PROJECT_ID,
  name,
  status: 'ACTIVE',
  balance: '500.00',
  committed: '20.00',
  available: '480.00',
  createdAt: '2026-06-01T12:00:00.000Z',
});
const stage = {
  id: STAGE_ID,
  projectId: PROJECT_ID,
  name: 'Etapa 1',
  unitStake: '10.00',
  status: 'ACTIVE',
  createdAt: '2026-06-01T12:00:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
};

const analysisBody = (overrides: Record<string, unknown> = {}) => ({
  profitLoss: '19.00',
  yield: '95.00',
  roi: '2.71',
  totalStaked: '20.00',
  winRate: '50.00',
  averageOdds: '1.950000',
  unconfirmedReturns: { count: 0, profitLoss: '0.00' },
  capitalInvested: '750.00',
  deposits: '0.00',
  withdrawals: '0.00',
  extraordinary: '0.00',
  counts: { total: 3, pending: 1, won: 1, lost: 1, void: 0, cashout: 0 },
  // P/L de los desgloses distintos entre sí: solo para no chocar como texto en las aserciones.
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

let counter = 0;
const reportBet = (overrides: Record<string, unknown> = {}) => ({
  id: `0195f7c0-0000-7000-8000-00000000${String(++counter).padStart(4, '0')}`,
  placedAt: '2026-06-02T20:00:00.000Z',
  placedTimeKnown: true,
  settledAt: null,
  houseName: 'Betano',
  stageName: 'Etapa 1',
  betType: 'SIMPLE',
  status: 'WON',
  origin: 'MANUAL',
  stake: '2.0000',
  amount: '20.00',
  visibleTotalOdds: '1.950000',
  totalOddsSource: 'OFFICIAL',
  profitLoss: '19.00',
  provisional: false,
  legs: [
    {
      event: 'Real Madrid vs Villarreal',
      sport: 'Fútbol',
      odds: '1.950000',
      conditions: [{ market: '1X2', selection: 'Real Madrid' }],
    },
  ],
  ticketCount: 0,
  ...overrides,
});
const multiple = () =>
  reportBet({
    betType: 'MULTIPLE',
    status: 'LOST',
    amount: '10.00',
    profitLoss: '-10.00',
    visibleTotalOdds: '8.420000',
    totalOddsSource: 'CALCULATED',
    placedAt: '2026-06-03T20:00:00.000Z',
    legs: [
      {
        event: 'Universitario - Melgar',
        sport: 'Fútbol',
        odds: '2.150000',
        conditions: [{ market: 'Doble oportunidad', selection: '1X' }],
      },
      {
        event: 'Liverpool - Manchester City',
        sport: 'Fútbol',
        odds: '2.470000',
        conditions: [
          { market: 'Resultado', selection: 'Manchester City' },
          { market: 'Córners', selection: 'Más de 2.5' },
        ],
      },
      {
        event: 'Benfica - Vitória',
        sport: 'Fútbol',
        odds: '1.210000',
        conditions: [{ market: 'Resultado', selection: 'Benfica' }],
      },
      {
        event: 'Inter Miami - DC United',
        sport: 'Fútbol',
        odds: '1.310000',
        conditions: [{ market: 'Goles', selection: 'Más de 4.5' }],
      },
    ],
  });
const reportBody = (
  bets = [
    reportBet(),
    multiple(),
    reportBet({
      status: 'PENDING',
      profitLoss: null,
      placedAt: '2026-06-04T20:00:00.000Z',
      legs: [
        {
          event: 'Colombia vs Chile',
          sport: 'Fútbol',
          odds: '2.050000',
          conditions: [{ market: '1X2', selection: 'Colombia' }],
        },
      ],
    }),
  ],
  analysis = analysisBody(),
) => ({
  generatedAt: '2026-06-10T15:00:00.000Z',
  analysis,
  totals: {
    bets: bets.length,
    settledBets: 1,
    averageStakeSettled: '20.00',
    stakedSettled: '20.00',
    stakedPending: '20.00',
    returns: '39.00',
    profitLoss: '19.00',
  },
  byBetType: [],
  cumulative: [],
  highlights: { best: null, worst: null },
  bets,
});

type QueryHandler = (query: URLSearchParams) => { status: number; body: unknown; type?: string };

/**
 * Como `stubApi`, pero las rutas con consulta (`/reports/data`, `/reports/pdf`, `/dashboard/analysis`)
 * se resuelven con un manejador que recibe sus parámetros; las peticiones quedan en `queries`.
 */
function open(
  {
    data,
    pdf,
    permissions,
  }: { data?: QueryHandler; pdf?: QueryHandler; permissions?: string[] } = {},
  extra: Record<string, Handler> = {},
) {
  const stub = stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: {
      status: 200,
      body: projectDetail(permissions ? { myPermissions: permissions } : {}),
    },
    [`GET ${URL}/houses`]: {
      status: 200,
      body: [house(HOUSE_A, 'Betano'), house(HOUSE_B, 'Bwin')],
    },
    [`GET ${URL}/stages`]: { status: 200, body: [stage] },
    [`GET ${PERFORMANCE_URL}`]: {
      status: 200,
      body: { points: [], maxDrawdown: '0.00', maxDrawdownPercent: null },
    },
    ...extra,
  });
  const inner = globalThis.fetch;
  const queries: { path: string; query: URLSearchParams }[] = [];
  const routes: [string, QueryHandler][] = [
    [DATA_URL, data ?? (() => ({ status: 200, body: reportBody() }))],
    [PDF_URL, pdf ?? (() => ({ status: 200, body: '%PDF-1.3 prueba', type: 'application/pdf' }))],
    [ANALYSIS_URL, () => ({ status: 200, body: analysisBody() })],
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = String(input).replace(/^\/api/, '');
      const base = path.split('?')[0]!;
      const route = routes.find(([p]) => p === base);
      if (!route) return inner(input, init);
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      queries.push({ path: base, query });
      const { status, body, type = 'application/json' } = route[1](query);
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': type },
        }),
      );
    }),
  );
  vi.stubGlobal(
    'URL',
    Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => 'blob:reporte'),
      revokeObjectURL: vi.fn(),
    }),
  );
  return {
    ...stub,
    queries,
    dataQueries: () => queries.filter((q) => q.path === DATA_URL).map((q) => q.query),
    pdfQueries: () => queries.filter((q) => q.path === PDF_URL).map((q) => q.query),
  };
}

const ready = async () => {
  await screen.findByRole('heading', { name: 'Reportes' });
  await screen.findByText(/apuestas encontradas/);
};

describe('reportes: panel y filtros (§108.11)', () => {
  it('por defecto pide los últimos 30 días y muestra las apuestas incluidas y la vista previa', async () => {
    const { dataQueries } = open();
    renderApp(REPORTS_URL);
    await ready();
    expect(screen.getByText('3 apuestas encontradas')).toBeTruthy();
    expect(dataQueries()[0]!.get('from')).toBeTruthy();
    expect(dataQueries()[0]!.get('to')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Últimos 30 días' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const table = screen.getByRole('region', { name: 'Apuestas incluidas en el reporte' });
    expect(within(table).getByText('3 apuestas seleccionadas')).toBeTruthy();
    expect(within(table).getByText('Real Madrid vs Villarreal')).toBeTruthy();
    // La vista previa usa las mismas cifras (las del backend).
    const preview = screen.getByRole('img', { name: 'Miniatura de la primera página del PDF' });
    expect(within(preview).getByText('Ganancia neta').previousElementSibling!.textContent).toBe(
      '+S/ 19.00',
    );
  });

  it('«Todas» pide todo el historial; los filtros solo se aplican al pulsar «Aplicar filtros»', async () => {
    const { dataQueries } = open();
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(dataQueries().at(-1)!.has('from')).toBe(false));
    expect(screen.getByLabelText('Periodo aplicado: Todo el historial')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Casa de apuestas'), { target: { value: HOUSE_B } });
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'LOST' } });
    expect(screen.getByText(/Hay cambios sin aplicar/)).toBeTruthy();
    const before = dataQueries().length;
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(dataQueries().length).toBe(before + 1));
    expect(dataQueries().at(-1)!.get('houseId')).toBe(HOUSE_B);
    expect(dataQueries().at(-1)!.get('status')).toBe('LOST');
  });

  it('las fechas se envían como el día completo en la zona del proyecto (Lima)', async () => {
    const { dataQueries } = open();
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(dataQueries().at(-1)!.get('from')).toBe('2026-06-01T05:00:00.000Z'));
    expect(dataQueries().at(-1)!.get('to')).toBe('2026-06-02T04:59:59.999Z');
  });

  it('con un proyecto en otra zona (Tokio) el día es el de esa zona', async () => {
    const { dataQueries } = open(
      {},
      { [`GET ${URL}`]: { status: 200, body: projectDetail({ timezone: 'Asia/Tokyo' }) } },
    );
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(dataQueries().at(-1)!.get('from')).toBe('2026-05-31T15:00:00.000Z'));
  });

  it('«Últimos 7 días» = hoy y los 6 anteriores, contados en la zona del proyecto', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-10T02:00:00.000Z')); // 09/06 21:00 en Lima
    const { dataQueries } = open();
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Últimos 7 días' }));
    await waitFor(() => expect(dataQueries().at(-1)!.get('from')).toBe('2026-06-03T05:00:00.000Z'));
    expect(dataQueries().at(-1)!.get('to')).toBe('2026-06-10T04:59:59.999Z');
  });

  it('un rango al revés no se puede aplicar', async () => {
    open();
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-06-01' } });
    expect(screen.getByRole('button', { name: 'Aplicar filtros' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/no puede ser posterior/)).toBeTruthy();
  });

  it('sin apuestas: lo explica (el PDF igual puede generarse)', async () => {
    open({ data: () => ({ status: 200, body: reportBody([]) }) });
    renderApp(REPORTS_URL);
    await screen.findByText('0 apuestas encontradas');
    expect(screen.getByText(/No hay apuestas con estos filtros/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Generar PDF/ }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('si la API falla, la tabla lo dice con «Reintentar»', async () => {
    let fail = true;
    const { dataQueries } = open({
      data: () =>
        fail
          ? { status: 500, body: { statusCode: 500, code: 'INTERNAL_ERROR', message: 'x' } }
          : { status: 200, body: reportBody() },
    });
    renderApp(REPORTS_URL);
    const table = await screen.findByRole('region', { name: 'Apuestas incluidas en el reporte' });
    const alert = await within(table).findByRole('alert');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await within(table).findByText('Real Madrid vs Villarreal');
    expect(dataQueries().length).toBe(2);
  });
});

describe('reportes: tabla de apuestas incluidas', () => {
  it('una Múltiple con Creada interna es UNA fila; al abrirla, 4 legs con su cuota una vez y 5 condiciones', async () => {
    open();
    renderApp(REPORTS_URL);
    await ready();
    const table = screen.getByRole('region', { name: 'Apuestas incluidas en el reporte' });
    const row = within(table)
      .getByText(
        'Universitario - Melgar + Liverpool - Manchester City + Benfica - Vitória + Inter Miami - DC United',
      )
      .closest('tr')!;
    expect(within(row).getByText('Múltiple · 4 selecciones')).toBeTruthy();
    expect(within(row).getByText('calc.')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: /Ver selecciones/ }));
    const detail = row.nextElementSibling as HTMLElement;
    expect(
      within(detail)
        .getAllByRole('listitem')
        .filter((li) => li.tagName === 'LI' && li.parentElement?.tagName === 'OL'),
    ).toHaveLength(4);
    expect(within(detail).getAllByText(/@ 2\.47/)).toHaveLength(1);
    expect(within(detail).getByText('· Más de 2.5 (Córners)')).toBeTruthy();
  });

  it('muestra 10 de vista previa y «Ver todas» despliega el resto', async () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      reportBet({
        legs: [
          {
            event: `Partido ${i + 1}`,
            sport: 'Fútbol',
            odds: '1.900000',
            conditions: [{ market: '1X2', selection: 'Local' }],
          },
        ],
      }),
    );
    open({ data: () => ({ status: 200, body: reportBody(many) }) });
    renderApp(REPORTS_URL);
    await ready();
    const table = screen.getByRole('region', { name: 'Apuestas incluidas en el reporte' });
    expect(within(table).getAllByRole('link')).toHaveLength(10);
    fireEvent.click(within(table).getByRole('button', { name: /Ver todas/ }));
    expect(within(table).getAllByRole('link')).toHaveLength(14);
  });
});

describe('reportes: generación del PDF', () => {
  it('«Generar PDF» pide el MISMO alcance aplicado y las opciones del documento, y lo descarga', async () => {
    const { dataQueries, pdfQueries } = open();
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.change(screen.getByLabelText('Casa de apuestas'), { target: { value: HOUSE_A } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(dataQueries().at(-1)!.get('houseId')).toBe(HOUSE_A));
    fireEvent.click(screen.getByRole('radio', { name: 'Horizontal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por ganancia' }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const button = screen.getByRole('button', { name: /Generar PDF/ });
    fireEvent.click(button);
    fireEvent.click(button); // doble clic: una sola petición
    expect(await screen.findByRole('button', { name: /PDF listo/ })).toBeTruthy();
    expect(pdfQueries()).toHaveLength(1);
    const q = pdfQueries()[0]!;
    const applied = dataQueries().at(-1)!;
    for (const key of ['from', 'to', 'houseId']) expect(q.get(key)).toBe(applied.get(key));
    expect(q.get('orientation')).toBe('landscape');
    expect(q.get('sortBy')).toBe('profit');
    expect(q.get('sections')).toBe('summary,charts,metrics,segments,operations,table,selections');
    expect(q.get('periodLabel')).toMatch(/^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('el nombre del archivo es editable y se sanea', async () => {
    open();
    renderApp(REPORTS_URL);
    await ready();
    const input = screen.getByLabelText<HTMLInputElement>('Nombre del archivo');
    expect(input.value).toMatch(
      /^LetFer_Reporte_Grupo_Norte_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    fireEvent.change(input, { target: { value: 'reporte octubre/2026 ñ.pdf' } });
    let downloaded = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = this.download;
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar PDF/ }));
    await screen.findByRole('button', { name: /PDF listo/ });
    expect(downloaded).toBe('reporte_octubre_2026_n.pdf');
  });

  it('un error de la API se muestra y nunca anuncia «PDF listo»', async () => {
    open({
      pdf: () => ({
        status: 413,
        body: {
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message:
            'El reporte tendría 6000 apuestas (máximo 5000). Acota el periodo o los filtros.',
        },
      }),
    });
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Generar PDF/ }));
    expect(await screen.findByText(/No se pudo generar el PDF/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /PDF listo/ })).toBeNull();
  });

  it('una respuesta que no es un PDF no se da por buena', async () => {
    open({ pdf: () => ({ status: 200, body: '<html>', type: 'text/html' }) });
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Generar PDF/ }));
    expect(await screen.findByText(/No se pudo generar el PDF/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /PDF listo/ })).toBeNull();
  });

  it('«Vista previa» abre el PDF real en un visor con «Descargar PDF»', async () => {
    open();
    renderApp(REPORTS_URL);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    const dialog = await screen.findByRole('dialog', { name: 'Vista previa del PDF' });
    expect(within(dialog).getByTitle('PDF del reporte').getAttribute('src')).toBe('blob:reporte');
    expect(within(dialog).getByRole('link', { name: /Descargar PDF/ })).toBeTruthy();
  });

  it('sin secciones no se puede generar; «Tickets adjuntos» requiere permiso de tickets', async () => {
    open({ permissions: OWNER_PERMISSIONS.filter((p) => p !== 'tickets.view') });
    renderApp(REPORTS_URL);
    await ready();
    expect(
      screen.getByRole('checkbox', { name: /Tickets adjuntos/ }).hasAttribute('disabled'),
    ).toBe(true);
    for (const name of [
      /Resumen ejecutivo/,
      /Métricas de rendimiento/,
      /Análisis por segmentos/,
      /Control operativo/,
      /Tabla de apuestas/,
      /Selecciones detalladas/,
      /Gráficos y tendencias/,
    ]) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    expect(screen.getByRole('button', { name: /Generar PDF/ }).hasAttribute('disabled')).toBe(true);
  });

  it('«Reporte ejecutivo completo» marca las siete secciones del informe y el PDF las pide', async () => {
    const { pdfQueries } = open();
    renderApp(REPORTS_URL);
    await ready();
    const preset = screen.getByRole('button', { name: 'Reporte ejecutivo completo' });
    expect(preset.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: /Análisis por segmentos/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Control operativo/ }));
    expect(preset.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/Páginas del informe:/).closest('p')!.textContent).not.toContain(
      'Segmentos',
    );
    fireEvent.click(preset);
    expect(preset.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Páginas del informe:/).closest('p')!.textContent).toContain(
      'Resumen ejecutivo · Análisis financiero · Segmentos · Control operativo · Detalle de apuestas',
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: /Generar PDF/ }));
    await screen.findByRole('button', { name: /PDF listo/ });
    expect(pdfQueries()[0]!.get('sections')).toBe(
      'summary,charts,metrics,segments,operations,table,selections',
    );
  });
});

describe('reportes: análisis detallado (lo que ya existía)', () => {
  it('muestra P/L, Yield, ROI y los desgloses con los filtros aplicados', async () => {
    open();
    renderApp(REPORTS_URL);
    const section = (await screen.findByRole('heading', { name: 'Análisis detallado' })).closest(
      'section',
    )!;
    expect(within(section).getByText('S/ 750.00')).toBeTruthy();
    expect(within(section).getByText('S/ 15.00')).toBeTruthy();
    expect(within(section).getByText('S/ 18.50')).toBeTruthy();
    // ROI y Yield con dos decimales y signo, igual que en el PDF (sin recalcular).
    expect(within(section).getByText('+2.71 %')).toBeTruthy();
    expect(within(section).getByText('+95.00 %')).toBeTruthy();
    expect(within(section).getByText('+75.00 %')).toBeTruthy();
    const preview = screen.getByRole('img', { name: 'Miniatura de la primera página del PDF' });
    expect(within(preview).getByText('+2.71 %')).toBeTruthy();
  });

  it('con una serie de rendimiento, muestra el drawdown máximo', async () => {
    open(
      {},
      {
        [`GET ${PERFORMANCE_URL}`]: {
          status: 200,
          body: {
            points: [
              {
                occurredAt: '2026-06-02T22:00:00.000Z',
                cumulativeProfitLoss: '19.00',
                drawdown: '0.00',
                drawdownPercent: null,
              },
            ],
            maxDrawdown: '12.50',
            maxDrawdownPercent: '25.00',
          },
        },
      },
    );
    renderApp(REPORTS_URL);
    expect(await screen.findByText('S/ 12.50')).toBeTruthy();
    expect(screen.getByText('25.00 %')).toBeTruthy();
  });

  it('se llega desde la barra lateral del proyecto («Reportes»)', async () => {
    open(
      {},
      {
        [`GET ${URL}/dashboard/status`]: apiError(500, 'INTERNAL_ERROR'),
        [`GET ${URL}/dashboard/bankroll-chart`]: apiError(500, 'INTERNAL_ERROR'),
        [`GET ${URL}/bets`]: { status: 200, body: [] },
      },
    );
    renderApp(URL);
    fireEvent.click(await screen.findByRole('link', { name: 'Reportes' }));
    expect(await screen.findByRole('heading', { name: 'Reportes' })).toBeTruthy();
  });
});
