import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

/*
 * Asistente de tres pasos de "Añadir apuesta": Paso 1 Añadir, Paso 2 Verificar datos, Paso 3 Confirmar
 * (ver ADR 0024). Las pruebas de campos y cifras viven en `BetsPage.spec.tsx`; aquí se comprueba el
 * recorrido completo: el caso real de Betano (Combinada de 4 con un leg creado), la edición de un leg
 * desde la verificación, el origen del resultado (IA o persona), los borradores y el registro seguro.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const BETS_URL = `${URL}/bets`;
const DRAFTS_URL = `${URL}/bet-drafts`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const TICKET_ID = '0195f7c0-0000-7000-8000-0000000000c1';
const DRAFT_ID = '0195f7c0-0000-7000-8000-0000000000d1';

const house = {
  id: HOUSE_A,
  projectId: PROJECT_ID,
  name: 'Betano',
  status: 'ACTIVE',
  balance: '500.00',
  committed: '0.00',
  available: '500.00',
  createdAt: '2026-06-01T12:00:00.000Z',
};
const stage = {
  id: STAGE_ID,
  projectId: PROJECT_ID,
  name: 'Etapa 1',
  unitStake: '2.00',
  status: 'ACTIVE',
  createdAt: '2026-06-01T12:00:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
};
const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  projectId: PROJECT_ID,
  betId: null,
  originalFileName: 'ticket.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 123,
  uploadedBy: { id: ANA.id, name: 'Ana Pérez' },
  createdAt: '2026-06-01T20:00:00.000Z',
  lastAnalysis: null,
  ...overrides,
});

const CREATED_BET = {
  status: 201,
  body: { id: 'nueva', projectId: PROJECT_ID, selections: [], tickets: [] },
};

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: {
      status: 200,
      body: projectDetail({ activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '2.00' } }),
    },
    [`GET ${URL}/houses`]: { status: 200, body: [house] },
    [`GET ${BETS_URL}`]: { status: 200, body: [] },
    [`GET ${URL}/stages`]: { status: 200, body: [stage] },
    [`GET ${DRAFTS_URL}`]: { status: 200, body: [] },
    ...extra,
  });
}

async function openForm(extra: Record<string, Handler> = {}) {
  const stub = open(extra);
  renderApp(BETS_URL);
  fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
  const form = screen.getByRole('form', { name: 'Añadir apuesta' });
  await within(form).findByRole('option', { name: 'Betano' });
  return { ...stub, form };
}

const change = (scope: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
const click = (scope: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(scope).getByRole('button', { name }));
const stepOf = (form: HTMLElement) =>
  ['Añadir apuesta', 'Verificar datos', 'Confirmar'].find(
    (name) => within(form).getByRole('button', { name }).getAttribute('aria-current') === 'step',
  );

/** Combinada de 4 de Betano: el leg 2 es una Creada con dos condiciones y UNA sola cuota (2.47). */
function fillBetano(form: HTMLElement) {
  change(form, 'Casa de apuestas', HOUSE_A);
  change(form, 'Fecha', '2026-10-10');
  change(form, 'Hora', '20:05');
  change(form, 'Tipo de apuesta', 'MULTIPLE');
  click(form, 'Añadir leg');
  click(form, 'Añadir leg');
  const legs: [string, string, string, string][] = [
    ['Universitario de Deportes - FBC Melgar', '2.15', 'Doble oportunidad', '1X'],
    ['Liverpool FC - Manchester City', '2.47', 'Resultado del partido', 'Manchester City'],
    ['SL Benfica - Vitória Guimarães', '1.21', 'Resultado del partido', 'SL Benfica'],
    ['Inter Miami CF - D.C. United', '1.31', 'Goles totales Más/Menos', 'Más de 4.5'],
  ];
  legs.forEach(([event, odds, market, pick], index) => {
    const n = index + 1;
    change(form, `Partido del leg ${n}`, event);
    change(form, `Cuota del leg ${n}`, odds);
    change(form, `Mercado del leg ${n}`, market);
    change(form, `Pronóstico del leg ${n}`, pick);
  });
  click(form, 'Convertir el leg 2 en Creada (añadir otra selección)');
  change(form, 'Mercado de la selección 2 del leg 2', 'Manchester City Más/Menos Córners');
  change(form, 'Pronóstico de la selección 2 del leg 2', 'Más de 2.5');
  change(form, 'Monto apostado', '10.00');
}

