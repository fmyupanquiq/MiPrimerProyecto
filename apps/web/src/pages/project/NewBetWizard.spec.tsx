import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
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
import { clickLegButton, closeLegDialog, fieldFor } from './wizard-test-helpers.js';

/*
 * Asistente de tres pasos de "Añadir apuesta" (ver ADR 0024, flujo definitivo 2026-10-15): Paso 1
 * Añadir (origen y archivo), Paso 2 Verificar datos (todo editable; "Continuar a confirmar" valida en
 * el cliente y avanza, sin escribir nada) y Paso 3 Confirmar, la revisión final de solo lectura
 * pintada con el payload validado; solo ahí "Registrar apuesta" registra. Si tiene éxito, el mismo
 * paso pasa a "Registro completado" pintado con la respuesta de la API. Las pruebas de campos y cifras viven en
 * `BetsPage.spec.tsx`; aquí se comprueba el recorrido completo: el caso real de Betano (Combinada de 4
 * con un leg creado), la edición de un leg desde la verificación, el origen del resultado (IA o
 * persona), los borradores y el registro seguro.
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

/** Fila de selección tal como la devuelve la API (`BetSelectionSummary`). */
const apiRow = (
  eventGroup: number,
  position: number,
  event: string,
  market: string,
  selection: string,
  visibleOdds: string | null,
) => ({
  id: `s${eventGroup}${position}`,
  eventGroup,
  position,
  sport: 'Fútbol',
  event,
  market,
  selection,
  visibleOdds,
  legScore: null,
  legResult: null,
  conditionStatus: null,
});

/**
 * `BetDetail` que devuelve la API al registrar el caso Betano (Múltiple de 4 con una Creada). El Paso
 * 3 se pinta SOLO con esto; `overrides` permite que la respuesta difiera del formulario a propósito.
 */
const registeredBet = (overrides: Record<string, unknown> = {}) => ({
  id: 'nueva',
  projectId: PROJECT_ID,
  batchId: null,
  batchStatus: null,
  stageId: STAGE_ID,
  stageName: 'Etapa 1',
  houseId: HOUSE_A,
  houseName: 'Betano',
  betType: 'MULTIPLE',
  stake: '5',
  officialAmount: '10.00',
  effectiveAmount: '10.00',
  amountSource: 'CONFIRMED',
  visibleTotalOdds: '8.42',
  totalOddsSource: 'CALCULATED',
  officialPotentialReturn: null,
  officialRealizedReturn: null,
  calculatedRealizedReturn: null,
  effectiveReturn: '0.00',
  returnSource: null,
  effectiveOdds: null,
  profitLoss: '-10.00',
  status: 'LOST',
  placedAt: '2026-10-11T01:05:00.000Z',
  placedTimeKnown: true,
  settledAt: '2026-10-11T03:00:00.000Z',
  settledTimeKnown: true,
  reason: null,
  externalReference: null,
  createdBy: { id: ANA.id, name: 'Ana Pérez' },
  createdAt: '2026-10-11T03:00:00.000Z',
  updatedAt: '2026-10-11T03:00:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
  events: ['Universitario de Deportes - FBC Melgar'],
  sports: ['Fútbol'],
  ticketCount: 0,
  selections: [
    apiRow(0, 0, 'Universitario de Deportes - FBC Melgar', 'Doble oportunidad', '1X', '2.15'),
    apiRow(
      1,
      0,
      'Liverpool FC - Manchester City',
      'Resultado del partido',
      'Manchester City',
      '2.47',
    ),
    apiRow(
      1,
      1,
      'Liverpool FC - Manchester City',
      'Manchester City Más/Menos Córners',
      'Más de 2.5',
      null,
    ),
    apiRow(2, 0, 'SL Benfica - Vitória Guimarães', 'Resultado del partido', 'SL Benfica', '1.21'),
    apiRow(3, 0, 'Inter Miami CF - D.C. United', 'Goles totales Más/Menos', 'Más de 4.5', '1.31'),
  ],
  tickets: [],
  ...overrides,
});

const CREATED_BET = { status: 201, body: registeredBet() };

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
  fireEvent.change(
    scope.getAttribute('role') === 'dialog'
      ? within(scope).getByLabelText(label)
      : fieldFor(scope, label),
    { target: { value } },
  );
const click = (scope: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(scope).getByRole('button', { name }));
/**
 * Cambia el origen (Paso 1): sigue siendo accesible desde cualquier paso (los pasos se ocultan, nunca
 * se desmontan). El indicador de pasos nunca salta hacia adelante (ver `WizardStepper`): para avanzar
 * del Paso 1 hace falta un botón real ("Continuar a verificar datos" en Manual); por eso, cuando el
 * origen no importa para la prueba, se pasa a Manual antes de avanzar.
 */
const toManual = (form: HTMLElement) =>
  fireEvent.click(within(form).getByRole('radio', { name: /^Manual/ }));
const toAi = (form: HTMLElement) =>
  fireEvent.click(within(form).getByRole('radio', { name: /^Ticket con IA/ }));
