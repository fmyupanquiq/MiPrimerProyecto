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
    expect(await screen.findByText('Pendiente')).toBeTruthy();
    expect(screen.getByText(/Stake 2.0000/)).toBeTruthy();
    expect(screen.getByText(/S\/ 20.00 \(calculado\)/)).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Registrar apuesta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Liquidar' })).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    // ...pero liquidar no depende de la propiedad: sin bets.settle, no se ofrece.
    expect(screen.queryByRole('button', { name: 'Liquidar' })).toBeNull();
  });

  it('registra una apuesta simple', async () => {
    const { calls } = open({
      [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar apuesta' }));
    const form = screen.getByRole('form', { name: 'Registrar apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '2' } });
    fireEvent.change(within(form).getByLabelText('Cuota total visible'), {
      target: { value: '1.95' },
    });
    fireEvent.change(within(form).getByLabelText('Fecha y hora de colocación'), {
      target: { value: '2026-06-01T20:00' },
    });
    fireEvent.change(within(form).getByLabelText('Evento de la selección 1'), {
      target: { value: 'Real Madrid vs. Barcelona' },
    });
    fireEvent.change(within(form).getByLabelText('Selección 1'), {
      target: { value: 'Real Madrid gana' },
    });
    fireEvent.change(within(form).getByLabelText('Cuota de la selección 1'), {
      target: { value: '1.95' },
    });
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
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar apuesta' }));
    const form = screen.getByRole('form', { name: 'Registrar apuesta' });
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));
    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('liquida una apuesta como ganada', async () => {
    const { calls } = open({
      [`POST ${BETS_URL}/${BET_ID}/settle`]: {
        status: 200,
        body: bet({ status: 'WON', officialRealizedReturn: '39.00', profitLoss: '19.00' }),
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Liquidar' }));
    const form = screen.getByRole('form', { name: `Liquidar apuesta de Betano` });
    fireEvent.change(within(form).getByLabelText('Retorno oficial'), {
      target: { value: '39.00' },
    });
    fireEvent.change(within(form).getByLabelText('Fecha y hora de liquidación'), {
      target: { value: '2026-06-02T22:00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar liquidación' }));

    expect(await screen.findByText('Se liquidó la apuesta.')).toBeTruthy();
    const settled = calls.find((c) => c.path === `${BETS_URL}/${BET_ID}/settle`)!;
    expect(settled.body).toMatchObject({ status: 'WON', officialRealizedReturn: '39.00' });
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
    fireEvent.click(await screen.findByRole('button', { name: 'Mover de etapa' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Papelera' }));
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

  it('sube un ticket huérfano y lo vincula al registrar la apuesta', async () => {
    const { calls } = open({
      [`POST ${URL}/tickets`]: { status: 201, body: ticket() },
      [`POST ${BETS_URL}`]: { status: 201, body: bet({ id: 'nueva' }) },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar apuesta' }));
    const form = screen.getByRole('form', { name: 'Registrar apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    expect(await within(form).findByText('ticket.jpg')).toBeTruthy();

    fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
    fireEvent.change(within(form).getByLabelText('Stake'), { target: { value: '2' } });
    fireEvent.change(within(form).getByLabelText('Cuota total visible'), {
      target: { value: '1.95' },
    });
    fireEvent.change(within(form).getByLabelText('Fecha y hora de colocación'), {
      target: { value: '2026-06-01T20:00' },
    });
    fireEvent.change(within(form).getByLabelText('Evento de la selección 1'), {
      target: { value: 'Real Madrid vs. Barcelona' },
    });
    fireEvent.change(within(form).getByLabelText('Selección 1'), {
      target: { value: 'Real Madrid gana' },
    });
    fireEvent.change(within(form).getByLabelText('Cuota de la selección 1'), {
      target: { value: '1.95' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar apuesta' }));

    expect(await screen.findByText('Se registró la apuesta.')).toBeTruthy();
    const created = calls.find((c) => c.method === 'POST' && c.path === BETS_URL)!;
    expect(created.body).toMatchObject({ ticketId: TICKET_ID });
  });

  it('analiza un ticket y aplica un campo propuesto al formulario (D-T5)', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar apuesta' }));
    const form = screen.getByRole('form', { name: 'Registrar apuesta' });
    await within(form).findByRole('option', { name: 'Betano' });

    const file = new File(['contenido'], 'ticket.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Adjuntar ticket'), { target: { files: [file] } });
    fireEvent.click(await within(form).findByRole('button', { name: 'Analizar con IA' }));

    fireEvent.click(await within(form).findByRole('button', { name: 'Usar este valor' }));
    expect(within(form).getByLabelText<HTMLInputElement>('Monto oficial (opcional)').value).toBe(
      '25.00',
    );
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
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar apuesta' }));
    const form = screen.getByRole('form', { name: 'Registrar apuesta' });
    expect(within(form).queryByLabelText('Adjuntar ticket')).toBeNull();
  });

  it('el botón Tickets de una apuesta ya registrada carga y muestra sus tickets', async () => {
    open({
      [`GET ${BETS_URL}/${BET_ID}`]: {
        status: 200,
        body: { ...bet(), selections: [], tickets: [ticket({ originalFileName: 'antiguo.pdf' })] },
      },
    });
    renderApp(BETS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Tickets' }));
    expect(await screen.findByText('antiguo.pdf')).toBeTruthy();
  });
});
