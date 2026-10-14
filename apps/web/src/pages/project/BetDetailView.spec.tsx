import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const BET_ID = '0195f7c0-0000-7000-8000-0000000000b1';
const DETAIL_URL = `${URL}/bets/${BET_ID}`;
const HOUSE_ID = '0195f7c0-0000-7000-8000-0000000000a1';
const TICKET_ID = '0195f7c0-0000-7000-8000-0000000000c1';

const selection = (overrides: Record<string, unknown> = {}) => ({
  id: `sel-${Math.random()}`,
  eventGroup: 0,
  position: 0,
  sport: null,
  event: 'Real Madrid vs. Barcelona',
  market: null,
  selection: 'Real Madrid gana',
  visibleOdds: '1.95',
  legScore: null,
  legResult: null,
  conditionStatus: null,
  ...overrides,
});

const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  projectId: PROJECT_ID,
  betId: BET_ID,
  originalFileName: 'ticket.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 123,
  uploadedBy: { id: ANA.id, name: 'Ana Pérez' },
  createdAt: '2026-06-01T20:00:00.000Z',
  lastAnalysis: null,
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: BET_ID,
  projectId: PROJECT_ID,
  batchId: null,
  batchStatus: null,
  stageId: STAGE_ID,
  stageName: 'Etapa 1',
  houseId: HOUSE_ID,
  houseName: 'Betano',
  betType: 'SIMPLE',
  stake: '2.0000',
  officialAmount: null,
  effectiveAmount: '20.00',
  amountSource: 'CALCULATED',
  visibleTotalOdds: '1.95',
  totalOddsSource: 'UNKNOWN',
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
  events: ['Real Madrid vs. Barcelona'],
  sports: [],
  ticketCount: 0,
  selections: [selection()],
  tickets: [],
  ...overrides,
});

function open(body: Record<string, unknown> | Handler, extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail() },
    [`GET ${DETAIL_URL}`]:
      typeof body === 'object' && 'status' in body && 'body' in body
        ? (body as Handler)
        : { status: 200, body },
    ...extra,
  });
}

const section = (name: string) => screen.findByRole('region', { name });