const betanoExtraction = (overrides: Record<string, unknown> = {}) => ({
  house: 'Betano',
  placedDate: '2026-10-10',
  placedTime: '20:05',
  betType: 'MULTIPLE',
  result: 'Perdida',
  officialAmount: '10.00',
  selections: [
    {
      event: 'Universitario de Deportes - FBC Melgar',
      market: 'Doble oportunidad',
      selection: '1X',
      visibleOdds: '2.15',
      legScore: '2-2',
    },
    {
      event: 'Liverpool FC - Manchester City',
      visibleOdds: '2.47',
      legScore: '0-3',
      conditions: [
        { market: 'Resultado del partido', selection: 'Manchester City' },
        { market: 'Manchester City Más/Menos Córners', selection: 'Más de 2.5' },
      ],
    },
    {
      event: 'SL Benfica - Vitória Guimarães',
      market: 'Resultado del partido',
      selection: 'SL Benfica',
      visibleOdds: '1.21',
    },
    {
      event: 'Inter Miami CF - D.C. United',
      market: 'Goles totales Más/Menos',
      selection: 'Más de 4.5',
      visibleOdds: '1.31',
    },
  ],
  ...overrides,
});

async function readTicket(extraction: Record<string, unknown>) {
  const stub = await openForm({
    [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
    [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: {
      status: 200,
      body: {
        id: 'an1',
        ticketId: TICKET_ID,
        version: 1,
        status: 'COMPLETED',
        provider: 'fake',
        model: 'fake-model',
        extraction,
        confidenceByField: null,
        errorMessage: null,
        analyzedBy: { id: ANA.id, name: 'Ana Pérez' },
        analyzedAt: '2026-06-01T20:01:00.000Z',
      },
    },
  });
  const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
  fireEvent.change(within(stub.form).getByLabelText('Adjuntar ticket'), {
    target: { files: [file] },
  });
  fireEvent.click(await within(stub.form).findByRole('button', { name: 'Leer ticket con IA' }));
  await within(stub.form).findByText(/Datos aplicados desde el ticket/);
  return stub;
}

const table = (form: HTMLElement) =>
  within(form).getByRole('region', { name: 'Selecciones de la apuesta' });

describe('Paso 2 — Verificar datos (caso real Betano, registro manual)', () => {
  it('muestra 4 legs y 5 condiciones: el leg 2 es UNA fila "Creada" con dos pronósticos y la cuota 2.47 una vez', async () => {
    const { form, calls } = await openForm();
    fillBetano(form);
    click(form, 'Siguiente');
    expect(stepOf(form)).toBe('Verificar datos');

    // Registro manual: encabezado y banda lo dicen; nada afirma que lo detectó la IA.
    expect(
      within(form).getByText('Revisa los datos introducidos antes de continuar.'),
    ).toBeTruthy();
    expect(within(form).getByText(/Registro manual\./)).toBeTruthy();
    expect(within(form).queryByText(/Detectado por IA/)).toBeNull();

    const selections = table(form);
    expect(
      within(selections).getByRole('heading', { name: 'Selecciones de la apuesta (4)' }),
    ).toBeTruthy();
    const rows = within(selections).getAllByRole('listitem', { name: /^Leg \d$/ });
    expect(rows).toHaveLength(4);
    expect(within(selections).queryByRole('listitem', { name: 'Leg 5' })).toBeNull();

    const leg2 = within(selections).getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg2).getByText('Creada')).toBeTruthy();
    expect(within(leg2).getByText('2 pronósticos')).toBeTruthy();
    const first = within(leg2).getByRole('listitem', { name: 'Selección 1 del leg 2' });
    const second = within(leg2).getByRole('listitem', { name: 'Selección 2 del leg 2' });
    expect(first.textContent).toContain('Manchester City — Resultado del partido');
    expect(second.textContent).toContain('Más de 2.5 — Manchester City Más/Menos Córners');
    // La cuota del leg aparece UNA sola vez; no se inventa ninguna cuota interna (p. ej. 1.52).
    expect(within(leg2).getAllByText('2.47')).toHaveLength(1);
    expect(selections.textContent).not.toContain('1.52');
    for (const [n, odds] of [
      [1, '2.15'],
      [3, '1.21'],
      [4, '1.31'],
    ] as const) {
      expect(
        within(within(selections).getByRole('listitem', { name: `Leg ${n}` })).getByText(odds),
      ).toBeTruthy();
    }
    // Nada se registró por llegar hasta aquí.
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('"Editar" abre solo las dos condiciones del leg 2; al cerrar, la tabla se actualiza y no se pierde nada', async () => {
    const { form, calls } = await openForm();
    fillBetano(form);
    click(form, 'Siguiente');

    click(form, 'Editar el leg 2');
    const dialog = screen.getByRole('dialog', { name: 'Editar leg 2' });
    // Solo ese leg: sus dos condiciones por separado, ni otros legs ni "Añadir leg".
    expect(within(dialog).getByLabelText('Pronóstico de la selección 1 del leg 2')).toBeTruthy();
    expect(within(dialog).getByLabelText('Pronóstico de la selección 2 del leg 2')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Partido del leg 1')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Añadir leg' })).toBeNull();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Cuota del leg 2').value).toBe('2.47');

    change(dialog, 'Pronóstico de la selección 2 del leg 2', 'Más de 3.5');
    // Escape cierra SOLO el diálogo: el asistente sigue abierto y conserva sus datos.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Editar leg 2' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Añadir apuesta' })).toBeTruthy();
    expect(stepOf(form)).toBe('Verificar datos');

    const leg2 = within(table(form)).getByRole('listitem', { name: 'Leg 2' });
    expect(leg2.textContent).toContain('Más de 3.5 — Manchester City Más/Menos Córners');
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
    // Editar no guarda nada en el servidor.
    expect(calls.some((c) => c.method === 'POST' || c.method === 'PUT')).toBe(false);
  });

  it('"Confirmar apuesta" del Paso 2 solo lleva al Paso 3; el registro definitivo es "Registrar apuesta"', async () => {
    const { form, calls } = await openForm({ [`POST ${BETS_URL}`]: CREATED_BET });
    fillBetano(form);
    click(form, 'Siguiente');
    // La cuota total no la muestra el ticket: se usa el producto SOLO como referencia calculada.
    click(form, /Usar el producto de las cuotas \(8\.42\) como referencia/);
    fireEvent.click(within(form).getByRole('button', { name: 'Perdido' }));
    click(form, 'Confirmar apuesta');
    expect(stepOf(form)).toBe('Confirmar');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // Paso 3: el ticket digital reconstruido, con la estructura y las cifras que se guardarán.
    const digital = within(form).getByRole('article', {
      name: 'Vista previa del ticket de LetFer',
    });
    expect(within(digital).getByText(/4 legs · 5 selecciones/)).toBeTruthy();
    expect(within(digital).getAllByText('2.47')).toHaveLength(1);
    expect(within(digital).getByText('Cuota total oficial').nextElementSibling!.textContent).toBe(
      '—',
    );
    expect(
      within(digital).getByText('Cuota calculada de referencia').nextElementSibling!.textContent,
    ).toBe('8.42');
    expect(within(digital).getByText('Importe apostado').nextElementSibling!.textContent).toBe(
      'S/ 10.00',
    );
    expect(within(digital).getByText('Stake').nextElementSibling!.textContent).toBe('5');

    click(form, 'Registrar apuesta');
    expect(
      await screen.findByText('Apuesta registrada correctamente (ya liquidada).'),
    ).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!.body as {
      stake: string;
      officialAmount: string;
      visibleTotalOdds: string;
      totalOddsSource: string;
      clientRequestId: string;
      settlement: { status: string };
      selections: { eventGroup: number; position: number; visibleOdds?: string }[];
    };
    expect(body).toMatchObject({
      stake: '5',
      officialAmount: '10.00',
      visibleTotalOdds: '8.42',
      totalOddsSource: 'CALCULATED',
      settlement: { status: 'LOST' },
    });
    expect(body.selections).toHaveLength(5);
    expect(new Set(body.selections.map((s) => s.eventGroup)).size).toBe(4);
    expect(body.selections.map((s) => s.visibleOdds)).toEqual([
      '2.15',
      '2.47',
      undefined,
      '1.21',
      '1.31',
    ]);
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Paso 2 — lectura de IA', () => {
  it('lectura completa: banda con 4 legs (nunca 5), insignia, resultado detectado y resumen', async () => {
    const { form } = await readTicket(betanoExtraction());
    click(form, 'Siguiente');
    expect(
      within(form).getByText(
        'Revisa los datos extraídos por IA y confirma que la información sea correcta.',
      ),
    ).toBeTruthy();
    expect(
      within(form).getByText(
        'Ticket leído por IA. Se han detectado 4 legs y el resultado de la apuesta. Verifica los datos antes de continuar.',
      ),
    ).toBeTruthy();
    expect(within(form).getByText(/Detectado por IA\. Verifica antes de confirmar\./)).toBeTruthy();
    expect(within(form).getByRole('heading', { name: 'Selecciones detectadas (4)' })).toBeTruthy();

    const result = within(form).getByRole('group', { name: 'Resultado' });
    expect(
      within(result).getByRole('button', { name: 'Perdido' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(form).getByText(/Resultado detectado por IA:/)).toBeTruthy();

    // El importe oficial manda y el stake se deriva (10.00 ÷ 2.00 = 5); la cuota es una referencia.
    const summary = within(form).getByRole('region', { name: 'Resumen' });
    expect(within(summary).getByText('Stake').nextElementSibling!.textContent).toContain('5');
    expect(within(summary).getByText('Monto apostado').nextElementSibling!.textContent).toContain(
      'S/ 10.00',
    );
    expect(within(summary).getByText('Cuota total').nextElementSibling!.textContent).toContain(
      'Calculada de referencia',
    );
    expect(within(summary).getByText('Resultado').nextElementSibling!.textContent).toBe('Perdido');
    expect(within(summary).getByText('Estado del análisis').nextElementSibling!.textContent).toBe(
      'Estructura validada',
    );
    // Una Creada dentro de la Múltiple sigue siendo UNA fila.
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
    expect(within(table(form)).getByText('2 pronósticos')).toBeTruthy();
  });

  it('lectura parcial: sin resultado ni monto, la banda avisa qué revisar y no es verde', async () => {
    const { form } = await readTicket(
      betanoExtraction({ result: undefined, officialAmount: undefined }),
    );
    click(form, 'Siguiente');
    const banner = within(form).getByText(/Ticket leído por IA con datos incompletos/);
    expect(banner.textContent).toContain('el monto o el stake');
    expect(banner.textContent).toContain('el resultado');
    expect(within(form).queryByText(/Verifica los datos antes de continuar\./)).toBeNull();
    // Sin resultado: sin definir (ni Pendiente ni Perdido por defecto) y el análisis pide revisión.
    expect(within(form).getByText(/Resultado sin definir/)).toBeTruthy();
    const summary = within(form).getByRole('region', { name: 'Resumen' });
    expect(within(summary).getByText('Estado del análisis').nextElementSibling!.textContent).toBe(
      'Revisión pendiente',
    );
  });

  it('si la persona elige el resultado, deja de decir que lo detectó la IA', async () => {
    const { form } = await readTicket(betanoExtraction());
    click(form, 'Siguiente');
    expect(within(form).getByText(/Resultado detectado por IA:/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Ganado' }));
    expect(within(form).queryByText(/Resultado detectado por IA:/)).toBeNull();
    expect(within(form).getByText('Resultado elegido: Ganado.')).toBeTruthy();
  });

  it('ticket subido sin analizar: banda informativa y ninguna cifra inventada', async () => {
    const { form } = await openForm({ [`POST ${URL}/tickets`]: { status: 201, body: ticket() } });
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    await within(form).findByText('Todavía no se analizó con IA.');
    click(form, 'Siguiente');
    expect(within(form).getByText(/Ticket adjunto sin analizar/)).toBeTruthy();
    expect(within(form).queryByText(/Detectado por IA/)).toBeNull();
    const summary = within(form).getByRole('region', { name: 'Resumen' });
    for (const label of ['Stake', 'Monto apostado', 'Cuota total', 'Monto potencial']) {
      expect(within(summary).getByText(label).nextElementSibling!.textContent).toBe('—');
    }
    // La imagen original se ve a la derecha con su botón para ampliarla.
    const original = within(form).getByRole('region', { name: 'Ticket original' });
    expect(within(original).getByRole('button', { name: 'Ver ticket' })).toBeTruthy();
  });

  it('registro manual sin imagen: el ticket original muestra un estado vacío, no una imagen de ejemplo', async () => {
    const { form } = await openForm();
    click(form, 'Siguiente');
    const original = within(form).getByRole('region', { name: 'Ticket original' });
    expect(within(original).getByText(/Registro manual: no hay imagen adjunta/)).toBeTruthy();
    expect(within(original).queryByRole('img')).toBeNull();
  });
});

describe('registro seguro', () => {
  it('un fallo de red conserva la clave de idempotencia (reintentar no duplica); un 4xx la renueva', async () => {
    let attempt = 0;
    const { form, calls } = await openForm({
      [`POST ${BETS_URL}`]: () => {
        attempt += 1;
        if (attempt === 1) return { status: 500, body: undefined };
        if (attempt === 2) return apiError(400, 'VALIDATION_FAILED');
        return CREATED_BET;
      },
    });
    fillBetano(form);
    click(form, 'Siguiente');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Confirmar apuesta');
    const keys = () =>
      calls
        .filter((c) => c.method === 'POST' && c.path === BETS_URL)
        .map((c) => (c.body as { clientRequestId: string }).clientRequestId);

    click(form, 'Registrar apuesta');
    await waitFor(() => expect(keys()).toHaveLength(1));
    await within(form).findByRole('button', { name: 'Registrar apuesta' });
    click(form, 'Registrar apuesta');
    await waitFor(() => expect(keys()).toHaveLength(2));
    // 500 ⇒ resultado incierto: mismo intento, misma clave.
    expect(keys()[1]).toBe(keys()[0]);

    await within(form).findByRole('button', { name: 'Registrar apuesta' });
    click(form, 'Registrar apuesta');
    await waitFor(() => expect(keys()).toHaveLength(3));
    // 400 ⇒ no se creó nada: el siguiente intento es otro (otra clave).
    expect(keys()[2]).not.toBe(keys()[1]);
    expect(await screen.findByText('Apuesta registrada correctamente.')).toBeTruthy();
  });
});

describe('borradores (ADR 0024)', () => {
  const draftPayload = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    format: 'MULTIPLE',
    houseId: HOUSE_A,
    placed: { date: '2026-10-10', time: '20:05' },
    placedTimeKnown: true,
    selections: [
      ['Universitario de Deportes - FBC Melgar', 0, 0, 'Doble oportunidad', '1X', '2.15'],
      ['Liverpool FC - Manchester City', 1, 0, 'Resultado del partido', 'Manchester City', '2.47'],
      [
        'Liverpool FC - Manchester City',
        1,
        1,
        'Manchester City Más/Menos Córners',
        'Más de 2.5',
        '',
      ],
      ['SL Benfica - Vitória Guimarães', 2, 0, 'Resultado del partido', 'SL Benfica', '1.21'],
    ].map(([event, eventGroup, position, market, selection, visibleOdds]) => ({
      eventGroup,
      position,
      sport: 'Fútbol',
      event,
      market,
      selection,
      visibleOdds,
      legScore: '',
      legResult: '',
      conditionStatus: '',
    })),
    totalOdds: '',
    oddsKindChoice: null,
    calculatedOdds: null,
    stake: '',
    customStake: false,
    status: 'PENDING',
    statusChosen: false,
    statusFromAi: false,
    settled: { date: '2026-10-10', time: '22:00' },
    profitOverride: null,
    officialAmount: '10.00',
    officialPotentialReturn: '',
    reason: '',
    ticketId: null,
    aiApplied: false,
    ...overrides,
  });
  const draftDetail = (version = 1, payload = draftPayload()) => ({
    id: DRAFT_ID,
    summary: 'Betano · Universitario de Deportes - FBC Melgar (+2)',
    ticketId: null,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    version,
    payload,
  });
  const summaryOfDraft = (() => {
    const { payload, ...rest } = draftDetail();
    void payload;
    return rest;
  })();

  it('"Guardar borrador" guarda (crea y luego actualiza) sin registrar ninguna apuesta', async () => {
    const { form, calls } = await openForm({
      [`POST ${DRAFTS_URL}`]: { status: 201, body: draftDetail(1) },
      [`PUT ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 200, body: draftDetail(2) },
    });
    fillBetano(form);
    click(form, 'Guardar borrador');
    expect(await within(form).findByText('Borrador guardado.')).toBeTruthy();
    const created = calls.find((c) => c.method === 'POST' && c.path === DRAFTS_URL)!.body as {
      payload: { selections: unknown[]; officialAmount: string; format: string };
      summary: string;
    };
    expect(created.payload).toMatchObject({ format: 'MULTIPLE', officialAmount: '10.00' });
    expect(created.payload.selections).toHaveLength(5);
    expect(created.summary).toContain('Universitario de Deportes - FBC Melgar');

    // Un cambio más y otro guardado actualiza el MISMO borrador, con su versión.
    change(form, 'Mercado del leg 1', 'Doble oportunidad (1X)');
    click(form, 'Guardar borrador');
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ version: 1 });
    expect(calls.some((c) => c.method === 'POST' && c.path === BETS_URL)).toBe(false);
  });

  it('salir con cambios sin guardar pide confirmación; "Guardar borrador y salir" guarda y cierra', async () => {
    const { form, calls } = await openForm({
      [`POST ${DRAFTS_URL}`]: { status: 201, body: draftDetail(1) },
    });
    change(form, 'Casa de apuestas', HOUSE_A);
    click(form, 'Cancelar');
    const dialog = screen.getByRole('dialog', { name: '¿Salir sin registrar la apuesta?' });
    expect(screen.getByRole('form', { name: 'Añadir apuesta' })).toBeTruthy();
    // "Seguir editando" vuelve al formulario sin perder nada.
    click(dialog, 'Seguir editando');
    expect(screen.queryByRole('dialog', { name: '¿Salir sin registrar la apuesta?' })).toBeNull();
    expect(within(form).getByLabelText<HTMLSelectElement>('Casa de apuestas').value).toBe(HOUSE_A);

    click(form, 'Cancelar');
    click(
      screen.getByRole('dialog', { name: '¿Salir sin registrar la apuesta?' }),
      'Guardar borrador y salir',
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull());
    expect(calls.some((c) => c.method === 'POST' && c.path === DRAFTS_URL)).toBe(true);
  });

  it('un formulario sin cambios se cierra sin preguntar', async () => {
    const { form } = await openForm();
    click(form, 'Cancelar');
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '¿Salir sin registrar la apuesta?' })).toBeNull();
  });

  it('la lista de borradores permite retomar uno (la estructura vuelve exacta) y descartarlo', async () => {
    const { calls } = open({
      [`GET ${DRAFTS_URL}`]: { status: 200, body: [summaryOfDraft] },
      [`GET ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 200, body: draftDetail(1) },
      [`DELETE ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 204, body: undefined },
    });
    renderApp(BETS_URL);
    const section = await screen.findByRole('region', { name: 'Borradores de apuesta' });
    expect(within(section).getByText(/no descuenta saldo ni aparece en tus informes/)).toBeTruthy();

    fireEvent.click(within(section).getByRole('button', { name: /^Retomar el borrador/ }));
    const form = await screen.findByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    expect(within(form).getByLabelText<HTMLSelectElement>('Casa de apuestas').value).toBe(HOUSE_A);
    expect(within(form).getByLabelText<HTMLInputElement>('Monto apostado').value).toBe('10.00');
    click(form, 'Siguiente');
    const leg2 = within(table(form)).getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg2).getByText('2 pronósticos')).toBeTruthy();
    expect(within(leg2).getAllByText('2.47')).toHaveLength(1);
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(3);
    // Retomarlo no cuenta como un cambio: cerrar sin tocar nada no pregunta.
    click(form, 'Atrás');
    click(form, 'Cancelar');
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: /^Descartar el borrador/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.path === `${DRAFTS_URL}/${DRAFT_ID}`),
      ).toBe(true),
    );
  });

  it('al registrar una apuesta retomada de un borrador, el borrador se descarta (y no queda en la lista)', async () => {
    const { calls } = open({
      [`GET ${DRAFTS_URL}`]: { status: 200, body: [summaryOfDraft] },
      [`GET ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 200, body: draftDetail(1) },
      [`DELETE ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 204, body: undefined },
      [`POST ${BETS_URL}`]: CREATED_BET,
    });
    renderApp(BETS_URL);
    const section = await screen.findByRole('region', { name: 'Borradores de apuesta' });
    fireEvent.click(within(section).getByRole('button', { name: /^Retomar el borrador/ }));
    const form = await screen.findByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    click(form, 'Siguiente');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Confirmar apuesta');
    click(form, 'Registrar apuesta');
    expect(await screen.findByText('Apuesta registrada correctamente.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `${DRAFTS_URL}/${DRAFT_ID}`)).toBe(
      true,
    );
  });
});

describe('rediseño de alta fidelidad del Paso 2 (referencia 01-OBJETIVO)', () => {
  const datos = (form: HTMLElement) =>
    within(form).getByRole('region', { name: 'Datos de la apuesta' });
  const summary = (form: HTMLElement) => within(form).getByRole('region', { name: 'Resumen' });
  const summaryValue = (form: HTMLElement, label: string) =>
    within(summary(form)).getByText(label).nextElementSibling!.textContent;

  it('"Editar ticket" y "Atrás" vuelven al Paso 1 sin perder nada; "Siguiente" recupera la verificación igual', async () => {
    const { form, calls } = await openForm();
    fillBetano(form);
    click(form, 'Siguiente');
    expect(stepOf(form)).toBe('Verificar datos');

    click(form, 'Editar ticket');
    expect(stepOf(form)).toBe('Añadir apuesta');
    expect(within(form).getByLabelText<HTMLTextAreaElement>('Partido del leg 1').value).toBe(
      'Universitario de Deportes - FBC Melgar',
    );
    expect(within(form).getByLabelText<HTMLInputElement>('Monto apostado').value).toBe('10.00');

    click(form, 'Siguiente');
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
    click(form, 'Atrás');
    expect(stepOf(form)).toBe('Añadir apuesta');
    expect(within(form).getByLabelText<HTMLSelectElement>('Casa de apuestas').value).toBe(HOUSE_A);
    // Ir y volver entre pasos no envía nada.
    expect(calls.some((c) => c.method === 'POST' || c.method === 'PUT')).toBe(false);
  });

  it('corregir en la verificación actualiza la fila, el resumen y el monto potencial con las mismas cifras', async () => {
    const { form } = await openForm();
    fillBetano(form);
    click(form, 'Siguiente');
    click(form, /Usar el producto de las cuotas \(8\.42\) como referencia/);
    expect(summaryValue(form, 'Monto apostado')).toContain('S/ 10.00');
    expect(summaryValue(form, 'Stake')).toContain('5');

    // El monto se corrige en la misma tarjeta (un único campo): el stake derivado y el potencial se recalculan.
    change(form, 'Monto apostado', '20.00');
    expect(summaryValue(form, 'Monto apostado')).toContain('S/ 20.00');
    expect(summaryValue(form, 'Stake')).toContain('10');
    const potential = within(datos(form)).getByRole('group', { name: 'Monto potencial' });
    expect(potential.textContent).toContain('S/ 168.40'); // 20.00 × 8.42
    expect(summaryValue(form, 'Monto potencial')).toContain('S/ 168.40');

    // Editar la cuota del leg 2 actualiza su fila (una sola cuota, sin duplicarla).
    click(form, 'Editar el leg 2');
    const dialog = screen.getByRole('dialog', { name: 'Editar leg 2' });
    change(dialog, 'Cuota del leg 2', '2.50');
    click(dialog, 'Listo');
    const leg2 = within(table(form)).getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg2).getAllByText('2.50')).toHaveLength(1);
    expect(within(leg2).queryByText('2.47')).toBeNull();
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
  });

  it('verificación compacta: sin ayudas del Paso 1, la procedencia de cuota y monto va dentro del campo', async () => {
    const { form } = await readTicket(betanoExtraction());
    // Paso 1: ayudas de edición visibles.
    expect(within(form).getByText('No conozco la hora exacta')).toBeTruthy();
    click(form, 'Siguiente');
    expect(within(form).queryByText('No conozco la hora exacta')).toBeNull();
    // La cuota ya tiene procedencia (calculada desde los legs): no se vuelve a preguntar, pero se rotula.
    expect(within(form).queryByRole('group', { name: 'Origen de la cuota total' })).toBeNull();
    expect(within(datos(form)).getByText('Calculada por LetFer')).toBeTruthy();
    expect(within(datos(form)).getByText('Monto oficial indicado')).toBeTruthy();
    expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe('8.42');
  });

  it('sin datos todavía, la verificación no muestra ninguna cifra financiera inventada', async () => {
    const { form } = await openForm();
    click(form, 'Siguiente');
    const potential = within(datos(form)).getByRole('group', { name: 'Monto potencial' });
    expect(potential.textContent).toContain('—');
    expect(within(form).getByLabelText<HTMLInputElement>('Monto apostado').value).toBe('');
    expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe('');
    for (const label of ['Stake', 'Monto apostado', 'Cuota total', 'Monto potencial']) {
      expect(summaryValue(form, label)).toBe('—');
    }
    expect(summaryValue(form, 'Resultado')).toBe('Sin definir');
    // Ningún resultado aparece marcado por defecto (tampoco Pendiente).
    const result = within(form).getByRole('group', { name: 'Resultado' });
    for (const button of within(result).getAllByRole('button')) {
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('una lectura de IA fallida no presenta nada como leído: ni banda de éxito, ni insignia, ni cifras', async () => {
    const { form } = await openForm({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: {
        status: 200,
        body: {
          id: 'an1',
          ticketId: TICKET_ID,
          version: 1,
          status: 'FAILED',
          provider: 'fake',
          model: 'fake-model',
          extraction: null,
          confidenceByField: null,
          errorMessage: 'No se pudo leer',
          analyzedBy: { id: ANA.id, name: 'Ana Pérez' },
          analyzedAt: '2026-06-01T20:01:00.000Z',
        },
      },
    });
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Leer ticket con IA' }));
    await within(form).findByText(/No pudimos leer el ticket/);
    click(form, 'Siguiente');
    expect(within(form).queryByText(/Ticket leído por IA/)).toBeNull();
    expect(within(form).getByText(/Ticket adjunto sin analizar/)).toBeTruthy();
    expect(within(form).queryByText(/Detectado por IA/)).toBeNull();
    expect(summaryValue(form, 'Estado del análisis')).not.toBe('Estructura validada');
    expect(summaryValue(form, 'Monto apostado')).toBe('—');
  });

  it('tras registrar, el aviso dice "Apuesta registrada correctamente" y ofrece "Ver apuesta"', async () => {
    const { form } = await openForm({ [`POST ${BETS_URL}`]: CREATED_BET });
    fillBetano(form);
    click(form, 'Siguiente');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Confirmar apuesta');
    click(form, 'Registrar apuesta');
    const notice = (await screen.findByText('Apuesta registrada correctamente.')).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(within(notice).getByRole('link', { name: 'Ver apuesta' }).getAttribute('href')).toBe(
      `${BETS_URL}/nueva`,
    );
  });
});
