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
  chooseRowStatus,
  openRowAction,
  rowActionNames,
} from '../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const BETS_URL = `${URL}/bets`;
const HOUSES_URL = `${URL}/houses`;
const STAGES_URL = `${URL}/stages`;
const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const BET_ID = '0195f7c0-0000-7000-8000-0000000000b1';

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
  events: ['Real Madrid vs. Barcelona'],
  ticketCount: 0,
  ...overrides,
});

const bet = (overrides: Record<string, unknown> = {}) => ({
  id: BET_ID,
  projectId: PROJECT_ID,
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
  ...overrides,
});

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail() },
    [`GET ${HOUSES_URL}`]: { status: 200, body: [house()] },
    [`GET ${BETS_URL}`]: { status: 200, body: [bet()] },
    [`GET ${STAGES_URL}`]: { status: 200, body: [stage()] },
    ...extra,
  });
}

describe('apuestas, selecciones y liquidaciones (§18-§27, §107)', () => {
  it('antes de completar el setup, remite a la configuración inicial', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({ setupComplete: false, activeStage: null }),
      },
    });
    renderApp(BETS_URL);
    expect(
      await screen.findByRole('link', { name: /configuración inicial del proyecto/ }),
    ).toBeTruthy();
  });

  it('lista una apuesta pendiente con su monto calculado', async () => {
    open();
    renderApp(BETS_URL);
    expect(await screen.findByRole('button', { name: 'Estado: Pendiente' })).toBeTruthy();
    expect(screen.getByText('Stake', { selector: 'dt' }).nextElementSibling!.textContent).toBe('2');
    expect(screen.getByText('(calculado)').parentElement!.textContent).toBe('S/ 20.00 (calculado)');
  });

  it('presenta la cuota con máximo 2 decimales, aunque la API la devuelva con el relleno de NUMERIC(12,6) (Fase 10.9, §7-§8)', async () => {
    open({ [`GET ${BETS_URL}`]: { status: 200, body: [bet({ visibleTotalOdds: '1.950000' })] } });
    renderApp(BETS_URL);
    await screen.findByRole('button', { name: 'Estado: Pendiente' });
    expect(screen.getByText('1.95')).toBeTruthy();
    expect(screen.queryByText('1.950000')).toBeNull();
  });

  it('sin permisos, no se ofrece registrar, editar ni liquidar', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          isOwner: false,
          myRole: 'READER',
          myPermissions: [
            'project.view',
            'stages.view',
            'houses.view',
            'movements.view',
            'bets.view',
          ],
        }),
      },
    });
    renderApp(BETS_URL);
    await screen.findByText('Pendiente');
    expect(screen.queryByRole('button', { name: 'Añadir apuesta' })).toBeNull();
    expect(rowActionNames()).not.toContain('Editar');
    // Sin bets.settle el estado solo se muestra: no hay selector con el que liquidar.
    expect(screen.queryByRole('button', { name: /^Estado:/ })).toBeNull();
  });

  it('con permiso de editar la propia pero sin bets.settle, no se ofrece Liquidar (revisión de arquitectura)', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          isOwner: false,
          myRole: 'COLLABORATOR',
          myPermissions: [
            'project.view',
            'stages.view',
            'houses.view',
            'movements.view',
            'bets.view',
            'bets.create',
            'bets.update_own',
            'bets.trash_own',
          ],
        }),
      },
    });
    renderApp(BETS_URL);
    await screen.findByText('Pendiente');
    // Autora de la apuesta (bet.createdBy = ANA.id, la sesión activa): puede editar la propia...
    expect(rowActionNames()).toContain('Editar');
    // ...pero liquidar no depende de la propiedad: sin bets.settle, no se ofrece.
    expect(screen.queryByRole('button', { name: /^Estado:/ })).toBeNull();
  });

  it('registra una apuesta simple', async () => {
    const { calls } = open({
      [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '2' } });
    fireEvent.change(within(form).getByLabelText('Fecha'), { target: { value: '2026-06-01' } });
    fireEvent.change(within(form).getByLabelText('Hora'), { target: { value: '20:00' } });
    fireEvent.change(within(form).getByLabelText('Partido'), {
      target: { value: 'Real Madrid vs. Barcelona' },
    });
    fireEvent.change(within(form).getByLabelText('Pronóstico de la selección 1'), {
      target: { value: 'Real Madrid gana' },
    });
    fireEvent.change(within(form).getByLabelText('Cuota de la selección 1'), {
      target: { value: '1.95' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));

    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const created = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!;
    expect(created.body).toMatchObject({
      houseId: HOUSE_A,
      stake: '2', // el stake no es dinero: no se transforma/formatea (§12, D-B8)
      visibleTotalOdds: '1.95',
      selections: [
        {
          eventGroup: 0,
          position: 0,
          event: 'Real Madrid vs. Barcelona',
          selection: 'Real Madrid gana',
          visibleOdds: '1.95',
        },
      ],
    });
  });

  it('valida en el navegador antes de llamar a la API', async () => {
    const { calls } = open();
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('mover de etapa exige contraseña reciente', async () => {
    let reauthed = false;
    const { calls } = open({
      [`GET ${STAGES_URL}`]: {
        status: 200,
        body: [stage(), stage({ id: 'e2', name: 'Etapa 2' })],
      },
      [`POST ${BETS_URL}/${BET_ID}/move-stage`]: () =>
        reauthed ? { status: 200, body: bet({ stageId: 'e2' }) } : apiError(403, 'REAUTH_REQUIRED'),
      'POST /auth/reauth': () => {
        reauthed = true;
        return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
      },
    });
    renderApp(BETS_URL);
    await openRowAction('Mover de etapa');
    const form = screen.getByRole('form', { name: 'Mover de etapa la apuesta de Betano' });
    await within(form).findByRole('option', { name: 'Etapa 2' });
    fireEvent.change(within(form).getByLabelText('Nueva etapa'), { target: { value: 'e2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Mover' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Se movió la apuesta de etapa.')).toBeTruthy();
    const posts = calls.filter((c) => c.path === `${BETS_URL}/${BET_ID}/move-stage`);
    expect(posts).toHaveLength(2);
  });

  it('envía una apuesta a la papelera', async () => {
    let trashed = false;
    const { calls } = open({
      [`GET ${BETS_URL}`]: () => ({ status: 200, body: trashed ? [] : [bet()] }),
      [`POST ${BETS_URL}/${BET_ID}/trash`]: () => {
        trashed = true;
        return { status: 200, body: { id: BET_ID } };
      },
    });
    renderApp(BETS_URL);
    await openRowAction('Eliminar');
    // Antes de eliminar se explica qué pasa y se confirma con un botón inequívoco.
    expect(screen.getByRole('group', { name: 'Confirmar eliminación' }).textContent).toMatch(
      /deja de reservar sus S\/ 20\.00 en Betano/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar apuesta' }));
    expect(await screen.findByText('Se envió la apuesta a la papelera.')).toBeTruthy();
    expect(calls.some((c) => c.path === `${BETS_URL}/${BET_ID}/trash`)).toBe(true);
  });

  it('quien puede restaurar ve la papelera', async () => {
    const trashedBet = bet({ deletedAt: '2026-06-03T00:00:00.000Z' });
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail(), // owner: incluye bets.restore
      },
      [`GET ${BETS_URL}?status=TRASHED`]: { status: 200, body: [trashedBet] },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByLabelText('Ver la papelera'));
    expect(await screen.findByRole('button', { name: 'Restaurar' })).toBeTruthy();
  });

  it('muestra el error de la API', async () => {
    open({ [`GET ${BETS_URL}`]: apiError(500, 'INTERNAL_ERROR') });
    renderApp(BETS_URL);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('tickets e IA en el formulario de apuesta (§28-§31, §110)', () => {
  const TICKET_ID = '0195f7c0-0000-7000-8000-0000000000c1';
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

  async function openTicketZone(extra: Record<string, Handler> = {}) {
    const stub = open(extra);
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    const zone = await within(form).findByRole('button', { name: 'Sube tu ticket' });
    return { ...stub, form, zone };
  }

  /**
   * Acotado a "Completa con IA" (Fase 11.3): el nombre y el estado del ticket también se
   * reflejan, a propósito, en la tarjeta "Ticket original" de la columna derecha — nunca el
   * mismo control dos veces, pero sí la misma referencia visible en dos lugares legítimos.
   */
  const ticketZone = (form: HTMLElement) =>
    within(form).getByRole('region', { name: 'Completa con IA' });

  /**
   * Abre el formulario, sube un ticket y pulsa "Leer ticket con IA" (Fase 10.7): el análisis
   * puede ser estático o una función (para devolver algo distinto en una segunda lectura).
   */
  async function readTicket(
    analyze: Handler,
    extra: Record<string, Handler> = {},
  ): Promise<{ form: HTMLElement } & ReturnType<typeof open>> {
    const stub = open({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: analyze,
      ...extra,
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Leer ticket con IA' }));
    await within(form).findByText(/Datos aplicados desde el ticket/);
    return { ...stub, form };
  }

  const change = (form: HTMLElement, label: string, value: string) =>
    fireEvent.change(within(form).getByLabelText(label), { target: { value } });

  const analysisOf = (
    extraction: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) => ({
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
      ...overrides,
    },
  });

  it('con un ticket adjunto, el panel se ensancha también en Simple para compararlo con los datos (Fase 11.7)', async () => {
    const { form, zone } = await openTicketZone({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
    });
    const dialog = screen.getByRole('dialog', { name: 'Añadir apuesta' });
    expect(dialog.className).toContain('sm:max-w-2xl');

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    const card = await within(form).findByRole('region', { name: 'Ticket original' });
    await waitFor(() => expect(dialog.className).toContain('sm:max-w-6xl'));
    expect(within(card).getByRole('button', { name: 'Ver ticket.jpg en grande' })).toBeTruthy();

    // "Cambiar imagen" quita el ticket y vuelve a "Origen": el panel recupera el ancho compacto.
    fireEvent.click(within(card).getByRole('button', { name: 'Cambiar imagen' }));
    expect(within(form).queryByRole('region', { name: 'Ticket original' })).toBeNull();
    await waitFor(() => expect(dialog.className).toContain('sm:max-w-2xl'));
    expect(
      within(form)
        .getByRole('button', { name: /Origen/ })
        .getAttribute('aria-current'),
    ).toBe('step');
  });

  it('Escape en el ticket ampliado cierra solo el visor, nunca el formulario (Fase 11.7)', async () => {
    const { form, zone } = await openTicketZone({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
    });
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    const card = await within(form).findByRole('region', { name: 'Ticket original' });
    fireEvent.click(within(card).getByRole('button', { name: 'Ver ticket.jpg en grande' }));
    // El visor añade su propio "Cerrar" al del formulario.
    expect(screen.getAllByRole('button', { name: 'Cerrar' })).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('button', { name: 'Cerrar' })).toHaveLength(1);
    expect(screen.getByRole('form', { name: 'Añadir apuesta' })).toBeTruthy();

    // Un segundo Escape, ya sin visor, sí cierra el formulario (comportamiento de siempre).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
  });

  describe('subir el ticket: seleccionar, arrastrar o pegar (Fase 10.6)', () => {
    it('arrastrar y soltar una imagen la sube igual que seleccionarla', async () => {
      const { form, zone, calls } = await openTicketZone({
        [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      });
      const file = new File(['contenido'], 'arrastrado.jpg', { type: 'image/jpeg' });
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      expect(await within(ticketZone(form)).findByText('ticket.jpg')).toBeTruthy();
      expect(calls.some((c) => c.method === 'POST' && c.path === `${URL}/tickets`)).toBe(true);
    });

    it('pegar una imagen (Ctrl+V) la sube igual que seleccionarla', async () => {
      const { form, zone } = await openTicketZone({
        [`POST ${URL}/tickets`]: { status: 201, body: ticket({ originalFileName: 'pegado.png' }) },
      });
      const file = new File(['contenido'], 'pegado.png', { type: 'image/png' });
      fireEvent.paste(zone, {
        clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
      });
      expect(await within(ticketZone(form)).findByText('pegado.png')).toBeTruthy();
    });

    it('pegar algo que no sea una imagen no sube nada', async () => {
      const { form, zone, calls } = await openTicketZone();
      fireEvent.paste(zone, {
        clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }] },
      });
      expect(within(form).getByRole('button', { name: 'Sube tu ticket' })).toBeTruthy();
      expect(calls.some((c) => c.method === 'POST' && c.path.includes('/tickets'))).toBe(false);
    });

    it('arrastrar un archivo de un tipo no admitido avisa, sin subirlo', async () => {
      const { form, zone, calls } = await openTicketZone();
      const file = new File(['x'], 'nota.txt', { type: 'text/plain' });
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      expect(await within(form).findByText(/Solo se admiten imágenes/)).toBeTruthy();
      expect(calls.some((c) => c.method === 'POST' && c.path.includes('/tickets'))).toBe(false);
    });

    it('"Cambiar ticket" quita el adjunto del borrador y vuelve a mostrar la zona de subida', async () => {
      const { form } = await openTicketZone({
        [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      });
      const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
      fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), {
        target: { files: [file] },
      });
      expect(await within(ticketZone(form)).findByText('ticket.jpg')).toBeTruthy();
      fireEvent.click(within(form).getByRole('button', { name: 'Cambiar ticket' }));
      expect(within(form).queryByText('ticket.jpg')).toBeNull();
      expect(within(form).getByRole('button', { name: 'Sube tu ticket' })).toBeTruthy();
    });
  });

  it('mientras analiza, el estado es claro y específico, nunca un spinner genérico (Fase 11, §8)', async () => {
    const { form } = await openTicketZone({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: analysisOf({ house: 'Betano' }),
    });
    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    await within(ticketZone(form)).findByText('ticket.jpg');
    fireEvent.click(within(form).getByRole('button', { name: 'Leer ticket con IA' }));
    expect(
      within(form).getByText(
        /Analizando tu ticket: identificando casa, importe, selecciones y resultado/,
      ),
    ).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Analizando…' })).toBeTruthy();
    await within(form).findByText(/Datos aplicados desde el ticket/);
  });

  describe('prellenado completo del formulario (Fase 10.7)', () => {
    /** El ticket real de regresión: Betano, "Combinada de 5", Perdida, 5 selecciones distintas. */
    const betanoFixture = {
      house: 'Betano',
      placedDate: '2026-10-06',
      placedTime: '12:50',
      betType: 'MULTIPLE',
      officialAmount: '10.72',
      result: 'Perdida',
      selections: [
        {
          sport: 'Fútbol',
          event: 'Croacia vs España',
          market: 'Resultado del partido',
          selection: 'España',
          visibleOdds: '1.31',
        },
        {
          sport: 'Fútbol',
          event: 'Inglaterra vs República Checa',
          market: 'Hándicap Resultado del Partido',
          selection: 'Inglaterra -1',
          visibleOdds: '1.42',
        },
        {
          sport: 'Fútbol',
          event: 'Estonia vs Islandia',
          market: 'Goles totales Más/Menos',
          selection: 'Menos 3.5',
          visibleOdds: '1.29',
        },
        {
          sport: 'Fútbol',
          event: 'Suiza vs Macedonia del Norte',
          market: 'Hándicap Resultado del Partido',
          selection: 'Suiza -1',
          visibleOdds: '1.30',
        },
        {
          sport: 'Fútbol',
          event: 'Escocia vs Eslovenia',
          market: 'Ambos equipos anotan',
          selection: 'No',
          visibleOdds: '1.53',
        },
      ],
    };

    it('el ticket real de Betano (Combinada de 5, Perdida) prellena el formulario completo con sus 5 selecciones (criterio de éxito)', async () => {
      const { form, calls } = await readTicket(analysisOf(betanoFixture));

      expect(within(form).getByLabelText<HTMLSelectElement>('Casa').value).toBe(HOUSE_A);
      expect(within(form).getByLabelText<HTMLInputElement>('Fecha').value).toBe('2026-10-06');
      expect(within(form).getByLabelText<HTMLInputElement>('Hora').value).toBe('12:50');
      const formatGroup = within(form).getByRole('group', { name: 'Formato de apuesta' });
      expect(
        within(formatGroup).getByRole('button', { name: 'Múltiple' }).getAttribute('aria-pressed'),
      ).toBe('true');
      const resultGroup = within(form).getByRole('group', { name: 'Resultado' });
      expect(
        within(resultGroup).getByRole('button', { name: 'Perdida' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '10.72',
      );
      // Perdida, sin retorno ni cuota total visible, pero con las 5 cuotas individuales completas
      // (§2-§4, Fase 10.9): LetFer calcula su producto (1.31×1.42×1.29×1.30×1.53 = 4.772919762),
      // lo redondea a 2 decimales para la cuota registrable (4.77, nunca "4.772919762") y permite
      // continuar — nunca afirma que la casa mostró 4.77.
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe(
        '4.77',
      );
      expect(
        within(form).getByText(/Calculada desde las selecciones: producto de sus cuotas/),
      ).toBeTruthy();
      // El panel del ticket, aparte, muestra la misma referencia ya rotulada "Cuota calculada"
      // (no "Cuota efectiva": esa etiqueta es solo para retorno ÷ importe, §9).
      expect(within(form).getByText('Cuota calculada')).toBeTruthy();
      expect(
        within(form).getByText(/solo de referencia, no es la cuota oficial de la casa/),
      ).toBeTruthy();

      // Las 5 tarjetas, cada una con su partido, pronóstico y cuota.
      expect(within(form).getAllByLabelText(/^Partido de la selección \d$/)).toHaveLength(5);
      expect(within(form).getByLabelText<HTMLInputElement>('Partido de la selección 1').value).toBe(
        'Croacia vs España',
      );
      // Mercado + selección = Pronóstico (§1, Fase 10.8): el mercado ya no queda escondido en
      // "Más detalles", se incorpora al texto principal que de verdad se lee de un vistazo.
      expect(
        within(form).getByLabelText<HTMLInputElement>('Pronóstico de la selección 1').value,
      ).toBe('Resultado del partido España');
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '1.31',
      );
      expect(within(form).getByLabelText<HTMLInputElement>('Partido de la selección 5').value).toBe(
        'Escocia vs Eslovenia',
      );
      expect(
        within(form).getByLabelText<HTMLInputElement>('Pronóstico de la selección 5').value,
      ).toBe('Ambos equipos anotan No');
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 5').value).toBe(
        '1.53',
      );

      // Nunca un panel aparte de "Usar este valor": los campos reales ya quedaron rellenos.
      expect(within(form).queryByRole('button', { name: 'Usar este valor' })).toBeNull();

      // Sigue siendo 100% editable.
      fireEvent.change(within(form).getByLabelText('Partido de la selección 1'), {
        target: { value: 'Croacia vs España (corregido)' },
      });
      expect(within(form).getByLabelText<HTMLInputElement>('Partido de la selección 1').value).toBe(
        'Croacia vs España (corregido)',
      );

      // Nada se registra solo por leer el ticket.
      expect(calls.some((c) => c.method === 'POST' && c.path === BETS_URL)).toBe(false);
    });

    it('el ticket real de Betano (Combinada de 5, Perdida) permite registrar con la cuota calculada (Fase 10.9, prueba manual §12)', async () => {
      const { form, calls } = await readTicket(analysisOf(betanoFixture), {
        [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) },
      });
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe(
        '4.77',
      );
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
      await screen.findByText('Se registró la apuesta ya liquidada.');
      const body = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!.body as {
        visibleTotalOdds: string;
      };
      // Se envía exactamente la misma cuota redondeada que se mostró, nunca la de 9 decimales.
      expect(body.visibleTotalOdds).toBe('4.77');
    });

    it('ticket ganado: "Ganancias" es el retorno TOTAL, nunca la ganancia neta (§7)', async () => {
      // Apuesta S/10.00, "Ganancias" (pago total) S/51.40, cuota visible 5.14 (ejemplo real).
      const { form } = await readTicket(
        analysisOf({
          house: 'Betano',
          officialAmount: '10.00',
          officialTotalOdds: '5.14',
          officialRealizedReturn: '51.40',
          result: 'Ganada',
        }),
      );
      const resultGroup = within(form).getByRole('group', { name: 'Resultado' });
      expect(
        within(resultGroup).getByRole('button', { name: 'Ganada' }).getAttribute('aria-pressed'),
      ).toBe('true');
      // Ganancia neta = retorno (51.40) − importe (10.00) = 41.40, nunca 51.40 directo.
      expect(within(form).getByLabelText<HTMLInputElement>('Ganancia').value).toBe('41.40');
      // El panel del ticket también calcula la cuota efectiva (retorno real ÷ importe) aparte.
      expect(within(form).getByText(/Calculada: retorno real ÷ importe apostado\./)).toBeTruthy();
    });

    it('ticket pendiente: cuota efectiva "potencial", nunca un retorno oficial (§8)', async () => {
      // Apuesta S/2.00, "Ganancias potenciales" S/4.35, cuota visible 2.17 (ejemplo real).
      const { form } = await readTicket(
        analysisOf({
          house: 'Betano',
          officialAmount: '2.00',
          officialTotalOdds: '2.17',
          officialPotentialReturn: '4.35',
          selections: [
            { event: 'A vs B', selection: 'A', visibleOdds: '1.23' },
            { event: 'C vs D', selection: 'C', visibleOdds: '1.67' },
            { event: 'E vs F', selection: 'E', visibleOdds: '1.06' },
          ],
        }),
      );
      const resultGroup = within(form).getByRole('group', { name: 'Resultado' });
      // Sin "result" en el ticket: sigue Pendiente, nunca se infiere de que haya retorno potencial.
      expect(
        within(resultGroup).getByRole('button', { name: 'Pendiente' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe(
        '2.17',
      );
      // Cuota efectiva calculada del retorno potencial (4.35 ÷ 2.00 = 2.175): distinta de la
      // visible (2.17) y nunca rotulada como oficial.
      expect(within(form).getByText('Cuota efectiva')).toBeTruthy();
      expect(within(form).getByText('2.175')).toBeTruthy();
      expect(
        within(form).getByText(
          /Calculada a partir del retorno potencial: la apuesta sigue pendiente, no es un retorno oficial\./,
        ),
      ).toBeTruthy();
    });

    it('ticket ganado SIN cuota visible: LetFer la calcula (retorno ÷ importe) y permite registrar (Caso G, §1-§2)', async () => {
      const { form, calls } = await readTicket(
        analysisOf({
          house: 'Betano',
          officialAmount: '10.00',
          officialRealizedReturn: '51.40',
          result: 'Ganada',
          selections: [{ event: 'Real Madrid vs Barcelona', selection: 'Real Madrid' }],
        }),
        { [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) } },
      );
      const resultGroup = within(form).getByRole('group', { name: 'Resultado' });
      expect(
        within(resultGroup).getByRole('button', { name: 'Ganada' }).getAttribute('aria-pressed'),
      ).toBe('true');
      // Sin cuota total en el ticket: LetFer la calcula (51.40 ÷ 10.00 = 5.14) y la usa para que
      // el formulario quede registrable, rotulada como calculada, nunca como la de la casa.
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '5.14',
      );
      expect(within(form).getByText(/Calculada automáticamente:/)).toBeTruthy();
      expect(within(form).getByText(/retorno S\/ 51\.40 ÷ apuesta S\/ 10\.00/)).toBeTruthy();
      expect(within(form).getByLabelText<HTMLInputElement>('Ganancia').value).toBe('41.40');

      // Nunca bloquea el registro por falta de una cuota "obligatoria": se registra sin error.
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
      await screen.findByText('Se registró la apuesta ya liquidada.');
      const body = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!.body as {
        visibleTotalOdds: string;
      };
      expect(body.visibleTotalOdds).toBe('5.14');
    });

    it('ticket pendiente SIN cuota visible: cuota efectiva potencial calculada, se puede registrar (Caso H variante)', async () => {
      const { form, calls } = await readTicket(
        analysisOf({
          house: 'Betano',
          officialAmount: '2.00',
          officialPotentialReturn: '4.35',
          selections: [{ event: 'River Plate vs Boca Juniors', selection: 'Empate' }],
        }),
        { [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) } },
      );
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '2.175',
      );
      expect(within(form).getByText(/Calculada automáticamente:/)).toBeTruthy();
      expect(
        within(form).getByText(/retorno S\/ 4\.35 \(potencial\) ÷ apuesta S\/ 2\.00/),
      ).toBeTruthy();

      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
      await screen.findByText('Se registró la apuesta.');
      const body = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!.body as {
        visibleTotalOdds: string;
      };
      expect(body.visibleTotalOdds).toBe('2.175');
    });

    it('si el usuario edita la cuota calculada, la corrección manual se conserva (§11, §16)', async () => {
      const { form } = await readTicket(
        analysisOf({ house: 'Betano', officialAmount: '10.00', officialRealizedReturn: '51.40' }),
      );
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '5.14',
      );
      change(form, 'Cuota de la selección 1', '5.20');
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '5.20',
      );
      // Al editarla, deja de coincidir con la calculada: el rótulo "Calculada automáticamente"
      // desaparece y la corrección manual no se vuelve a pisar.
      expect(within(form).queryByText(/Calculada automáticamente:/)).toBeNull();
    });

    it('el importe determina el stake, nunca la cuota (Caso E): importe 2.17 con unidad 2 → stake 1.085', async () => {
      const { form } = await readTicket(
        analysisOf({ house: 'Betano', officialAmount: '2.17', officialTotalOdds: '3.50' }),
        {
          [`GET ${URL}`]: {
            status: 200,
            body: projectDetail({
              activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '2.00' },
            }),
          },
        },
      );
      // La cuota visible (3.50) nunca interviene en el cálculo del stake.
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '3.50',
      );
      expect(
        within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('1.085');
    });

    it('importe igual a la unidad → stake 1, sin omitirlo ni redondearlo (Caso D)', async () => {
      const { form } = await readTicket(analysisOf({ house: 'Betano', officialAmount: '2.00' }), {
        [`GET ${URL}`]: {
          status: 200,
          body: projectDetail({
            activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '2.00' },
          }),
        },
      });
      expect(
        within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('1');
    });

    it('perdida con una selección sin cuota: NO inventa un producto parcial (Fase 10.9, §2-§4)', async () => {
      const { form } = await readTicket(
        analysisOf({
          house: 'Betano',
          officialAmount: '10.72',
          result: 'Perdida',
          betType: 'MULTIPLE',
          selections: [
            { event: 'Croacia vs España', selection: 'España', visibleOdds: '1.31' },
            { event: 'Inglaterra vs República Checa', selection: 'Inglaterra -1' }, // sin cuota
          ],
        }),
      );
      // Sin la cuota de la segunda selección, el producto de "solo las conocidas" sería menor al
      // real y engañoso: no se calcula nada, el campo queda para que la persona lo complete.
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe('');
      expect(within(form).queryByText(/Calculada/)).toBeNull();
    });

    it('editar la cuota total visible (Múltiple/Creada) cuenta como corrección manual: una segunda lectura no la pisa (§14, §16, Fase 10.9)', async () => {
      const { form } = await readTicket(
        analysisOf({
          house: 'Betano',
          betType: 'MULTIPLE',
          officialTotalOdds: '2.50',
          selections: [
            { event: 'A vs B', selection: 'A' },
            { event: 'C vs D', selection: 'C' },
          ],
        }),
      );
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe(
        '2.50',
      );
      change(form, 'Cuota total visible', '2.80');

      fireEvent.click(within(form).getByRole('button', { name: 'Volver a analizar' }));
      await within(form).findByText(/ya habías corregido algunos datos a mano/);
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe(
        '2.80',
      );
    });

    it('Creada/Bet Builder detectado por la IA no exige cuotas individuales, solo la total (§6)', async () => {
      const { form, calls } = await readTicket(
        analysisOf({
          house: 'Betano',
          betType: 'CREATED',
          officialTotalOdds: '2.70',
          selections: [
            { event: 'Real Madrid vs Barcelona', market: 'Goles totales', selection: 'Más de 2.5' },
            { event: 'Real Madrid vs Barcelona', market: 'Ambos marcan', selection: 'Sí' },
          ],
        }),
        { [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) } },
      );

      const formatGroup = within(form).getByRole('group', { name: 'Formato de apuesta' });
      expect(
        within(formatGroup).getByRole('button', { name: 'Creada' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe(
        '2.70',
      );
      // Ninguna cuota individual: ni inventada ni repartida desde la total.
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 1').value).toBe(
        '',
      );
      expect(within(form).getByLabelText<HTMLInputElement>('Cuota de la selección 2').value).toBe(
        '',
      );

      change(form, 'Fecha', '2026-10-06');
      change(form, 'Hora', '12:50');
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
      expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
      // `calls` ya trae la subida del ticket (previa, en `readTicket`): hay que buscar la del alta.
      const body = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!.body as {
        selections: { visibleOdds?: string }[];
        visibleTotalOdds: string;
      };
      expect(body.visibleTotalOdds).toBe('2.70');
      expect(body.selections.every((s) => s.visibleOdds === undefined)).toBe(true);
    });

    it('casa no reconocida: no se inventa (queda pendiente); el stake SÍ se deriva del importe (§3-§4)', async () => {
      const { form } = await readTicket(
        analysisOf({ house: 'Casa Desconocida XYZ', officialAmount: '12.00' }),
      );
      // La casa sigue sin elegir: no hay ninguna que coincida con "Casa Desconocida XYZ".
      expect(within(form).getByLabelText<HTMLSelectElement>('Casa').value).toBe('');
      // Sin stake explícito en el ticket, LetFer lo calcula: 12.00 ÷ 10.00 (unidad) = 1.2, que no
      // coincide con ningún atajo → "Otra cantidad" con el valor exacto, nunca aproximado a 10.
      expect(
        within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('1.2');
    });

    it('importe 60 con unidad 10: el stake calculado (6) no coincide con ningún atajo rápido (§4)', async () => {
      const { form } = await readTicket(analysisOf({ house: 'Betano', officialAmount: '60.00' }));
      expect(
        within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('6');
      // El stake deriva exactamente del importe: nunca hay discrepancia que avisar en este caso.
      expect(within(form).queryByText(/El ticket indica/)).toBeNull();
    });

    it('un stake real y un importe del ticket que no reconcilian se avisan sin ocultar la diferencia (§5, §7)', async () => {
      // El ticket muestra un stake explícito (se extrae tal cual, §5) que no coincide con
      // importe ÷ unidad: LetFer nunca ajusta uno para que calcen; solo avisa.
      const { form } = await readTicket(
        analysisOf({ house: 'Betano', stake: '5', officialAmount: '10.72' }),
      );
      // "5" no es uno de los atajos (10/20/30/40/50): se extrae tal cual el stake real del
      // ticket, en "Otra cantidad", nunca aproximado a un atajo cercano.
      expect(
        within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('5');
      expect(
        within(form).getByText(
          /El ticket indica S\/ 10\.72, pero el cálculo de LetFer para stake 5 es S\/ 50\.00/,
        ),
      ).toBeTruthy();
    });

    it('si el usuario ya corrigió un campo, una nueva lectura pide confirmación; "Mantener mis cambios" no toca nada (§14)', async () => {
      const { form } = await readTicket(analysisOf({ house: 'Betano', officialAmount: '25.00' }));
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '25.00',
      );

      change(form, 'Monto oficial (opcional)', '30.00');
      fireEvent.click(within(form).getByRole('button', { name: 'Volver a analizar' }));
      await within(form).findByText(/ya habías corregido algunos datos a mano/);
      // Nada se pisó mientras se decide.
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '30.00',
      );

      fireEvent.click(within(form).getByRole('button', { name: 'Mantener mis cambios' }));
      expect(within(form).queryByText(/ya habías corregido algunos datos a mano/)).toBeNull();
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '30.00',
      );
    });

    it('"Reemplazar con esta lectura" sí aplica la nueva lectura sobre los cambios manuales (§14)', async () => {
      const { form } = await readTicket(analysisOf({ house: 'Betano', officialAmount: '25.00' }));
      change(form, 'Monto oficial (opcional)', '30.00');

      fireEvent.click(within(form).getByRole('button', { name: 'Volver a analizar' }));
      await within(form).findByText(/ya habías corregido algunos datos a mano/);
      fireEvent.click(within(form).getByRole('button', { name: 'Reemplazar con esta lectura' }));

      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '25.00',
      );
      expect(within(form).queryByText(/ya habías corregido algunos datos a mano/)).toBeNull();
    });
  });

  describe('normalización de dinero extraído por IA (bug real, Fase 10.7.1)', () => {
    /**
     * Regresión del bug real: la IA de un ticket de Betano devolvió el importe con el símbolo de
     * soles ("S/10.72") y el formulario reventaba al compararlo. Ninguna de estas formas debe
     * romper el render ni dejar la pantalla en blanco.
     */
    it.each([
      ['S/10.72', '10.72'],
      ['S/ 10.72', '10.72'],
      ['S/.10.72', '10.72'],
      ['S/. 10.72', '10.72'],
      ['10.72', '10.72'],
    ])('el importe "%s" del ticket se normaliza a "%s" en el formulario', async (raw, expected) => {
      const { form } = await readTicket(analysisOf({ house: 'Betano', officialAmount: raw }));
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        expected,
      );
      // La comparación con stake × unidad no revienta: o coincide, o avisa, nunca una excepción.
      expect(document.body.textContent).not.toMatch(/no es una cifra de dinero válida/);
    });

    it('un importe que no puede interpretarse no rompe el formulario: queda para revisión, sin inventar nada', async () => {
      const { form } = await readTicket(
        analysisOf({ house: 'Betano', officialAmount: 'diez soles con setenta' }),
      );
      // Nunca se rompe el render ni queda una pantalla en blanco.
      expect(within(form).getByRole('heading', { name: 'Añadir apuesta' })).toBeTruthy();
      // El campo se queda vacío (no se fuerza ni se adivina un valor).
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '',
      );
      expect(
        within(form).getByText(
          /Monto apostado detectado en el ticket no pudo interpretarse automáticamente/,
        ),
      ).toBeTruthy();
    });

    it('el ticket real de Betano (importe "S/10.72") prellena el formulario completo sin reventar (regresión del bug)', async () => {
      const { form, calls } = await readTicket(
        analysisOf({
          house: 'Betano',
          placedDate: '2026-10-06',
          placedTime: '12:50',
          betType: 'MULTIPLE',
          officialAmount: 'S/10.72',
          result: 'Perdida',
          selections: [
            { event: 'Croacia vs España', selection: 'España', visibleOdds: '1.31' },
            {
              event: 'Inglaterra vs República Checa',
              selection: 'Inglaterra -1',
              visibleOdds: '1.42',
            },
          ],
        }),
        { [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) } },
      );
      expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
        '10.72',
      );
      // Sin stake explícito, LetFer lo deriva del importe normalizado (10.72 ÷ 10.00 = 1.072):
      // no hay discrepancia que avisar, y nunca revienta por el símbolo "S/" original.
      expect(
        within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('1.072');
      expect(within(form).queryByText(/El ticket indica/)).toBeNull();

      // Sigue siendo posible corregir a mano y registrar sin ningún error de React.
      change(form, 'Monto oficial (opcional)', '10.72');
      change(form, 'Cuota total visible', '1.86'); // el ticket no la mostraba: se completa a mano
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
      // Resultado "Perdida" → se registra ya liquidada, no la apuesta pendiente de siempre.
      await screen.findByText('Se registró la apuesta ya liquidada.');
      expect(calls.some((c) => c.method === 'POST' && c.path === BETS_URL)).toBe(true);
    });
  });

  it('sube un ticket huérfano y lo vincula al registrar la apuesta', async () => {
    const { calls } = open({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    expect(await within(ticketZone(form)).findByText('ticket.jpg')).toBeTruthy();

    fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '2' } });
    fireEvent.change(within(form).getByLabelText('Fecha'), { target: { value: '2026-06-01' } });
    fireEvent.change(within(form).getByLabelText('Hora'), { target: { value: '20:00' } });
    fireEvent.change(within(form).getByLabelText('Partido'), {
      target: { value: 'Real Madrid vs. Barcelona' },
    });
    fireEvent.change(within(form).getByLabelText('Pronóstico de la selección 1'), {
      target: { value: 'Real Madrid gana' },
    });
    fireEvent.change(within(form).getByLabelText('Cuota de la selección 1'), {
      target: { value: '1.95' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));

    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const created = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!;
    expect(created.body).toMatchObject({ ticketId: TICKET_ID });
  });

  it('leer el ticket prellena el monto automáticamente, sin pulsar nada más (Fase 10.7)', async () => {
    open({
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
          extraction: { officialAmount: '25.00' },
          confidenceByField: { officialAmount: 0.9 },
          errorMessage: null,
          analyzedBy: { id: ANA.id, name: 'Ana Pérez' },
          analyzedAt: '2026-06-01T20:01:00.000Z',
        },
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Leer ticket con IA' }));

    // Sin ningún "Usar este valor": el campo real ya queda con el valor leído.
    expect(
      await within(form).findByLabelText<HTMLInputElement>('Monto oficial (opcional)'),
    ).toHaveProperty('value', '25.00');
    expect(within(form).queryByRole('button', { name: 'Usar este valor' })).toBeNull();
    expect(within(form).getByText(/Datos aplicados desde el ticket/)).toBeTruthy();
  });

  it('la fecha y la hora detectadas prellenan el formulario automáticamente y siguen editables (§2, Fase 10.7)', async () => {
    open({
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
          extraction: { placedDate: '2026-05-20', placedTime: '21:43' },
          confidenceByField: { placedDate: 0.95, placedTime: 0.8 },
          errorMessage: null,
          analyzedBy: { id: ANA.id, name: 'Ana Pérez' },
          analyzedAt: '2026-06-01T20:01:00.000Z',
        },
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Leer ticket con IA' }));

    // Prellenada automáticamente, pero el usuario sigue pudiendo corregirla.
    await within(form).findByText(/Datos aplicados desde el ticket/);
    expect(within(form).getByLabelText<HTMLInputElement>('Fecha').value).toBe('2026-05-20');
    expect(within(form).getByLabelText<HTMLInputElement>('Hora').value).toBe('21:43');
    fireEvent.change(within(form).getByLabelText('Fecha'), { target: { value: '2026-05-21' } });
    expect(within(form).getByLabelText<HTMLInputElement>('Fecha').value).toBe('2026-05-21');
  });

  it('si la IA falla, muestra el motivo real de la API, no el genérico de servidor (corrección posterior al rediseño)', async () => {
    open({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${URL}/tickets/${TICKET_ID}/analyze`]: apiError(
        502,
        'INTERNAL_ERROR',
        'No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.',
      ),
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Leer ticket con IA' }));

    expect(
      await within(form).findByText(/No pudimos leer el ticket\. Revisa la imagen/),
    ).toBeTruthy();
    expect(within(form).queryByText(/error inesperado en el servidor/)).toBeNull();
  });

  it('sin tickets.upload (aunque se pueda registrar apuestas), no se ofrece adjuntar (§110.6)', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          isOwner: false,
          myRole: 'COLLABORATOR',
          myPermissions: [
            'project.view',
            'stages.view',
            'houses.view',
            'movements.view',
            'bets.view',
            'bets.create',
          ],
        }),
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    expect(within(form).queryByLabelText('Adjuntar ticket')).toBeNull();
  });

  it('"Adjuntar o analizar ticket" (menú ⋮) carga y muestra los tickets de una apuesta registrada', async () => {
    open({
      [`GET ${BETS_URL}/${BET_ID}`]: {
        status: 200,
        body: { ...bet(), selections: [], tickets: [ticket({ originalFileName: 'antiguo.pdf' })] },
      },
    });
    renderApp(BETS_URL);
    await openRowAction('Adjuntar o analizar ticket');
    expect(await screen.findByText('antiguo.pdf')).toBeTruthy();
  });
});

describe('formulario "Añadir apuesta" (Fase 10.3)', () => {
  const COLLABORATOR = {
    isOwner: false,
    myRole: 'COLLABORATOR',
    myPermissions: [
      'project.view',
      'stages.view',
      'houses.view',
      'movements.view',
      'bets.view',
      'bets.create',
      'bets.update_own',
      'bets.trash_own',
    ],
  };

  async function openForm(
    project: Record<string, unknown> = {},
    extra: Record<string, Handler> = {},
  ) {
    const stub = open({ [`GET ${URL}`]: { status: 200, body: projectDetail(project) }, ...extra });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    return { ...stub, form };
  }

  const input = (form: HTMLElement, label: string) =>
    within(form).getByLabelText<HTMLInputElement>(label);
  const shown = (form: HTMLElement, label: string) =>
    within(form).getByLabelText(label).textContent;
  const change = (form: HTMLElement, label: string, value: string) =>
    fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  const press = (form: HTMLElement, group: string, name: string) =>
    fireEvent.click(
      within(within(form).getByRole('group', { name: group })).getByRole('button', { name }),
    );

  /** Casa, partido, pronóstico y cuota de una Simple, con fechas fijas para poder comprobarlas. */
  function fillSimple(form: HTMLElement, odds = '1.52') {
    change(form, 'Casa', HOUSE_A);
    change(form, 'Fecha', '2026-06-01');
    change(form, 'Hora', '20:00');
    // Fase 11.4: "Partido" se pregunta una sola vez (no por selección) en Simple y Creada — solo
    // Múltiple conserva "Partido de la selección N" (cada una puede ser de un partido distinto).
    change(form, 'Partido', 'Arsenal vs Manchester City');
    change(form, 'Pronóstico de la selección 1', 'Gana Arsenal');
    change(form, 'Cuota de la selección 1', odds);
  }

  function setSettledAt(form: HTMLElement) {
    change(form, 'Fecha de liquidación', '2026-06-01');
    change(form, 'Hora de liquidación', '22:00');
  }

  const created = { [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) } };

  describe('asistente de 3 pasos (Fase 11.1, rediseño UX/UI del alta)', () => {
    it('empieza en "Origen", con el ticket/IA ahí mismo (ya no al final del formulario)', async () => {
      const { form } = await openForm();
      expect(
        within(form)
          .getByRole('button', { name: /Origen/ })
          .getAttribute('aria-current'),
      ).toBe('step');
      expect(within(form).getByText('Completa con IA')).toBeTruthy();
      expect(within(form).getByLabelText('Sube tu ticket')).toBeTruthy();
      expect(within(form).queryByRole('button', { name: 'Registrar apuesta' })).toBeNull();
    });

    it('"Siguiente"/"Atrás" avanzan y retroceden entre Origen, Apuesta y Confirmar', async () => {
      const { form } = await openForm();
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      expect(
        within(form)
          .getByRole('button', { name: /Apuesta/ })
          .getAttribute('aria-current'),
      ).toBe('step');
      expect(within(form).queryByRole('button', { name: 'Registrar apuesta' })).toBeNull();
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      expect(
        within(form)
          .getByRole('button', { name: /Confirmar/ })
          .getAttribute('aria-current'),
      ).toBe('step');
      expect(within(form).getByRole('button', { name: 'Registrar apuesta' })).toBeTruthy();
      fireEvent.click(within(form).getByRole('button', { name: 'Atrás' }));
      expect(
        within(form)
          .getByRole('button', { name: /Apuesta/ })
          .getAttribute('aria-current'),
      ).toBe('step');
    });

    it('los pasos del indicador se pueden elegir libremente, nunca bloquean el salto (solo orientan)', async () => {
      const { form } = await openForm();
      fireEvent.click(within(form).getByRole('button', { name: /Confirmar/ }));
      expect(
        within(form)
          .getByRole('button', { name: /Confirmar/ })
          .getAttribute('aria-current'),
      ).toBe('step');
      expect(within(form).getByRole('button', { name: 'Registrar apuesta' })).toBeTruthy();
      fireEvent.click(within(form).getByRole('button', { name: /Origen/ }));
      expect(
        within(form)
          .getByRole('button', { name: /Origen/ })
          .getAttribute('aria-current'),
      ).toBe('step');
    });

    it('un Enter en el paso "Origen" avanza de paso; no registra la apuesta a medio llenar', async () => {
      const { form, calls } = await openForm({}, created);
      fireEvent.submit(form);
      expect(
        within(form)
          .getByRole('button', { name: /Apuesta/ })
          .getAttribute('aria-current'),
      ).toBe('step');
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('el resumen financiero refleja en vivo la cuota introducida en cualquier paso', async () => {
      const { form } = await openForm();
      fillSimple(form, '1.52');
      const summary = within(form).getByText('Resumen financiero').closest('div')!;
      expect(within(summary).getByText('1.52')).toBeTruthy();
    });

    it('los campos de los tres pasos siguen formando una sola apuesta al registrar', async () => {
      const { form, calls } = await openForm({}, created);
      fillSimple(form);
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
      expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
      expect(calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!.body).toMatchObject({
        houseId: HOUSE_A,
        visibleTotalOdds: '1.52',
      });
    });
  });

  it('abre con la fecha y la hora actuales (editables), Fútbol, Simple y Pendiente', async () => {
    const before = new Date();
    const { form } = await openForm();
    expect(within(form).getByRole('heading', { name: 'Añadir apuesta' })).toBeTruthy();

    const date = input(form, 'Fecha').value;
    const time = input(form, 'Hora').value;
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(time).toMatch(/^\d{2}:\d{2}$/);
    // Es "ahora" en la hora local del navegador (con margen para el cambio de minuto).
    expect(Math.abs(new Date(`${date}T${time}`).getTime() - before.getTime())).toBeLessThan(
      120_000,
    );
    change(form, 'Fecha', '2026-05-30');
    change(form, 'Hora', '08:15');
    expect(input(form, 'Fecha').value).toBe('2026-05-30');
    expect(input(form, 'Hora').value).toBe('08:15');

    expect(within(form).getByLabelText<HTMLSelectElement>('Deporte').value).toBe('Fútbol');
    const format = within(form).getByRole('group', { name: 'Formato de apuesta' });
    expect(
      within(format).getByRole('button', { name: 'Simple' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const result = within(form).getByRole('group', { name: 'Resultado' });
    expect(
      within(result).getByRole('button', { name: 'Pendiente' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // Pendiente: A+G y ganancia todavía no existen ("-"); además se ve cuánto devolvería si gana.
    expect(shown(form, 'A+G')).toBe('-');
    expect(shown(form, 'Ganancia calculada')).toBe('-');
    expect(within(form).getByText('Retorno potencial')).toBeTruthy();
  });

  it('el panel flotante se ensancha con Múltiple/Creada y vuelve a ser compacto con Simple (Fase 11, §11; Fase 11.1, §22)', async () => {
    const { form } = await openForm();
    const dialog = screen.getByRole('dialog', { name: 'Añadir apuesta' });
    expect(dialog.className).toContain('sm:max-w-2xl');
    expect(dialog.className).not.toContain('sm:max-w-6xl');

    press(form, 'Formato de apuesta', 'Múltiple');
    expect(dialog.className).toContain('sm:max-w-6xl');
    expect(dialog.className).not.toContain('sm:max-w-2xl');

    press(form, 'Formato de apuesta', 'Simple');
    expect(dialog.className).toContain('sm:max-w-2xl');
    expect(dialog.className).not.toContain('sm:max-w-6xl');
  });

  it('la casa es obligatoria: sin ella no se llama a la API', async () => {
    const { form, calls } = await openForm();
    change(form, 'Partido', 'Arsenal vs Manchester City');
    change(form, 'Pronóstico de la selección 1', 'Gana Arsenal');
    change(form, 'Cuota de la selección 1', '1.52');
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await within(form).findByText('Elige una casa.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('al cambiar la cuota o el stake, A+G y ganancia se recalculan al instante', async () => {
    const { form } = await openForm();
    fillSimple(form); // cuota 1.52
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6'); // 60
    press(form, 'Resultado', 'Ganada');
    expect(shown(form, 'A+G')).toBe('S/ 91.20');
    change(form, 'Cuota de la selección 1', '1.60');
    expect(shown(form, 'A+G')).toBe('S/ 96.00');
    expect(input(form, 'Ganancia').value).toBe('36.00');
    change(form, 'Stake', '3'); // 30
    expect(shown(form, 'A+G')).toBe('S/ 48.00');
    expect(input(form, 'Ganancia').value).toBe('18.00');
  });

  it('se abre como un cuadro flotante (modal) centrado', async () => {
    const { form } = await openForm();
    expect(screen.getByRole('dialog', { name: 'Añadir apuesta' })).toBeTruthy();
    expect(within(form).getByRole('heading', { name: 'Añadir apuesta' })).toBeTruthy();
  });

  it('la "X" cierra el formulario sin registrar nada', async () => {
    const { form, calls } = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('"Cancelar" cierra el formulario sin registrar nada', async () => {
    const { form, calls } = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('Escape cierra el formulario sin registrar nada', async () => {
    const { calls } = await openForm();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  const STAKE_PRESETS = [10, 20, 30, 40, 50];

  it('stake: los cinco atajos (10 a 50, de 10 en 10) están todos visibles; 5, 15, 25... no lo son', async () => {
    const { form } = await openForm();
    for (const value of STAKE_PRESETS) {
      expect(within(form).getByRole('button', { name: `Stake ${value}` })).toBeTruthy();
    }
    for (const value of [1, 2, 3, 4, 5, 15, 25, 35, 45]) {
      expect(within(form).queryByRole('button', { name: `Stake ${value}` })).toBeNull();
    }
    // El primero (10) queda seleccionado por defecto, como cualquier otro atajo.
    expect(
      within(form).getByRole('button', { name: 'Stake 10' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 100.00'); // 10 × unidad 10
  });

  it('al elegir un atajo distinto, queda seleccionado y el importe se recalcula', async () => {
    const { form } = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Stake 40' }));
    expect(
      within(form).getByRole('button', { name: 'Stake 40' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(form).getByRole('button', { name: 'Stake 10' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 400.00'); // 40 × 10
  });

  it('"Otra cantidad" revela el campo manual y deselecciona los atajos; invalida valores no numéricos', async () => {
    const { form } = await openForm();
    // Sin "Otra cantidad", no hay campo de texto para el stake: solo los atajos.
    expect(within(form).queryByLabelText('Stake')).toBeNull();

    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    expect(
      within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // Ningún atajo queda marcado mientras se escribe una cantidad personalizada.
    for (const value of STAKE_PRESETS) {
      expect(
        within(form)
          .getByRole('button', { name: `Stake ${value}` })
          .getAttribute('aria-pressed'),
      ).toBe('false');
    }
    change(form, 'Stake', '15'); // precisamente un valor que ya no es atajo (5, 15, 25...)
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 150.00');
    change(form, 'Stake', 'abc');
    expect(shown(form, 'Monto apostado calculado')).toBe('-');
  });

  it('elegir de nuevo un atajo reemplaza la cantidad personalizada', async () => {
    const { form } = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '25');
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 250.00');

    fireEvent.click(within(form).getByRole('button', { name: 'Stake 30' }));
    expect(within(form).queryByLabelText('Stake')).toBeNull(); // el campo manual se oculta otra vez
    expect(
      within(form).getByRole('button', { name: 'Otra cantidad' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      within(form).getByRole('button', { name: 'Stake 30' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 300.00'); // 30 × 10, no 25 × 10
  });

  it('stake 10 con unidad S/ 2.00 calcula S/ 20.00; stake 20 con la misma unidad, S/ 40.00', async () => {
    const { form } = await openForm({
      activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '2.00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Stake 10' }));
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 20.00');
    fireEvent.click(within(form).getByRole('button', { name: 'Stake 20' }));
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 40.00');
  });

  it('stake 50 con unidad S/ 5.00 calcula S/ 250.00', async () => {
    const { form } = await openForm({
      activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '5.00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Stake 50' }));
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 250.00');
  });

  it('la etapa nunca se elige ni se muestra en "Añadir apuesta" (corrección posterior al rediseño)', async () => {
    const { form } = await openForm();
    // Sin selector ni campo que rellenar: la etapa activa la resuelve el backend, no la persona.
    expect(within(form).queryByLabelText('Etapa')).toBeNull();
    expect(within(form).queryByRole('combobox', { name: /[Ee]tapa/ })).toBeNull();
    // Tampoco como contexto de solo lectura: ni el nombre de la etapa ni un bloque "Unidad" que
    // la nombre. El cálculo stake × unidad sigue siendo interno (se ve reflejado en el importe).
    expect(within(form).queryByText('Etapa activa')).toBeNull();
    expect(within(form).queryByText('Etapa 1')).toBeNull();
    expect(within(form).queryByText(/^Unidad\b/)).toBeNull();
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 100.00'); // stake 10 × unidad 10
  });

  it('si la etapa activa del proyecto tiene otra unidad, el mismo stake calcula otro importe (sin mostrarla)', async () => {
    const { form } = await openForm({
      activeStage: { id: STAGE_ID, name: 'Etapa 2', unitStake: '20.00' },
    });
    expect(within(form).queryByText('Etapa 2')).toBeNull();
    expect(within(form).queryByText(/^Unidad\b/)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Stake 10' }));
    expect(shown(form, 'Monto apostado calculado')).toBe('S/ 200.00'); // 10 × 20 (no 10 × 10)
  });

  it('nunca se envía stageId: la apuesta queda en la etapa activa que resuelve la API', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('stageId');
  });

  it('sin etapa activa, no se puede registrar: lo explica y ofrece ir a Etapas', async () => {
    open({ [`GET ${URL}`]: { status: 200, body: projectDetail({ activeStage: null }) } });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const dialog = screen.getByRole('dialog', { name: 'Añadir apuesta' });
    expect(within(dialog).getByText(/No hay una etapa activa/)).toBeTruthy();
    expect(within(dialog).queryByRole('form', { name: 'Añadir apuesta' })).toBeNull();
    const link = within(dialog).getByRole('link', { name: 'Ir a Etapas' });
    expect(link.getAttribute('href')).toBe(`${URL}/stages`);
  });

  it('el stake manual sigue validándose antes de llamar a la API', async () => {
    const { form, calls } = await openForm();
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '0');
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await within(form).findByText(/stake válido/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('pendiente: se registra con la cuota de la Simple como cuota total, sin liquidación', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6');
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      stake: '6',
      visibleTotalOdds: '1.52',
      placedAt: new Date('2026-06-01T20:00').toISOString(),
      selections: [
        {
          eventGroup: 0,
          position: 0,
          sport: 'Fútbol',
          event: 'Arsenal vs Manchester City',
          selection: 'Gana Arsenal',
          visibleOdds: '1.52',
        },
      ],
    });
    expect(body).not.toHaveProperty('settlement');
  });

  it('ganada: A+G = monto + ganancia, con la ganancia calculada y precargada (60 × 0.52 = 31.20)', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6'); // 6 × 10 = 60
    press(form, 'Resultado', 'Ganada');
    expect(shown(form, 'A+G')).toBe('S/ 91.20');
    expect(input(form, 'Ganancia').value).toBe('31.20');
    expect(shown(form, 'Cuota resultante')).toBe('1.52');
    setSettledAt(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));

    expect(await screen.findByText('Se registró la apuesta ya liquidada.')).toBeTruthy();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1); // alta y liquidación en una sola operación
    const body = posts[0]!.body as { settlement: Record<string, unknown> };
    expect(body.settlement).toMatchObject({
      status: 'WON',
      settledAt: new Date('2026-06-01T22:00').toISOString(),
    });
    // Sin ajustar la ganancia no se envía retorno oficial: la API guarda el calculado.
    expect(body.settlement).not.toHaveProperty('officialRealizedReturn');
  });

  it('ajustar la ganancia recalcula A+G y la cuota efectiva, y se envía como retorno oficial', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form, '1.56');
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6'); // 60
    press(form, 'Resultado', 'Ganada');
    expect(input(form, 'Ganancia').value).toBe('33.60'); // 60 × 0.56, lo que calcula LetFer
    change(form, 'Ganancia', '34.07'); // lo que pagó la casa (cuota interna más precisa)
    expect(shown(form, 'A+G')).toBe('S/ 94.07');
    // La cuota que se muestra es la efectiva: consistente con la ganancia (94.07 ÷ 60).
    expect(within(form).getByText('Cuota efectiva')).toBeTruthy();
    expect(shown(form, 'Cuota resultante')).toBe('1.567833');
    expect(within(form).getByText(/La casa muestra 1.56/)).toBeTruthy();
    setSettledAt(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));

    expect(await screen.findByText('Se registró la apuesta ya liquidada.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      visibleTotalOdds: '1.56', // la de la casa, intacta (regla crítica 6)
      settlement: { status: 'WON', officialRealizedReturn: '94.07' },
    });
  });

  it('"Usar la calculada" deshace el ajuste de la ganancia', async () => {
    const { form } = await openForm();
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6');
    press(form, 'Resultado', 'Ganada');
    change(form, 'Ganancia', '40.00');
    expect(shown(form, 'A+G')).toBe('S/ 100.00');
    fireEvent.click(within(form).getByRole('button', { name: 'Usar la calculada' }));
    expect(input(form, 'Ganancia').value).toBe('31.20');
    expect(shown(form, 'A+G')).toBe('S/ 91.20');
    // Acotado a "Resultado y ganancia" (Fase 11.1): el resumen financiero de la columna derecha
    // también rotula una celda "Cuota", sin relación con el ajuste de ganancia que prueba esto.
    const settlementSection = within(form).getByRole('region', { name: 'Resultado y ganancia' });
    expect(within(settlementSection).getByText('Cuota', { selector: 'dt' })).toBeTruthy();
  });

  it('perdida: A+G 0 y ganancia = −monto, sin campo para ajustarla', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6');
    press(form, 'Resultado', 'Perdida');
    expect(shown(form, 'A+G')).toBe('S/ 0.00');
    expect(shown(form, 'Ganancia calculada')).toBe('-S/ 60.00');
    expect(within(form).queryByLabelText('Ganancia')).toBeNull();
    setSettledAt(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta ya liquidada.')).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST')!.body as {
      settlement: Record<string, unknown>;
    };
    expect(body.settlement).toMatchObject({ status: 'LOST' });
    expect(body.settlement).not.toHaveProperty('officialRealizedReturn');
  });

  it('anulada: A+G = monto, ganancia fija en 0 sin campo editable, y se registra coherente', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6');
    press(form, 'Resultado', 'Anulada');
    expect(shown(form, 'A+G')).toBe('S/ 60.00');
    expect(shown(form, 'Ganancia calculada')).toBe('S/ 0.00');
    // No hay ninguna forma de escribir otra ganancia en una anulada.
    expect(within(form).queryByLabelText('Ganancia')).toBeNull();
    expect(within(form).queryByRole('textbox', { name: 'Ganancia' })).toBeNull();
    setSettledAt(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta ya liquidada.')).toBeTruthy();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1); // sigue siendo alta y liquidación en una sola operación
    const body = posts[0]!.body as { settlement: Record<string, unknown> };
    expect(body.settlement).toMatchObject({ status: 'VOID' });
    // Sin retorno indicado: la API guarda como retorno el monto (§21.4), ganancia 0.
    expect(body.settlement).not.toHaveProperty('officialRealizedReturn');
  });

  it('una ganancia escrita en ganada no se arrastra al cambiar a anulada', async () => {
    const { form } = await openForm();
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    change(form, 'Stake', '6');
    press(form, 'Resultado', 'Ganada');
    change(form, 'Ganancia', '50.00');
    press(form, 'Resultado', 'Anulada');
    expect(shown(form, 'A+G')).toBe('S/ 60.00');
    expect(shown(form, 'Ganancia calculada')).toBe('S/ 0.00');
  });

  it('sin bets.settle (Colaborador) no se ofrece resultado: la apuesta se registra pendiente', async () => {
    const { form, calls } = await openForm(COLLABORATOR, created);
    expect(within(form).queryByRole('group', { name: 'Resultado' })).toBeNull();
    // La etapa nunca se elige al registrar: siempre es la activa del proyecto.
    expect(within(form).queryByLabelText('Etapa')).toBeNull();
    fillSimple(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('settlement');
    expect(body).not.toHaveProperty('stageId');
  });

  it('formato Múltiple: un evento por tarjeta y cuota total aparte', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    press(form, 'Formato de apuesta', 'Múltiple');
    change(form, 'Partido de la selección 2', 'Real Madrid vs Barcelona');
    change(form, 'Pronóstico de la selección 2', 'Empate');
    change(form, 'Cuota de la selección 2', '3.10');
    change(form, 'Cuota total visible', '4.71');
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST')!.body as {
      visibleTotalOdds: string;
      selections: { eventGroup: number; position: number; event: string }[];
    };
    expect(body.visibleTotalOdds).toBe('4.71');
    expect(body.selections.map((s) => [s.eventGroup, s.position, s.event])).toEqual([
      [0, 0, 'Arsenal vs Manchester City'],
      [1, 0, 'Real Madrid vs Barcelona'],
    ]);
  });

  it('formato Creada: varias selecciones del mismo partido', async () => {
    const { form, calls } = await openForm({}, created);
    fillSimple(form);
    press(form, 'Formato de apuesta', 'Creada');
    // El partido es uno solo: la segunda selección no tiene su propio campo de partido.
    expect(within(form).queryByLabelText('Partido de la selección 2')).toBeNull();
    change(form, 'Pronóstico de la selección 2', 'Más de 2.5 goles');
    change(form, 'Cuota de la selección 2', '1.80');
    change(form, 'Cuota total visible', '2.50');
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST')!.body as {
      selections: { eventGroup: number; position: number; event: string }[];
    };
    expect(body.selections.map((s) => [s.eventGroup, s.position, s.event])).toEqual([
      [0, 0, 'Arsenal vs Manchester City'],
      [0, 1, 'Arsenal vs Manchester City'],
    ]);
  });

  it('formato Creada sin cuotas individuales: solo la cuota total, sin inventar ni distribuir nada (Fase 10.6)', async () => {
    const { form, calls } = await openForm({}, created);
    change(form, 'Casa', HOUSE_A);
    change(form, 'Fecha', '2026-06-01');
    change(form, 'Hora', '20:00');
    press(form, 'Formato de apuesta', 'Creada');
    change(form, 'Partido', 'Real Madrid vs. Barcelona');
    change(form, 'Pronóstico de la selección 1', 'Más de 2.5 goles');
    change(form, 'Pronóstico de la selección 2', 'Ambos marcan');
    // Ninguna selección tiene cuota individual: el campo está vacío y es opcional en Creada.
    expect(input(form, 'Cuota de la selección 1').value).toBe('');
    expect(within(form).getAllByText('Cuota de esta selección (opcional)')).toHaveLength(2);
    change(form, 'Cuota total visible', '3.42');
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.method === 'POST')!.body as {
      visibleTotalOdds: string;
      selections: { visibleOdds?: string }[];
    };
    expect(body.visibleTotalOdds).toBe('3.42');
    // Nunca se inventa ni se distribuye la cuota total entre las selecciones (§90).
    expect(body.selections.every((s) => s.visibleOdds === undefined)).toBe(true);
  });

  it('deporte: desplegable con Fútbol por defecto y "Otro…" para escribir uno distinto', async () => {
    const { form } = await openForm();
    change(form, 'Deporte', 'Tenis');
    expect(within(form).getByLabelText<HTMLSelectElement>('Deporte').value).toBe('Tenis');
    change(form, 'Deporte', 'Otro');
    change(form, 'Otro deporte (Deporte)', 'Pádel');
    expect(input(form, 'Otro deporte (Deporte)').value).toBe('Pádel');
  });

  it('"Más detalles" muestra el mercado de la selección', async () => {
    const { form } = await openForm();
    expect(within(form).queryByLabelText('Mercado de la selección 1')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Más detalles' }));
    expect(within(form).getByLabelText('Mercado de la selección 1')).toBeTruthy();
  });
});

describe('fechas en edición y liquidación (convención de la Fase 10.3)', () => {
  const localParts = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  };

  async function openEdit(extra: Record<string, Handler> = {}) {
    const stub = open(extra);
    renderApp(BETS_URL);
    await openRowAction('Editar');
    const form = screen.getByRole('form', { name: 'Editar apuesta de Betano' });
    return { ...stub, form };
  }

  it('editar una pendiente muestra la fecha y la hora guardadas, no las actuales', async () => {
    const { form } = await openEdit();
    const saved = localParts('2026-06-01T20:00:00.000Z'); // bet().placedAt
    expect(within(form).getByLabelText<HTMLInputElement>('Fecha').value).toBe(saved.date);
    expect(within(form).getByLabelText<HTMLInputElement>('Hora').value).toBe(saved.time);
    expect(await within(form).findByText('S/ 20.00')).toBeTruthy(); // 2 × 10, monto calculado
  });

  it('editar una pendiente: cuota guardada, el stake recalcula el monto y no hay control de resultado', async () => {
    const { form } = await openEdit();
    expect(within(form).getByLabelText<HTMLInputElement>('Cuota total visible').value).toBe('1.95');
    expect(within(form).getByLabelText<HTMLInputElement>('Stake').value).toBe('2.0000');
    expect(await within(form).findByLabelText('Monto apostado calculado')).toBeTruthy();
    expect(within(form).getByLabelText('Monto apostado calculado').textContent).toBe('S/ 20.00');
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '3' } });
    expect(within(form).getByLabelText('Monto apostado calculado').textContent).toBe('S/ 30.00');
    // El resultado no se cambia editando (la API no lo admite): se liquida o se corrige aparte.
    expect(within(form).queryByRole('group', { name: 'Resultado' })).toBeNull();
    expect(within(form).queryByText('Ganada')).toBeNull();
  });

  it('si no se toca la fecha, no se reenvía; si se cambia, se envía la nueva', async () => {
    const { form, calls } = await openEdit({
      [`PATCH ${BETS_URL}/${BET_ID}`]: { status: 200, body: bet() },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Se guardaron los cambios.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')!.body).not.toHaveProperty('placedAt');

    await openRowAction('Editar');
    const again = screen.getByRole('form', { name: 'Editar apuesta de Betano' });
    fireEvent.change(within(again).getByLabelText('Hora'), { target: { value: '18:30' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Se guardaron los cambios.');
    const patches = calls.filter((c) => c.method === 'PATCH');
    const date = localParts('2026-06-01T20:00:00.000Z').date;
    expect(patches.at(-1)!.body).toMatchObject({
      placedAt: new Date(`${date}T18:30`).toISOString(),
    });
  });

  it('una liquidada no ofrece editar su fecha (solo el motivo)', async () => {
    open({
      [`GET ${BETS_URL}`]: { status: 200, body: [bet({ status: 'LOST', profitLoss: '-20.00' })] },
    });
    renderApp(BETS_URL);
    await openRowAction('Editar');
    const form = screen.getByRole('form', { name: 'Editar apuesta de Betano' });
    expect(within(form).queryByLabelText('Fecha')).toBeNull();
    expect(within(form).getByText(/solo se puede corregir el motivo/)).toBeTruthy();
  });

  it('la lista muestra la cuota efectiva cuando el retorno oficial no cuadra con la visible', async () => {
    open({
      [`GET ${BETS_URL}`]: {
        status: 200,
        body: [
          bet({
            status: 'WON',
            visibleTotalOdds: '1.56',
            effectiveAmount: '60.00',
            officialRealizedReturn: '94.07',
            effectiveReturn: '94.07',
            returnSource: 'OFFICIAL',
            effectiveOdds: '1.567833',
            profitLoss: '34.07',
          }),
        ],
      },
    });
    renderApp(BETS_URL);
    await screen.findByRole('button', { name: /^Estado:/ });
    expect(screen.getByText('Cuota', { selector: 'dt' }).nextElementSibling!.textContent).toBe(
      '1.56 Cuota efectiva 1.567833',
    );
  });
});

describe('liquidar una pendiente (H-14, Fase 10.3): misma sección de resultado que el alta', () => {
  // bet(): monto efectivo S/ 20.00 (stake 2 × unidad 10), cuota visible 1.95.
  const SETTLE_URL = `${BETS_URL}/${BET_ID}/settle`;
  const settledBody = (overrides: Record<string, unknown> = {}) => ({
    status: 200,
    body: bet({ status: 'WON', profitLoss: '19.00', ...overrides }),
  });

  async function openSettle(extra: Record<string, Handler> = {}) {
    const stub = open(extra);
    renderApp(BETS_URL);
    await chooseRowStatus('Ganada');
    const form = screen.getByRole('form', { name: 'Liquidar apuesta de Betano' });
    return { ...stub, form };
  }
  const shown = (form: HTMLElement, label: string) =>
    within(form).getByLabelText(label).textContent;
  const press = (form: HTMLElement, name: string) =>
    fireEvent.click(
      within(within(form).getByRole('group', { name: 'Resultado' })).getByRole('button', { name }),
    );
  function setDate(form: HTMLElement) {
    fireEvent.change(within(form).getByLabelText('Fecha de liquidación'), {
      target: { value: '2026-06-02' },
    });
    fireEvent.change(within(form).getByLabelText('Hora de liquidación'), {
      target: { value: '22:00' },
    });
  }
  const submit = (form: HTMLElement) =>
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar liquidación' }));

  it('propone el momento actual como fecha de liquidación, editable', async () => {
    const before = Date.now();
    const { form } = await openSettle();
    const date = within(form).getByLabelText<HTMLInputElement>('Fecha de liquidación');
    const time = within(form).getByLabelText<HTMLInputElement>('Hora de liquidación');
    expect(Math.abs(new Date(`${date.value}T${time.value}`).getTime() - before)).toBeLessThan(
      120_000,
    );
    fireEvent.change(date, { target: { value: '2026-06-02' } });
    expect(date.value).toBe('2026-06-02');
  });

  it('ganada: muestra la ganancia calculada y A+G, y sin tocarla liquida con el retorno calculado', async () => {
    const { form, calls } = await openSettle({ [`POST ${SETTLE_URL}`]: settledBody() });
    expect(within(form).getByText(/Monto apostado/).textContent).toMatch(/S\/ 20.00.*1.95/);
    // Ganada es el resultado propuesto.
    expect(
      within(within(form).getByRole('group', { name: 'Resultado' }))
        .getByRole('button', { name: 'Ganada' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(shown(form, 'A+G')).toBe('S/ 39.00'); // 20 × 1.95
    expect(within(form).getByLabelText<HTMLInputElement>('Ganancia').value).toBe('19.00');
    expect(shown(form, 'Cuota resultante')).toBe('1.95');
    setDate(form);
    submit(form);
    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.path === SETTLE_URL)!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'WON',
      settledAt: new Date('2026-06-02T22:00').toISOString(),
      version: 1,
    });
    // Sin ajuste: la API guarda el retorno calculado (provisional, a confirmar después).
    expect(body).not.toHaveProperty('officialRealizedReturn');
  });

  it('ganancia ajustada: actualiza A+G, muestra la cuota efectiva y la envía como retorno oficial', async () => {
    const { form, calls } = await openSettle({ [`POST ${SETTLE_URL}`]: settledBody() });
    fireEvent.change(within(form).getByLabelText('Ganancia'), { target: { value: '19.50' } });
    expect(shown(form, 'A+G')).toBe('S/ 39.50');
    expect(within(form).getByText('Cuota efectiva')).toBeTruthy();
    expect(shown(form, 'Cuota resultante')).toBe('1.975'); // 39.50 ÷ 20
    expect(within(form).getByText(/La casa muestra 1.95/)).toBeTruthy();
    setDate(form);
    submit(form);
    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.path === SETTLE_URL)!.body as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'WON', officialRealizedReturn: '39.50' });
    // La cuota visible no viaja al liquidar: se conserva la guardada (regla crítica 6).
    expect(body).not.toHaveProperty('visibleTotalOdds');
  });

  it('perdida: A+G 0 y ganancia −monto, sin campo editable ni retorno', async () => {
    const { form, calls } = await openSettle({
      [`POST ${SETTLE_URL}`]: settledBody({ status: 'LOST', profitLoss: '-20.00' }),
    });
    press(form, 'Perdida');
    expect(shown(form, 'A+G')).toBe('S/ 0.00');
    expect(shown(form, 'Ganancia calculada')).toBe('-S/ 20.00');
    expect(within(form).queryByLabelText('Ganancia')).toBeNull();
    setDate(form);
    submit(form);
    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.path === SETTLE_URL)!.body as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'LOST' });
    expect(body).not.toHaveProperty('officialRealizedReturn');
  });

  it('anulada: A+G = monto y ganancia fija en 0, sin campo editable', async () => {
    const { form, calls } = await openSettle({
      [`POST ${SETTLE_URL}`]: settledBody({ status: 'VOID', profitLoss: '0.00' }),
    });
    press(form, 'Anulada');
    expect(shown(form, 'A+G')).toBe('S/ 20.00');
    expect(shown(form, 'Ganancia calculada')).toBe('S/ 0.00');
    expect(within(form).queryByLabelText('Ganancia')).toBeNull();
    setDate(form);
    submit(form);
    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    const body = calls.find((c) => c.path === SETTLE_URL)!.body as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'VOID' });
    expect(body).not.toHaveProperty('officialRealizedReturn');
  });

  it('cash out: la ganancia es obligatoria (validación existente) y fija el retorno oficial', async () => {
    const { form, calls } = await openSettle({
      [`POST ${SETTLE_URL}`]: settledBody({ status: 'CASHOUT', profitLoss: '-5.00' }),
    });
    press(form, 'Cash Out');
    setDate(form);
    submit(form);
    expect(
      await within(form).findByText('Un cash out exige el retorno oficial realizado.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.path === SETTLE_URL)).toBe(false);
    fireEvent.change(within(form).getByLabelText('Ganancia'), { target: { value: '-5.00' } });
    expect(shown(form, 'A+G')).toBe('S/ 15.00');
    submit(form);
    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    expect(calls.find((c) => c.path === SETTLE_URL)!.body).toMatchObject({
      status: 'CASHOUT',
      officialRealizedReturn: '15.00',
    });
  });

  it('muestra el rechazo de la API (p. ej. liquidación anterior a la colocación)', async () => {
    const { form } = await openSettle({
      [`POST ${SETTLE_URL}`]: apiError(
        409,
        'INVALID_STATE',
        'La fecha de liquidación no puede ser anterior a la de colocación.',
      ),
    });
    setDate(form);
    submit(form);
    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Se liquidó la apuesta.')).toBeNull();
  });
});

describe('tarjeta de apuesta: Ver ticket, Estado y menú ⋮ (Fase 10.3)', () => {
  const settledWon = (overrides: Record<string, unknown> = {}) =>
    bet({
      status: 'WON',
      officialRealizedReturn: '39.00',
      effectiveReturn: '39.00',
      returnSource: 'OFFICIAL',
      profitLoss: '19.00',
      settledAt: '2026-06-01T22:00:00.000Z',
      ...overrides,
    });
  const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);
  const withPermissions = (permissions: string[]) =>
    projectDetail({ isOwner: false, myRole: 'PROJECT_ADMIN', myPermissions: permissions });

  it('muestra fecha, tipo, casa, partido, cuota, importe, A+G, ganancia y estado', async () => {
    open({
      [`GET ${BETS_URL}`]: {
        status: 200,
        body: [settledWon({ events: ['Arsenal vs Manchester City'] })],
      },
    });
    renderApp(BETS_URL);
    expect(await screen.findByText('Arsenal vs Manchester City')).toBeTruthy();
    expect(screen.getByText(/Betano · Simple/)).toBeTruthy();
    const value = (term: string) =>
      screen.getByText(term, { selector: 'dt' }).nextElementSibling!.textContent;
    expect(value('Cuota')).toBe('1.95');
    expect(value('Importe')).toBe('S/ 20.00 (calculado)');
    expect(value('A+G')).toBe('S/ 39.00 (oficial)');
    // La ganancia lleva signo: no depende solo del color.
    expect(value('Ganancia')).toBe('+S/ 19.00');
    expect(screen.getByRole('button', { name: 'Estado: Ganada' })).toBeTruthy();
  });

  it('Editar y Eliminar están a la vista; el menú ⋮ agrupa las acciones secundarias', async () => {
    open();
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }));
    expect(screen.getByRole('menu', { name: 'Más acciones' })).toBeTruthy();
    expect(menuItems()).toEqual(
      expect.arrayContaining(['Mover de etapa', 'Adjuntar o analizar ticket']),
    );
    expect(menuItems()).not.toContain('Editar');
    expect(menuItems()).not.toContain('Eliminar');
    // Las acciones frecuentes son botones permanentes sobre la tarjeta (10.3e).
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeTruthy();
    // El menú se recorre con las flechas y se cierra con Escape.
    expect(document.activeElement?.textContent).toBe(menuItems()[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe(menuItems()[1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('"Editar" abre el formulario de edición de siempre', async () => {
    open();
    renderApp(BETS_URL);
    await openRowAction('Editar');
    expect(screen.getByRole('form', { name: 'Editar apuesta de Betano' })).toBeTruthy();
  });

  it('con ticket: "Ver ticket" lo muestra solo para ver (sin subir ni analizar)', async () => {
    open({
      [`GET ${BETS_URL}`]: { status: 200, body: [bet({ ticketCount: 1 })] },
      [`GET ${BETS_URL}/${BET_ID}`]: {
        status: 200,
        body: {
          ...bet({ ticketCount: 1 }),
          selections: [],
          tickets: [
            {
              id: '0195f7c0-0000-7000-8000-0000000000c1',
              projectId: PROJECT_ID,
              betId: BET_ID,
              originalFileName: 'ticket-betano.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 123,
              uploadedBy: { id: ANA.id, name: 'Ana Pérez' },
              createdAt: '2026-06-01T20:00:00.000Z',
              lastAnalysis: null,
            },
          ],
        },
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver ticket' }));
    expect(await screen.findByText('ticket-betano.jpg')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'ticket-betano.jpg' })).toBeTruthy();
    expect(screen.queryByText('Adjuntar ticket')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leer ticket con IA' })).toBeNull();
  });

  it('sin ticket: no aparenta tener uno (botón "Sin ticket" deshabilitado)', async () => {
    open();
    renderApp(BETS_URL);
    const noTicket = await screen.findByRole('button', { name: 'Sin ticket' });
    expect(noTicket).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Ver ticket' })).toBeNull();
  });

  it('pendiente: el selector ofrece los resultados válidos y abre "Liquidar" con el elegido', async () => {
    open();
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Estado: Pendiente' }));
    expect(menuItems()).toEqual(['Ganada', 'Perdida', 'Anulada', 'Cash Out']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Perdida' }));
    // No liquida nada todavía: abre el formulario de liquidación con Perdida elegida.
    const form = screen.getByRole('form', { name: 'Liquidar apuesta de Betano' });
    const pressed = (name: string) =>
      within(within(form).getByRole('group', { name: 'Resultado' }))
        .getByRole('button', { name })
        .getAttribute('aria-pressed');
    expect(pressed('Perdida')).toBe('true');
    expect(within(form).getByLabelText('A+G').textContent).toBe('S/ 0.00');
  });

  it('elegir Anulada o Cash out abre "Liquidar" con sus reglas (anulada fija, cash out exige ganancia)', async () => {
    open();
    renderApp(BETS_URL);
    await chooseRowStatus('Anulada');
    let form = screen.getByRole('form', { name: 'Liquidar apuesta de Betano' });
    expect(within(form).getByLabelText('Ganancia calculada').textContent).toBe('S/ 0.00');
    expect(within(form).queryByLabelText('Ganancia')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await chooseRowStatus('Cash Out');
    form = screen.getByRole('form', { name: 'Liquidar apuesta de Betano' });
    expect(within(form).getByLabelText<HTMLInputElement>('Ganancia').placeholder).toBe(
      'Obligatoria',
    );
  });

  it('elegir Ganada abre "Liquidar" y liquida por el flujo de siempre', async () => {
    const { calls } = open({
      [`POST ${BETS_URL}/${BET_ID}/settle`]: {
        status: 200,
        body: bet({ status: 'WON', profitLoss: '19.00' }),
      },
    });
    renderApp(BETS_URL);
    await chooseRowStatus('Ganada');
    expect(calls.some((c) => c.method === 'POST')).toBe(false); // elegir no liquida
    const form = screen.getByRole('form', { name: 'Liquidar apuesta de Betano' });
    expect(within(form).getByLabelText('A+G').textContent).toBe('S/ 39.00');
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar liquidación' }));
    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    expect(calls.filter((c) => c.path === `${BETS_URL}/${BET_ID}/settle`)).toHaveLength(1);
  });

  it('liquidada: el selector solo ofrece otros resultados (Corregir liquidación) o reabrir', async () => {
    open({ [`GET ${BETS_URL}`]: { status: 200, body: [settledWon()] } });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Estado: Ganada' }));
    expect(menuItems()).toEqual(['Perdida', 'Anulada', 'Cash Out', 'Pendiente (reabrir)']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Perdida' }));
    const form = screen.getByRole('form', { name: 'Corregir liquidación de la apuesta de Betano' });
    expect(within(form).getByLabelText<HTMLSelectElement>('Resultado').value).toBe('LOST');
    // Sigue exigiendo motivo e impacto antes de aplicar: nada se envía todavía.
    expect(within(form).getByLabelText(/Motivo de la corrección/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await chooseRowStatus('Pendiente (reabrir)');
    expect(screen.getByRole('form', { name: 'Reabrir la apuesta de Betano' })).toBeTruthy();
  });

  it('liquidada sin bets.correct: el estado solo se muestra, sin transiciones', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: withPermissions(OWNER_PERMISSIONS.filter((p) => p !== 'bets.correct')),
      },
      [`GET ${BETS_URL}`]: { status: 200, body: [settledWon()] },
    });
    renderApp(BETS_URL);
    expect(await screen.findByLabelText('Estado: Ganada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Estado:/ })).toBeNull();
  });

  it('pendiente sin bets.settle: el estado solo se muestra, no se puede liquidar desde aquí', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: withPermissions(OWNER_PERMISSIONS.filter((p) => p !== 'bets.settle')),
      },
    });
    renderApp(BETS_URL);
    expect(await screen.findByLabelText('Estado: Pendiente')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Estado:/ })).toBeNull();
  });
});

describe('lista de apuestas: filtros, búsqueda y lectura (10.3e)', () => {
  const won = (overrides: Record<string, unknown> = {}) =>
    bet({
      status: 'WON',
      officialRealizedReturn: '39.00',
      effectiveReturn: '39.00',
      returnSource: 'OFFICIAL',
      profitLoss: '19.00',
      settledAt: '2026-06-01T22:00:00.000Z',
      ...overrides,
    });
  const twoBets = () =>
    open({
      [`GET ${BETS_URL}`]: {
        status: 200,
        body: [
          won({
            id: '0195f7c0-0000-7000-8000-0000000000b2',
            events: ['Nadal vs Alcaraz'],
            sports: ['Tenis'],
          }),
          bet({ events: ['Arsenal vs Chelsea'], sports: ['Fútbol'] }),
        ],
      },
    });

  it('filtra por estado con conteos, sin pedir nada nuevo a la API', async () => {
    const { calls } = twoBets();
    renderApp(BETS_URL);
    await screen.findByText('Nadal vs Alcaraz');
    const filters = screen.getByRole('group', { name: 'Filtrar por estado' });
    expect(within(filters).getByRole('button', { name: /Todas\s*2/ })).toBeTruthy();
    const before = calls.length;
    fireEvent.click(within(filters).getByRole('button', { name: /Pendientes/ }));
    expect(screen.queryByText('Nadal vs Alcaraz')).toBeNull();
    expect(screen.getByText('Arsenal vs Chelsea')).toBeTruthy();
    expect(calls.length).toBe(before);
  });

  it('busca por partido, casa o deporte, y ofrece volver a ver todas', async () => {
    twoBets();
    renderApp(BETS_URL);
    await screen.findByText('Nadal vs Alcaraz');
    const search = screen.getByRole('searchbox', { name: 'Buscar apuestas' });
    fireEvent.change(search, { target: { value: 'tenis' } });
    expect(screen.getByText('Nadal vs Alcaraz')).toBeTruthy();
    expect(screen.queryByText('Arsenal vs Chelsea')).toBeNull();
    fireEvent.change(search, { target: { value: 'baloncesto' } });
    expect(screen.getByText(/Ninguna apuesta coincide/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
    expect(screen.getByText('Arsenal vs Chelsea')).toBeTruthy();
  });

  it('explica cómo leer cada apuesta (stake, importe, cuota, A+G, ganancia)', async () => {
    twoBets();
    renderApp(BETS_URL);
    await screen.findByText('Nadal vs Alcaraz');
    for (const term of [
      'Stake',
      'Importe apostado',
      'Cuota',
      'A+G (apostado + ganancia)',
      'Ganancia',
    ]) {
      expect(screen.getByRole('button', { name: `¿Qué es ${term}?` })).toBeTruthy();
    }
  });

  it('el estado se muestra con texto e icono, no solo con color', async () => {
    twoBets();
    renderApp(BETS_URL);
    const status = await screen.findByRole('button', { name: 'Estado: Ganada' });
    expect(status.textContent).toContain('Ganada');
    expect(status.querySelector('svg')).toBeTruthy();
  });

  it('"Añadir apuesta" avisa si el importe supera el disponible de la casa', async () => {
    open();
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = await screen.findByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
    expect(within(form).getByText(/Disponible/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Otra cantidad' }));
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '100' } });
    expect(within(form).getByText(/El importe supera el disponible de Betano/)).toBeTruthy();
  });

  it('el importe muestra de dónde sale: stake × unidad', async () => {
    open();
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = await screen.findByRole('form', { name: 'Añadir apuesta' });
    fireEvent.click(await within(form).findByRole('button', { name: 'Otra cantidad' }));
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '3' } });
    expect(within(form).getByText('3 × S/ 10.00 (stake × unidad)')).toBeTruthy();
  });
});

describe('apuestas en la zona horaria del proyecto (§93, H-20)', () => {
  const tokyo = {
    [`GET ${URL}`]: { status: 200, body: projectDetail({ timezone: 'Asia/Tokyo' }) },
  };

  it('la lista muestra el momento en la zona del proyecto', async () => {
    open({
      ...tokyo,
      [`GET ${BETS_URL}`]: { status: 200, body: [bet({ placedAt: '2026-06-01T20:00:00.000Z' })] },
    });
    renderApp(BETS_URL);
    // 20:00 UTC del 1 de junio = 05:00 del 2 de junio en Tokio.
    expect(await screen.findByText(/2 jun\. 2026, 5:00/)).toBeTruthy();
  });

  it('una hora desconocida no se muestra inventada (p. ej. las 12:00 de una importación)', async () => {
    open({
      [`GET ${BETS_URL}`]: {
        status: 200,
        body: [bet({ placedAt: '2026-06-01T17:00:00.000Z', placedTimeKnown: false })],
      },
    });
    renderApp(BETS_URL);
    expect(await screen.findByText(/1 jun\. 2026 \(hora desconocida\)/)).toBeTruthy();
    expect(screen.queryByText(/12:00/)).toBeNull();
  });

  it('al registrar, la fecha y la hora escritas son las del proyecto', async () => {
    const { calls } = open({
      ...tokyo,
      [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir apuesta' }));
    const form = screen.getByRole('form', { name: 'Añadir apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });
    expect(within(form).getAllByText('Hora del proyecto (Asia/Tokyo).').length).toBeGreaterThan(0);
    fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
    fireEvent.change(within(form).getByLabelText('Fecha'), { target: { value: '2026-06-01' } });
    fireEvent.change(within(form).getByLabelText('Hora'), { target: { value: '10:00' } });
    fireEvent.change(within(form).getByLabelText('Partido'), {
      target: { value: 'A vs B' },
    });
    fireEvent.change(within(form).getByLabelText('Pronóstico de la selección 1'), {
      target: { value: 'Gana A' },
    });
    fireEvent.change(within(form).getByLabelText('Cuota de la selección 1'), {
      target: { value: '1.95' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const created = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!;
    // 10:00 en Tokio (UTC+9) = 01:00 UTC.
    expect((created.body as { placedAt: string }).placedAt).toBe('2026-06-01T01:00:00.000Z');
  });

  it('al editar, se abre con la fecha y la hora guardadas, leídas en la zona del proyecto', async () => {
    open({
      ...tokyo,
      [`GET ${BETS_URL}`]: { status: 200, body: [bet({ placedAt: '2026-06-01T01:00:00.000Z' })] },
    });
    renderApp(BETS_URL);
    await openRowAction('Editar');
    const form = screen.getByRole('form', { name: 'Editar apuesta de Betano' });
    expect(within(form).getByLabelText<HTMLInputElement>('Fecha').value).toBe('2026-06-01');
    expect(within(form).getByLabelText<HTMLInputElement>('Hora').value).toBe('10:00');
  });
});