describe('Ver apuesta (vista de detalle de solo lectura)', () => {
  it('Simple: cabecera, resumen financiero y un leg con evento, pronóstico y cuota', async () => {
    open(detail());
    renderApp(DETAIL_URL);
    const header = await section('Datos de la apuesta');
    expect(within(header).getByText('Betano')).toBeTruthy();
    expect(within(header).getByText('Pendiente')).toBeTruthy();
    expect(within(header).getByText('Tipo de apuesta').nextElementSibling!.textContent).toBe(
      'Simple',
    );
    expect(within(header).getByText('Etapa 1')).toBeTruthy();

    const money = await section('Resumen financiero');
    expect(within(money).getByText('Stake').nextElementSibling!.textContent).toBe('2');
    expect(within(money).getByText('Importe apostado').nextElementSibling!.textContent).toBe(
      'S/ 20.00',
    );
    expect(within(money).getByText('Cuota total').nextElementSibling!.textContent).toBe('1.95');
    // Pendiente: aún no hay retorno realizado ni ganancia.
    expect(within(money).getByText('Retorno realizado').nextElementSibling!.textContent).toBe('—');
    expect(within(money).getByText('Ganancia').nextElementSibling!.textContent).toBe('—');

    const structure = await section('Estructura de la apuesta');
    expect(within(structure).getByText('Simple')).toBeTruthy();
    const leg = within(structure).getByRole('listitem', { name: 'Leg 1' });
    expect(within(leg).getByText('Real Madrid vs. Barcelona')).toBeTruthy();
    expect(within(leg).getByText('Real Madrid gana')).toBeTruthy();
    expect(within(leg).getByText('1.95')).toBeTruthy();
  });

  it('Múltiple de 4: cuatro legs numerados, cada uno con su evento y su cuota', async () => {
    open(
      detail({
        betType: 'MULTIPLE',
        visibleTotalOdds: '8.42',
        selections: [
          selection({
            eventGroup: 0,
            event: 'Universitario - Melgar',
            selection: '1X',
            visibleOdds: '2.15',
          }),
          selection({
            eventGroup: 1,
            event: 'Liverpool - Manchester City',
            selection: 'Bet Builder',
            visibleOdds: '2.47',
          }),
          selection({
            eventGroup: 2,
            event: 'Benfica - Guimarães',
            selection: 'SL Benfica',
            visibleOdds: '1.21',
          }),
          selection({
            eventGroup: 3,
            event: 'Inter Miami - D.C. United',
            selection: 'Más de 4.5',
            visibleOdds: '1.31',
          }),
        ],
      }),
    );
    renderApp(DETAIL_URL);
    const structure = await section('Estructura de la apuesta');
    expect(within(structure).getByText('Múltiple de 4')).toBeTruthy();
    for (const [n, odds] of [
      [1, '2.15'],
      [2, '2.47'],
      [3, '1.21'],
      [4, '1.31'],
    ] as const) {
      const leg = within(structure).getByRole('listitem', { name: `Leg ${n}` });
      expect(within(leg).getByText(odds)).toBeTruthy();
    }
    expect(within(structure).queryByRole('listitem', { name: 'Leg 5' })).toBeNull();
  });

  it('caso real (Betano, Combinada de 4 perdida): 4 legs, 5 selecciones, marcadores, estados y referencia', async () => {
    const event = 'Liverpool FC - Manchester City';
    open(
      detail({
        betType: 'MULTIPLE',
        status: 'LOST',
        visibleTotalOdds: '8.42',
        totalOddsSource: 'CALCULATED',
        stake: '5.0000',
        officialAmount: '10.00',
        effectiveAmount: '10.00',
        amountSource: 'CONFIRMED',
        profitLoss: '-10.00',
        externalReference: 'BT-0001',
        selections: [
          selection({
            eventGroup: 0,
            event: 'Universitario de Deportes - FBC Melgar',
            market: 'Doble oportunidad',
            selection: '1X',
            visibleOdds: '2.15',
            legScore: '2-2',
          }),
          selection({
            eventGroup: 1,
            position: 0,
            event,
            market: 'Resultado del partido',
            selection: 'Manchester City',
            visibleOdds: '2.47',
            legScore: '0-3',
            legResult: 'LOST',
            conditionStatus: 'WON',
          }),
          selection({
            eventGroup: 1,
            position: 1,
            event,
            market: 'Manchester City Más/Menos Córners',
            selection: 'Más de 2.5',
            visibleOdds: null,
            conditionStatus: 'WON',
          }),
          selection({
            eventGroup: 2,
            event: 'SL Benfica - Vitória Guimarães',
            market: 'Resultado del partido',
            selection: 'SL Benfica',
            visibleOdds: '1.21',
            legScore: '2-0',
          }),
          selection({
            eventGroup: 3,
            event: 'Inter Miami CF - D.C. United',
            market: 'Goles totales Más/Menos',
            selection: 'Más de 4.5',
            visibleOdds: '1.31',
            legScore: '4-0',
          }),
        ],
        tickets: [ticket()],
      }),
    );
    renderApp(DETAIL_URL);
    const structure = await section('Estructura de la apuesta');
    expect(within(structure).getByText('Múltiple de 4')).toBeTruthy();
    expect(within(structure).getByText(/4 legs · 5 selecciones/)).toBeTruthy();
    expect(within(structure).queryByRole('listitem', { name: 'Leg 5' })).toBeNull();

    const leg2 = within(structure).getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg2).getAllByText('2.47')).toHaveLength(1);
    expect(within(leg2).getByText('0-3')).toBeTruthy();
    expect(within(leg2).getByText('Perdió')).toBeTruthy();
    const second = within(leg2).getByRole('listitem', { name: 'Selección 2 del leg 2' });
    expect(within(second).getByText('Más de 2.5')).toBeTruthy();
    expect(within(second).getByText('Ganó')).toBeTruthy(); // estado visible de la condición
    expect(within(structure).getByText('2-2')).toBeTruthy();

    // Referencia del ticket, y el ticket original JUNTO al reconstruido.
    const header = await section('Datos de la apuesta');
    expect(within(header).getByText('BT-0001')).toBeTruthy();
    const original = await section('Ticket original');
    expect(
      original.compareDocumentPosition(structure) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(structure.closest('article')!.parentElement!.parentElement).toBe(
      original.parentElement!.parentElement,
    );
    // 8.42 es la referencia calculada que se registró: NUNCA aparece como cuota oficial de Betano.
    const money = await section('Resumen financiero');
    expect(within(money).getByText('Cuota total oficial').nextElementSibling!.textContent).toBe(
      '—',
    );
    expect(
      within(money).getByText('Cuota calculada de referencia').nextElementSibling!.textContent,
    ).toBe('8.42');
    expect(within(money).getByText(/calculada por LetFer, no confirmada por la casa/)).toBeTruthy();
    expect(within(money).getByText(/calculado con una cuota de referencia/)).toBeTruthy();
    expect(within(money).getByText('Ganancia').nextElementSibling!.textContent).toBe('-S/ 10.00');
  });

  it('un leg con varias selecciones se dibuja como Creada: cuadros separados y la cuota del leg UNA vez', async () => {
    open(
      detail({
        betType: 'MULTIPLE',
        visibleTotalOdds: '5.31',
        selections: [
          selection({
            eventGroup: 0,
            event: 'Universitario - Melgar',
            selection: '1X',
            visibleOdds: '2.15',
          }),
          selection({
            eventGroup: 1,
            position: 0,
            event: 'Liverpool - Manchester City',
            market: 'Resultado del partido',
            selection: 'Manchester City',
            visibleOdds: '2.47',
          }),
          selection({
            eventGroup: 1,
            position: 1,
            event: 'Liverpool - Manchester City',
            market: 'Manchester City Más/Menos Córners',
            selection: 'Más de 2.5',
            visibleOdds: null,
          }),
        ],
      }),
    );
    renderApp(DETAIL_URL);
    const structure = await section('Estructura de la apuesta');
    expect(within(structure).getByText('Múltiple de 2')).toBeTruthy();
    const leg = within(structure).getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg).getByText(/Leg 2 · Creada/)).toBeTruthy();
    expect(within(leg).getByText('Cuota del leg')).toBeTruthy();
    // Dos cuadros de selección, y 2.47 aparece una sola vez en todo el leg.
    expect(within(leg).getByRole('listitem', { name: 'Selección 1 del leg 2' })).toBeTruthy();
    expect(within(leg).getByRole('listitem', { name: 'Selección 2 del leg 2' })).toBeTruthy();
    expect(within(leg).getAllByText('2.47')).toHaveLength(1);
    expect(within(leg).getByText('Manchester City')).toBeTruthy();
    expect(within(leg).getByText('Más de 2.5')).toBeTruthy();
    expect(within(leg).getByText('Resultado del partido')).toBeTruthy();
  });

  it('cuota total oficial: se rotula como oficial y no hay una referencia aparte', async () => {
    open(detail({ betType: 'MULTIPLE', visibleTotalOdds: '8.40', totalOddsSource: 'OFFICIAL' }));
    renderApp(DETAIL_URL);
    const money = await section('Resumen financiero');
    expect(within(money).getByText('Cuota total oficial').nextElementSibling!.textContent).toBe(
      '8.40',
    );
    expect(within(money).getByText('(oficial)', { selector: 'span' })).toBeTruthy();
    expect(within(money).queryByText('Cuota calculada de referencia')).toBeNull();
  });

  it('apuesta histórica de origen desconocido: se muestra sin afirmar que sea oficial ni calculada', async () => {
    open(detail({ visibleTotalOdds: '1.95', totalOddsSource: 'UNKNOWN' }));
    renderApp(DETAIL_URL);
    const money = await section('Resumen financiero');
    expect(within(money).getByText('Cuota total').nextElementSibling!.textContent).toBe('1.95');
    expect(within(money).getByText('(origen no verificado)')).toBeTruthy();
    expect(within(money).queryByText('Cuota total oficial')).toBeNull();
    expect(within(money).queryByText('Cuota calculada de referencia')).toBeNull();
  });

  it('liquidada: retorno realizado y ganancia; perdida muestra S/ 0.00 y la pérdida', async () => {
    open(
      detail({
        status: 'LOST',
        effectiveReturn: null,
        profitLoss: '-20.00',
        settledAt: '2026-06-01T22:00:00.000Z',
      }),
    );
    renderApp(DETAIL_URL);
    const money = await section('Resumen financiero');
    expect(within(money).getByText('Retorno realizado').nextElementSibling!.textContent).toBe(
      'S/ 0.00',
    );
    expect(within(money).getByText('Ganancia').nextElementSibling!.textContent).toBe('-S/ 20.00');
  });

  it('con ticket: muestra la imagen ampliable y el análisis sin datos técnicos ni errores internos', async () => {
    open(
      detail({
        ticketCount: 1,
        tickets: [
          ticket({
            lastAnalysis: {
              id: 'an1',
              ticketId: TICKET_ID,
              version: 2,
              status: 'FAILED',
              provider: 'anthropic',
              model: 'modelo-secreto-1',
              extraction: {},
              confidenceByField: null,
              errorMessage: 'ANTHROPIC_API_KEY=sk-ant-secreta stack at Object.<anonymous>',
              analyzedBy: { id: ANA.id, name: 'Ana Pérez' },
              analyzedAt: '2026-06-01T20:01:00.000Z',
            },
          }),
        ],
      }),
    );
    const { container } = renderApp(DETAIL_URL);
    const ticketSection = await section('Ticket original');
    expect(
      within(ticketSection).getByRole('button', { name: 'Ver ticket.jpg en grande' }),
    ).toBeTruthy();
    const analysis = within(ticketSection).getByLabelText('Análisis de IA');
    expect(within(analysis).getByText('No se pudo leer')).toBeTruthy();
    expect(within(analysis).getByText(/Análisis 2/)).toBeTruthy();
    const text = container.textContent ?? '';
    expect(text).not.toContain('sk-ant');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('modelo-secreto');
    expect(text).not.toContain('anthropic');
  });

  it('sin permiso para ver tickets no se muestra el ticket', async () => {
    open(detail({ ticketCount: 1, tickets: [ticket()] }), {
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          isOwner: false,
          myRole: 'READER',
          myPermissions: ['project.view', 'bets.view'],
        }),
      },
    });
    renderApp(DETAIL_URL);
    await section('Datos de la apuesta');
    expect(screen.queryByRole('region', { name: 'Ticket original' })).toBeNull();
  });

  it('es de solo lectura: ningún campo ni acción que modifique la apuesta', async () => {
    const { calls } = open(detail());
    renderApp(DETAIL_URL);
    await section('Estructura de la apuesta');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar|Eliminar|Liquidar/ })).toBeNull();
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('apuesta inexistente: lo explica y ofrece volver a la lista', async () => {
    open(apiError(404, 'NOT_FOUND'));
    renderApp(DETAIL_URL);
    expect(await screen.findByText('No encontramos esta apuesta.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Volver a Apuestas/ }).getAttribute('href')).toBe(
      `${URL}/bets`,
    );
  });

  it('desde la lista, "Ver apuesta" navega al detalle sin quitar las demás acciones', async () => {
    open(detail(), {
      [`GET ${URL}/bets`]: { status: 200, body: [detail()] },
      [`GET ${URL}/houses`]: { status: 200, body: [] },
      [`GET ${URL}/stages`]: { status: 200, body: [] },
    });
    renderApp(`${URL}/bets`);
    const link = await screen.findByRole('link', { name: /Ver apuesta de Betano/ });
    expect(link.getAttribute('href')).toBe(DETAIL_URL);
    // Siguen ahí: editar y eliminar.
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeTruthy();
    fireEvent.click(link);
    expect(await section('Estructura de la apuesta')).toBeTruthy();
  });
});