/** Avanza del Paso 1 al Paso 2 sin IA: pasa a Manual (si no lo está ya) y pulsa el botón real. */
const goVerify = (form: HTMLElement) => {
  toManual(form);
  click(form, 'Continuar a verificar datos');
};
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
  clickLegButton(form, 'Convertir el leg 2 en Creada (añadir otra selección)');
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
  fireEvent.click(await within(stub.form).findByRole('button', { name: 'Analizar y continuar' }));
  await within(stub.form).findByText(/Ticket leído por IA/);
  return stub;
}

const table = (form: HTMLElement) =>
  within(form).getByRole('region', { name: 'Selecciones de la apuesta' });

describe('Paso 2 — Verificar datos (caso real Betano, registro manual)', () => {
  it('muestra 4 legs y 5 condiciones: el leg 2 es UNA fila "Creada" con dos pronósticos y la cuota 2.47 una vez', async () => {
    const { form, calls } = await openForm();
    fillBetano(form);
    goVerify(form);
    expect(stepOf(form)).toBe('Verificar datos');

    // Registro manual: encabezado y banda lo dicen; nada afirma que lo detectó la IA.
    expect(
      within(form).getByText(
        'Completa los datos de tu apuesta y confirma que la información sea correcta.',
      ),
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
    goVerify(form);

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

  it('"Continuar a confirmar" valida sin registrar; la revisión del Paso 3 es la del payload validado; solo "Registrar apuesta" registra y "Registro completado" se pinta con la respuesta de la API', async () => {
    // La API responde con otra casa y otro stake que los del formulario: "Registro completado"
    // muestra los suyos, pero la revisión PREVIA (antes de registrar) muestra lo que se enviará.
    const { form, calls } = await openForm({
      [`POST ${BETS_URL}`]: {
        status: 201,
        body: registeredBet({ houseName: 'Betano Perú', stake: '6' }),
      },
    });
    fillBetano(form);
    closeLegDialog();
    goVerify(form);
    // La cuota total no la muestra el ticket: se usa el producto SOLO como referencia calculada.
    click(form, /Usar el producto de las cuotas \(8\.42\) como referencia/);
    fireEvent.click(within(form).getByRole('button', { name: 'Perdido' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // "Continuar a confirmar" (type="button") valida y avanza: nunca escribe en la API.
    click(form, 'Continuar a confirmar');
    expect(stepOf(form)).toBe('Confirmar');
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);

    // La revisión es de solo lectura y sale del payload validado (la casa elegida, Betano; no
    // "Betano Perú", que solo existe en la respuesta simulada de la API).
    const review = within(form).getByRole('article', { name: 'Vista previa del ticket digital' });
    expect(within(review).getByRole('heading', { name: 'Betano' })).toBeTruthy();
    expect(within(review).getByText('Múltiple de 4')).toBeTruthy();
    // Sin campos editables ni botones de edición: nada se cambia en este paso.
    expect(within(review).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(review).queryByRole('button', { name: /Editar/ })).toBeNull();
    // Legs: la Creada es UN leg con dos condiciones y su cuota UNA sola vez (las condiciones no llevan).
    expect(within(review).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
    const reviewLeg2 = within(review).getByRole('listitem', { name: 'Leg 2' });
    expect(within(reviewLeg2).getByText(/Leg 2 · Creada/)).toBeTruthy();
    expect(within(reviewLeg2).getAllByRole('listitem', { name: /del leg 2$/ })).toHaveLength(2);
    expect(within(reviewLeg2).getAllByText('2.47')).toHaveLength(1);
    // Resumen financiero con su procedencia: cuota CALCULADA nunca como oficial, monto oficial.
    const money = within(review).getByRole('region', { name: 'Resumen financiero' });
    expect(within(money).getByText('Importe apostado').nextElementSibling!.textContent).toBe(
      'S/ 10.00',
    );
    expect(within(money).getByText('Cuota calculada de referencia')).toBeTruthy();
    expect(within(money).getByText('Cuota total oficial').nextElementSibling!.textContent).toBe(
      '—',
    );
    expect(within(money).getByText('Pérdida').nextElementSibling!.textContent).toBe('-S/ 10.00');
    expect(
      within(form).getByRole('region', { name: 'Impacto del registro' }).textContent,
    ).toContain('Disponible después');
    // Se puede volver a corregir: el indicador no queda bloqueado hasta que se registre con éxito.
    expect(
      within(form).getByRole<HTMLButtonElement>('button', { name: 'Verificar datos' }).disabled,
    ).toBe(false);
    expect(
      within(form).getByRole<HTMLButtonElement>('button', { name: 'Añadir apuesta' }).disabled,
    ).toBe(false);
    // Se puede volver a corregir: el indicador no queda bloqueado hasta que se registre con éxito.
    expect(
      within(form).getByRole<HTMLButtonElement>('button', { name: 'Verificar datos' }).disabled,
    ).toBe(false);
    expect(
      within(form).getByRole<HTMLButtonElement>('button', { name: 'Añadir apuesta' }).disabled,
    ).toBe(false);

    // Solo "Registrar apuesta" (Paso 3, antes del éxito) valida y registra.
    click(form, 'Registrar apuesta');
    expect(await screen.findByRole('heading', { name: 'Registro completado' })).toBeTruthy();
    expect(stepOf(form)).toBe('Confirmar');
    // Desde el "Registro completado" ya no se vuelve: ningún paso del indicador es navegable.
    for (const name of ['Añadir apuesta', 'Verificar datos', 'Confirmar']) {
      expect(within(form).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
    const done = within(form).getByRole('region', { name: 'Registro completado' });
    expect(within(done).getByText('Betano Perú')).toBeTruthy();
    expect(within(done).getByText('Stake').nextElementSibling!.textContent).toBe('6');
    expect(within(done).getByText('Perdido')).toBeTruthy();
    // Selecciones registradas: 4 legs, la Creada como una fila con su cuota UNA vez.
    const registered = within(form).getByRole('region', { name: 'Selecciones registradas' });
    expect(within(registered).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
    const leg2 = within(registered).getByRole('listitem', { name: 'Leg 2' });
    expect(within(leg2).getByText('Creada')).toBeTruthy();
    expect(within(leg2).getByText('2 pronósticos')).toBeTruthy();
    expect(within(leg2).getAllByText('2.47')).toHaveLength(1);

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

    // Cerrar no pide confirmación: ya no hay nada sin guardar.
    fireEvent.click(within(form).getAllByRole('button', { name: 'Cerrar' })[0]!);
    expect(screen.queryByRole('dialog', { name: '¿Salir sin registrar la apuesta?' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
  });
});

describe('Paso 2 — lectura de IA', () => {
  it('lectura completa: banda con 4 legs (nunca 5), insignia, resultado detectado y resumen', async () => {
    const { form } = await readTicket(betanoExtraction());
    click(form, 'Verificar datos');
    expect(
      within(form).getByText(
        'Revisa los datos extraídos por IA y confirma que la información sea correcta.',
      ),
    ).toBeTruthy();
    // Cuenta LEGS (4), nunca condiciones (5).
    expect(
      within(form).getByText('Ticket leído por IA.').closest('[role="status"]')!.textContent,
    ).toBe(
      'Ticket leído por IA. Se han detectado 4 selecciones y el resultado de la apuesta. Verifica los datos y confirma el registro.',
    );
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
    click(form, 'Verificar datos');
    const banner = within(form)
      .getByText(/Ticket leído por IA con datos incompletos/)
      .closest('[role="status"]')!;
    expect(banner.textContent).toContain('el monto o el stake');
    expect(banner.textContent).toContain('el resultado');
    expect(within(form).queryByText(/Verifica los datos y confirma el registro/)).toBeNull();
    // Sin resultado: sin definir (ni Pendiente ni Perdido por defecto) y el análisis pide revisión.
    expect(within(form).getByText(/Resultado sin definir/)).toBeTruthy();
    const summary = within(form).getByRole('region', { name: 'Resumen' });
    expect(within(summary).getByText('Estado del análisis').nextElementSibling!.textContent).toBe(
      'Revisión pendiente',
    );
  });

  it('si la persona elige el resultado, deja de decir que lo detectó la IA', async () => {
    const { form } = await readTicket(betanoExtraction());
    click(form, 'Verificar datos');
    expect(within(form).getByText(/Resultado detectado por IA:/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Ganado' }));
    expect(within(form).queryByText(/Resultado detectado por IA:/)).toBeNull();
    expect(within(form).getByText('Resultado elegido: Ganado.')).toBeTruthy();
  });

  it('ticket subido sin analizar: banda informativa y ninguna cifra inventada', async () => {
    const { form } = await openForm({ [`POST ${URL}/tickets`]: { status: 201, body: ticket() } });
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(fieldFor(form, 'Adjuntar ticket'), { target: { files: [file] } });
    await within(form).findByText('Listo para analizar');
    // Avanzar sin analizar (nunca se analiza salvo con "Analizar y continuar", D-T4): se pasa a
    // Manual para llegar a "Verificar datos" y se vuelve a IA, con el ticket intacto y sin leer.
    toManual(form);
    click(form, 'Continuar a verificar datos');
    toAi(form);
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

  it('registro manual sin imagen: la columna del ticket muestra un estado vacío (nunca una imagen de ejemplo)', async () => {
    const { form } = await openForm();
    fireEvent.click(within(form).getByRole('radio', { name: /Manual/ }));
    click(form, 'Continuar a verificar datos');
    const backup = within(form).getByRole('region', { name: 'Ticket de respaldo' });
    expect(within(backup).getByText('Sin ticket de respaldo')).toBeTruthy();
    expect(within(backup).queryByRole('img')).toBeNull();
    // "Adjuntar respaldo" lleva al Paso 1, donde se sube.
    fireEvent.click(within(backup).getByRole('button', { name: 'Adjuntar respaldo' }));
    expect(stepOf(form)).toBe('Añadir apuesta');
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
    goVerify(form);
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Continuar a confirmar');
    const keys = () =>
      calls
        .filter((c) => c.method === 'POST' && c.path === BETS_URL)
        .map((c) => (c.body as { clientRequestId: string }).clientRequestId);

    // Un intento fallido nunca avanza de paso: "Registrar apuesta" sigue en el mismo Paso 3.
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
    expect(fieldFor<HTMLSelectElement>(form, 'Casa de apuestas').value).toBe(HOUSE_A);

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
    expect(fieldFor<HTMLSelectElement>(form, 'Casa de apuestas').value).toBe(HOUSE_A);
    expect(fieldFor<HTMLInputElement>(form, 'Monto apostado').value).toBe('10.00');
    // El borrador no tiene ticket: el origen vuelve a ser Manual (`draftEntryMode`), con su botón real.
    click(form, 'Continuar a verificar datos');
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

  it('el borrador retomado solo se descarta tras un registro correcto (no al continuar ni si el registro falla)', async () => {
    let attempts = 0;
    const { calls } = open({
      [`GET ${DRAFTS_URL}`]: { status: 200, body: [summaryOfDraft] },
      [`GET ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 200, body: draftDetail(1) },
      [`DELETE ${DRAFTS_URL}/${DRAFT_ID}`]: { status: 204, body: undefined },
      [`POST ${BETS_URL}`]: () => (++attempts === 1 ? apiError(500, 'INTERNAL') : CREATED_BET),
    });
    const discarded = () =>
      calls.some((c) => c.method === 'DELETE' && c.path === `${DRAFTS_URL}/${DRAFT_ID}`);
    renderApp(BETS_URL);
    const section = await screen.findByRole('region', { name: 'Borradores de apuesta' });
    fireEvent.click(within(section).getByRole('button', { name: /^Retomar el borrador/ }));
    const form = await screen.findByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    click(form, 'Continuar a verificar datos');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Continuar a confirmar');
    expect(discarded()).toBe(false);
    click(form, 'Registrar apuesta');
    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(discarded()).toBe(false);
    click(form, 'Registrar apuesta');
    expect(await screen.findByText('Apuesta registrada correctamente.')).toBeTruthy();
    await waitFor(() => expect(discarded()).toBe(true));
  });
});

describe('rediseño de alta fidelidad del Paso 2 (referencia 01-OBJETIVO)', () => {
  const datos = (form: HTMLElement) =>
    within(form).getByRole('region', { name: 'Datos de la apuesta' });
  const summary = (form: HTMLElement) => within(form).getByRole('region', { name: 'Resumen' });
  const summaryValue = (form: HTMLElement, label: string) =>
    within(summary(form)).getByText(label).nextElementSibling!.textContent;

  it('"Editar ticket" y "Atrás" vuelven al Paso 1 sin perder nada; el indicador recupera la verificación igual', async () => {
    const { form, calls } = await openForm({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
    });
    // Un respaldo (modo Manual: nunca se analiza) para que exista "Editar ticket".
    fireEvent.click(within(form).getByRole('radio', { name: /Manual/ }));
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    await within(form).findByText('Archivo adjunto');
    fillBetano(form);
    closeLegDialog();
    click(form, 'Continuar a verificar datos');
    expect(stepOf(form)).toBe('Verificar datos');

    click(form, 'Editar ticket');
    expect(stepOf(form)).toBe('Añadir apuesta');
    expect(fieldFor<HTMLInputElement>(form, 'Monto apostado').value).toBe('10.00');

    click(form, 'Continuar a verificar datos');
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);
    click(form, 'Atrás');
    expect(stepOf(form)).toBe('Añadir apuesta');
    expect(fieldFor<HTMLSelectElement>(form, 'Casa de apuestas').value).toBe(HOUSE_A);
    // Ir y volver entre pasos no envía nada (solo la subida del respaldo, nunca un análisis).
    expect(calls.some((c) => c.path.endsWith('/analyze'))).toBe(false);
    expect(calls.some((c) => c.method === 'POST' && c.path === BETS_URL)).toBe(false);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('corregir en la verificación actualiza la fila, el resumen y el monto potencial con las mismas cifras', async () => {
    const { form } = await openForm();
    fillBetano(form);
    click(form, 'Verificar datos');
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
    // Las ayudas largas (hora desconocida, zona, disponible) viven en "Datos opcionales", plegado.
    expect(
      within(form)
        .getByRole('button', { name: /Datos opcionales/ })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    // La cuota ya tiene procedencia (calculada desde los legs): no se vuelve a preguntar, pero se rotula.
    expect(within(form).queryByRole('group', { name: 'Origen de la cuota total' })).toBeNull();
    expect(within(datos(form)).getByText('Calculada por LetFer')).toBeTruthy();
    expect(within(datos(form)).getByText('Monto oficial indicado')).toBeTruthy();
    expect(fieldFor<HTMLInputElement>(form, 'Cuota total visible').value).toBe('8.42');
  });

  it('sin datos todavía, la verificación no muestra ninguna cifra financiera inventada', async () => {
    const { form } = await openForm();
    click(form, 'Verificar datos');
    const potential = within(datos(form)).getByRole('group', { name: 'Monto potencial' });
    expect(potential.textContent).toContain('—');
    expect(fieldFor<HTMLInputElement>(form, 'Monto apostado').value).toBe('');
    expect(fieldFor<HTMLInputElement>(form, 'Cuota de la selección 1').value).toBe('');
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
    fireEvent.change(fieldFor(form, 'Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Analizar y continuar' }));
    await within(form).findByText(/No pudimos leer el ticket/);
    // El fallo deja el ticket sin leer, en modo IA: para verificar sin perder ese estado se pasa a
    // Manual, se avanza con su botón real y se vuelve a IA (el ticket sigue sin analizar).
    toManual(form);
    click(form, 'Continuar a verificar datos');
    toAi(form);
    expect(within(form).queryByText(/Ticket leído por IA/)).toBeNull();
    expect(within(form).getByText(/Ticket adjunto sin analizar/)).toBeTruthy();
    expect(within(form).queryByText(/Detectado por IA/)).toBeNull();
    expect(summaryValue(form, 'Estado del análisis')).not.toBe('Estructura validada');
    expect(summaryValue(form, 'Monto apostado')).toBe('—');
  });

  const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET');
  const reviewMoney = (form: HTMLElement) =>
    within(
      within(form).getByRole('article', { name: 'Vista previa del ticket digital' }),
    ).getByRole('region', { name: 'Resumen financiero' });
  /** Caso Betano en el Paso 2, con la cuota de referencia declarada y listo para continuar. */
  async function betanoInVerify(extra: Record<string, Handler> = {}) {
    const stub = await openForm(extra);
    fillBetano(stub.form);
    closeLegDialog();
    goVerify(stub.form);
    click(stub.form, /Usar el producto de las cuotas/);
    return stub;
  }

  it('Paso 2 → Paso 3 no escribe nada; "Atrás" conserva todo y corregir un dato actualiza la revisión', async () => {
    const { form, calls } = await betanoInVerify();
    fireEvent.click(within(form).getByRole('button', { name: 'Perdido' }));
    click(form, 'Continuar a confirmar');
    expect(stepOf(form)).toBe('Confirmar');
    expect(writes(calls)).toHaveLength(0); // ni apuesta, ni movimientos, ni borrador
    expect(within(reviewMoney(form)).getByText('Pérdida').nextElementSibling!.textContent).toBe(
      '-S/ 10.00',
    );

    click(form, 'Atrás');
    expect(stepOf(form)).toBe('Verificar datos');
    expect(
      within(form).queryByRole('article', { name: 'Vista previa del ticket digital' }),
    ).toBeNull();
    expect(fieldFor<HTMLInputElement>(form, 'Monto apostado').value).toBe('10.00');
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);

    // Se corrige el resultado: la nueva revisión sale del payload nuevo (10.00 × 8.42).
    fireEvent.click(within(form).getByRole('button', { name: 'Ganado' }));
    click(form, 'Continuar a confirmar');
    const money = reviewMoney(form);
    expect(within(money).getByText('Retorno realizado').nextElementSibling!.textContent).toBe(
      'S/ 84.20',
    );
    expect(within(money).getByText('Ganancia').nextElementSibling!.textContent).toBe('+S/ 74.20');
    expect(writes(calls)).toHaveLength(0);
  });

  it('"Continuar a confirmar" valida: si falta algo se queda en el Paso 2 con el error y sin escribir', async () => {
    const { form, calls } = await openForm();
    fillBetano(form);
    closeLegDialog();
    goVerify(form);
    // Falta declarar la procedencia de la cuota total.
    click(form, 'Continuar a confirmar');
    expect(stepOf(form)).toBe('Verificar datos');
    expect(within(form).getByText(/Indica si la cuota total la muestra la casa/)).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Registrar apuesta' })).toBeNull();
    expect(writes(calls)).toHaveLength(0);
  });

  it('solo "Registrar apuesta" registra: ni Enter ni un envío del formulario en los Pasos 2 y 3; tras el éxito nada más escribe', async () => {
    const { form, calls } = await betanoInVerify({ [`POST ${BETS_URL}`]: CREATED_BET });
    fireEvent.keyDown(fieldFor(form, 'Monto apostado'), { key: 'Enter' });
    fireEvent.submit(form);
    click(form, 'Continuar a confirmar');
    fireEvent.submit(form); // sin el botón "Registrar apuesta" como origen: no registra
    await Promise.resolve();
    expect(writes(calls)).toHaveLength(0);

    click(form, 'Registrar apuesta');
    expect(within(form).getByRole('button', { name: 'Registrando apuesta…' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Registro completado' })).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);

    // "Registro completado" no es un cuarto paso, ni vuelve atrás, ni deja nada que escriba.
    expect(stepOf(form)).toBe('Confirmar');
    expect(within(form).queryByRole('button', { name: 'Registrar apuesta' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Atrás' })).toBeNull();
    for (const name of ['Ver apuesta', 'Ver historial', 'Registrar otra apuesta', 'Cerrar']) {
      expect(within(form).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    fireEvent.submit(form);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
  });

  it('un fallo de la API deja la revisión y los datos intactos; reintentar (5xx) usa la misma clave y no duplica', async () => {
    let attempts = 0;
    const { form, calls } = await betanoInVerify({
      [`POST ${BETS_URL}`]: () => (++attempts === 1 ? apiError(500, 'INTERNAL') : CREATED_BET),
    });
    click(form, 'Continuar a confirmar');
    click(form, 'Registrar apuesta');
    expect(await within(form).findByRole('alert')).toBeTruthy();
    // Sigue en la revisión del Paso 3, con todo: no se afirma ningún registro.
    expect(stepOf(form)).toBe('Confirmar');
    expect(
      within(form).getByRole('article', { name: 'Vista previa del ticket digital' }),
    ).toBeTruthy();
    expect(within(form).queryByRole('heading', { name: 'Registro completado' })).toBeNull();

    click(form, 'Registrar apuesta');
    expect(await screen.findByRole('heading', { name: 'Registro completado' })).toBeTruthy();
    const posted = calls.filter((c) => c.method === 'POST' && c.path === BETS_URL);
    expect(posted).toHaveLength(2);
    const keys = posted.map((c) => (c.body as { clientRequestId: string }).clientRequestId);
    expect(keys[1]).toBe(keys[0]);
  });

  it('tras registrar, el Paso 3 dice "Apuesta registrada correctamente" y, al cerrar, el aviso ofrece "Ver apuesta"', async () => {
    const { form } = await openForm({ [`POST ${BETS_URL}`]: CREATED_BET });
    fillBetano(form);
    closeLegDialog();
    goVerify(form);
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Continuar a confirmar');
    click(form, 'Registrar apuesta');
    expect(await within(form).findByText('Apuesta registrada correctamente.')).toBeTruthy();
    fireEvent.click(within(form).getAllByRole('button', { name: 'Cerrar' })[0]!);
    const notice = (await screen.findByText('Apuesta registrada correctamente.')).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(within(notice).getByRole('link', { name: 'Ver apuesta' }).getAttribute('href')).toBe(
      `${BETS_URL}/nueva`,
    );
  });
});

describe('rediseño de los tres pasos: Paso 1 (origen y archivo) y Paso 3 (registro completado)', () => {
  const upload = (form: HTMLElement, name = 'ticket.jpg', type = 'image/jpeg') =>
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), {
      target: { files: [new File(['contenido'], name, { type })] },
    });
  const analysisResponse = (status: 'COMPLETED' | 'FAILED', extraction: unknown) => ({
    status: 200,
    body: {
      id: 'an1',
      ticketId: TICKET_ID,
      version: 1,
      status,
      provider: 'fake',
      model: 'fake-model',
      extraction,
      confidenceByField: null,
      errorMessage: status === 'FAILED' ? 'No se pudo leer' : null,
      analyzedBy: { id: ANA.id, name: 'Ana Pérez' },
      analyzedAt: '2026-06-01T20:01:00.000Z',
    },
  });
  const analyzeCalls = (calls: { method: string; path: string }[]) =>
    calls.filter((c) => c.method === 'POST' && c.path.endsWith('/analyze'));
  const radio = (form: HTMLElement, name: RegExp) => within(form).getByRole('radio', { name });
  const postedBets = (calls: { method: string; path: string; body?: unknown }[]) =>
    calls
      .filter((c) => c.method === 'POST' && c.path === BETS_URL)
      .map((c) => c.body as { clientRequestId: string; ticketId?: string });

  it('modo IA: "Analizar y continuar" exige un archivo; con él analiza UNA vez, aplica la lectura y pasa a Verificar datos', async () => {
    const { form, calls } = await openForm({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: analysisResponse(
        'COMPLETED',
        betanoExtraction(),
      ),
    });
    expect(radio(form, /^Ticket con IA/).getAttribute('aria-checked')).toBe('true');
    const analyze = () =>
      within(form).getByRole<HTMLButtonElement>('button', { name: 'Analizar y continuar' });
    expect(analyze().disabled).toBe(true);
    expect(within(form).getByText('Esperando ticket')).toBeTruthy();

    upload(form);
    await within(form).findByText('Listo para analizar');
    expect(within(form).getByText('Pendiente de análisis')).toBeTruthy();
    // Subir nunca analiza (D-T4): solo "Analizar y continuar".
    expect(analyzeCalls(calls)).toHaveLength(0);

    fireEvent.click(analyze());
    await within(form).findByText('Ticket leído por IA.');
    expect(stepOf(form)).toBe('Verificar datos');
    expect(analyzeCalls(calls)).toHaveLength(1);
    expect(within(table(form)).getAllByRole('listitem', { name: /^Leg \d$/ })).toHaveLength(4);

    // Volver al Paso 1 con la lectura ya aplicada no gasta otro análisis: "Continuar".
    fireEvent.click(within(form).getByRole('button', { name: /Añadir apuesta/ }));
    expect(within(form).getByText('Ticket analizado')).toBeTruthy();
    click(form, 'Continuar');
    expect(stepOf(form)).toBe('Verificar datos');
    expect(analyzeCalls(calls)).toHaveLength(1);
  });

  it('si el análisis falla: se queda en el Paso 1 con "Reintentar" y "Continuar en modo Manual", que conserva la imagen y no vuelve a analizar', async () => {
    const { form, calls } = await openForm({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: analysisResponse('FAILED', null),
    });
    upload(form);
    await within(form).findByText('Listo para analizar');
    click(form, 'Analizar y continuar');
    expect(await within(form).findByText('No se pudo analizar el ticket')).toBeTruthy();
    expect(stepOf(form)).toBe('Añadir apuesta');
    expect(within(form).queryByText('Ticket leído por IA.')).toBeNull();
    expect(within(form).getByRole('button', { name: 'Reintentar' })).toBeTruthy();

    click(form, 'Continuar en modo Manual');
    expect(radio(form, /^Manual/).getAttribute('aria-checked')).toBe('true');
    // La imagen sigue, ahora como respaldo (no analizada).
    expect(within(form).getByText('Archivo adjunto')).toBeTruthy();
    click(form, 'Continuar a verificar datos');
    expect(stepOf(form)).toBe('Verificar datos');
    expect(within(form).getByRole('region', { name: 'Ticket de respaldo' })).toBeTruthy();
    expect(analyzeCalls(calls)).toHaveLength(1);
  });

  it('modo Manual con respaldo: sube la imagen, NUNCA la analiza y al registrar la vincula con ticketId', async () => {
    const { form, calls } = await openForm({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${BETS_URL}`]: CREATED_BET,
    });
    fireEvent.click(radio(form, /^Manual/));
    expect(within(form).queryByRole('region', { name: 'La IA detectará' })).toBeNull();
    upload(form);
    await within(form).findByText('Archivo adjunto');
    expect(within(form).queryByRole('button', { name: /Analizar/ })).toBeNull();

    fillBetano(form);
    closeLegDialog();
    click(form, 'Continuar a verificar datos');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Continuar a confirmar');
    click(form, 'Registrar apuesta');
    await screen.findByRole('heading', { name: 'Registro completado' });
    expect(analyzeCalls(calls)).toHaveLength(0);
    expect(postedBets(calls)[0]!.ticketId).toBe(TICKET_ID);
  });

  it('cambiar de origen conserva el archivo; sin tickets.analyze el modo IA está deshabilitado y se empieza en Manual', async () => {
    const { form } = await openForm({ [`POST ${URL}/tickets`]: { status: 201, body: ticket() } });
    upload(form);
    await within(form).findByText('Listo para analizar');
    fireEvent.click(radio(form, /^Manual/));
    expect(within(form).getByText('Archivo adjunto')).toBeTruthy();
    fireEvent.click(radio(form, /^Ticket con IA/));
    expect(within(form).getByText('Listo para analizar')).toBeTruthy();
    cleanup();

    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '2.00' },
          myPermissions: OWNER_PERMISSIONS.filter((p) => p !== 'tickets.analyze'),
        }),
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const limited = screen.getByRole('form', { name: 'Añadir apuesta' });
    expect(radio(limited, /^Manual/).getAttribute('aria-checked')).toBe('true');
    expect(radio(limited, /^Ticket con IA/).getAttribute('aria-disabled')).toBe('true');
    expect(within(limited).getByText('No tienes permiso para analizar tickets.')).toBeTruthy();
    fireEvent.click(radio(limited, /^Ticket con IA/));
    expect(radio(limited, /^Manual/).getAttribute('aria-checked')).toBe('true');
  });

  it('"Pegar desde portapapeles": sube la imagen del portapapeles; sin imagen, explica cómo pegar', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let items: unknown[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: () => Promise.resolve(items) },
    });
    try {
      const { form, calls } = await openForm({
        [`POST ${URL}/tickets`]: {
          status: 201,
          body: ticket({ originalFileName: 'ticket-pegado.png' }),
        },
      });
      click(form, 'Pegar desde portapapeles');
      expect(
        await within(form).findByText(/No hay ninguna imagen en el portapapeles/),
      ).toBeTruthy();
      expect(calls.some((c) => c.method === 'POST' && c.path === `${URL}/tickets`)).toBe(false);

      items = [
        {
          types: ['image/png'],
          getType: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
        },
      ];
      click(form, 'Pegar desde portapapeles');
      await within(form).findByText('Listo para analizar');
      expect(calls.some((c) => c.method === 'POST' && c.path === `${URL}/tickets`)).toBe(true);
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('Paso 3 (IA): "Leído por IA" y estructura validada; "Registrar otra apuesta" reinicia vacío con otra clave de idempotencia', async () => {
    const { form, calls } = await openForm({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: analysisResponse(
        'COMPLETED',
        betanoExtraction(),
      ),
      [`POST ${BETS_URL}`]: {
        status: 201,
        body: registeredBet({ ticketCount: 1, tickets: [ticket({ betId: 'nueva' })] }),
      },
    });
    upload(form);
    await within(form).findByText('Listo para analizar');
    click(form, 'Analizar y continuar');
    await within(form).findByText('Ticket leído por IA.');
    click(form, 'Continuar a confirmar');
    // Mismo flujo que el registro manual: revisión previa (origen IA) sin escribir, luego registrar.
    expect(
      within(form).getByRole('article', { name: 'Vista previa del ticket digital' }).textContent,
    ).toContain('Ticket con IA');
    expect(postedBets(calls)).toHaveLength(0);
    click(form, 'Registrar apuesta');
    await screen.findByRole('heading', { name: 'Registro completado' });

    expect(
      within(form).getByText(/El ticket leído por IA fue guardado en tu historial/),
    ).toBeTruthy();
    const original = within(form).getAllByRole('region', { name: 'Ticket original' }).at(-1)!;
    expect(within(original).getByText('Leído por IA')).toBeTruthy();
    const final = within(form).getByRole('region', { name: 'Resumen final' });
    expect(within(final).getByText('Completado')).toBeTruthy();
    expect(within(final).getByText('Estructura del ticket')).toBeTruthy();
    expect(within(final).getByText('Validada')).toBeTruthy();

    // "Registrar otra apuesta" (pie): un asistente nuevo y vacío en el Paso 1, mismo origen.
    fireEvent.click(within(form).getAllByRole('button', { name: 'Registrar otra apuesta' })[0]!);
    const fresh = screen.getByRole('form', { name: 'Añadir apuesta' });
    expect(stepOf(fresh)).toBe('Añadir apuesta');
    expect(radio(fresh, /^Ticket con IA/).getAttribute('aria-checked')).toBe('true');
    expect(within(fresh).getByText('Ningún archivo cargado')).toBeTruthy();
    expect(fieldFor<HTMLInputElement>(fresh, 'Monto apostado').value).toBe('');

    // Y su registro usa otra clave de idempotencia.
    fireEvent.click(radio(fresh, /^Manual/));
    fillBetano(fresh);
    closeLegDialog();
    click(fresh, 'Continuar a verificar datos');
    click(fresh, /Usar el producto de las cuotas/);
    click(fresh, 'Continuar a confirmar');
    click(fresh, 'Registrar apuesta');
    await waitFor(() => expect(postedBets(calls)).toHaveLength(2));
    const [first, second] = postedBets(calls);
    expect(second!.clientRequestId).not.toBe(first!.clientRequestId);
  });

  it('Paso 3 (manual): origen "Manual", respaldo "Sin adjuntar" y ticket digital; "Ver historial" cierra y destaca la apuesta', async () => {
    let listed = false;
    const { form } = await openForm({
      [`GET ${BETS_URL}`]: () => ({ status: 200, body: listed ? [registeredBet()] : [] }),
      [`POST ${BETS_URL}`]: () => {
        listed = true;
        return CREATED_BET;
      },
    });
    fireEvent.click(radio(form, /^Manual/));
    fillBetano(form);
    closeLegDialog();
    click(form, 'Continuar a verificar datos');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Continuar a confirmar');
    click(form, 'Registrar apuesta');
    await screen.findByRole('heading', { name: 'Registro completado' });

    expect(within(form).getByText(/El registro manual fue guardado en tu historial/)).toBeTruthy();
    const done = within(form).getByRole('region', { name: 'Registro completado' });
    expect(within(done).getByText('Origen del registro')).toBeTruthy();
    // Sin respaldo, la columna derecha nunca queda vacía: el ticket digital de la apuesta.
    expect(within(form).getByRole('region', { name: 'Ticket digital' })).toBeTruthy();
    const final = within(form).getByRole('region', { name: 'Resumen final' });
    expect(within(final).getByText('Origen').nextElementSibling!.textContent).toBe('Manual');
    expect(within(final).getByText('Respaldo del ticket').nextElementSibling!.textContent).toBe(
      'Sin adjuntar',
    );
    // Liquidada: se corrige desde el historial (con motivo), nunca editándola aquí.
    expect(within(form).getByText(/corrección con motivo/)).toBeTruthy();

    click(form, 'Ver historial');
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('[data-bet-row][data-highlighted]')).not.toBeNull(),
    );
  });

  it('"Volver al dashboard" cierra el asistente y lleva al dashboard del proyecto', async () => {
    const { form } = await openForm({
      [`POST ${BETS_URL}`]: CREATED_BET,
      [`GET ${URL}/dashboard/status`]: { status: 500, body: undefined },
      [`GET ${URL}/dashboard/analysis`]: { status: 500, body: undefined },
      [`GET ${URL}/dashboard/bankroll-chart`]: { status: 500, body: undefined },
    });
    fireEvent.click(radio(form, /^Manual/));
    fillBetano(form);
    closeLegDialog();
    click(form, 'Continuar a verificar datos');
    click(form, /Usar el producto de las cuotas/);
    click(form, 'Continuar a confirmar');
    click(form, 'Registrar apuesta');
    await screen.findByRole('heading', { name: 'Registro completado' });
    click(form, 'Volver al dashboard');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
  });
});
