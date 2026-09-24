import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
  apiError,
  AUTH_STATE,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  type Handler,
} from '../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const FINANCE_URL = `${URL}/finance`;
const HOUSES_URL = `${URL}/houses`;
const MOVEMENTS_URL = `${URL}/movements`;
const WITHDRAWALS_URL = `${URL}/withdrawals`;

const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const HOUSE_B = '0195f7c0-0000-7000-8000-0000000000a2';
const WITHDRAWAL_ID = '0195f7c0-0000-7000-8000-0000000000d1';

const house = (overrides: Record<string, unknown> = {}) => ({
  id: HOUSE_A,
  projectId: PROJECT_ID,
  name: 'Betano',
  status: 'ACTIVE',
  balance: '500.00',
  committed: '0.00',
  available: '500.00',
  createdAt: '2026-06-01T12:00:00.000Z',
  ...overrides,
});

const withdrawal = (overrides: Record<string, unknown> = {}) => ({
  id: WITHDRAWAL_ID,
  projectId: PROJECT_ID,
  stageId: 'e1',
  houseId: HOUSE_A,
  houseName: 'Betano',
  amount: '100.00',
  reason: 'Retiro de ganancias',
  status: 'PENDING',
  requestedBy: { id: ANA.id, name: 'Ana Pérez' },
  requestedAt: '2026-06-01T12:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  movementId: null,
  version: 1,
  ...overrides,
});

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail() },
    [`GET ${HOUSES_URL}`]: { status: 200, body: [house()] },
    [`GET ${MOVEMENTS_URL}`]: { status: 200, body: [] },
    [`GET ${WITHDRAWALS_URL}`]: { status: 200, body: [] },
    [`GET ${HOUSES_URL}/${HOUSE_A}/reconciliations/status`]: {
      status: 200,
      body: { houseId: HOUSE_A, requiresReconciliation: true, lastMatchedCheckpoint: null },
    },
    [`GET ${HOUSES_URL}/${HOUSE_A}/reconciliations`]: { status: 200, body: [] },
    ...extra,
  });
}

describe('casas y finanzas del proyecto (§13-§17, §49)', () => {
  it('antes de completar el setup, remite a la configuración inicial', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({ setupComplete: false, activeStage: null }),
      },
    });
    renderApp(FINANCE_URL);
    expect(
      await screen.findByRole('link', { name: /configuración inicial del proyecto/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Betano')).toBeNull();
  });

  it('lista casas con saldo, comprometido y disponible', async () => {
    open();
    renderApp(FINANCE_URL);
    const cell = await screen.findByRole('cell', { name: 'Betano' });
    const row = cell.closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual([
      'Betano',
      'Activa',
      'S/ 500.00',
      'S/ 0.00',
      'S/ 500.00',
      'Desactivar',
    ]);
  });

  it('sin permisos financieros, no se ofrece crear casas ni registrar movimientos', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          isOwner: false,
          myRole: 'READER',
          myPermissions: ['project.view', 'stages.view', 'houses.view', 'movements.view'],
        }),
      },
    });
    renderApp(FINANCE_URL);
    await screen.findByText('Betano');
    expect(screen.queryByRole('button', { name: 'Nueva casa' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Registrar movimiento' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Solicitar retiro' })).toBeNull();
  });

  it('crea una casa nueva', async () => {
    const { calls } = open({
      [`POST ${HOUSES_URL}`]: { status: 201, body: house({ id: HOUSE_B, name: 'Betsafe' }) },
    });
    renderApp(FINANCE_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva casa' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Betsafe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(await screen.findByText('Se añadió la casa «Betsafe».')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST' && c.path === HOUSES_URL)!.body).toEqual({
      name: 'Betsafe',
    });
  });

  it('desactiva y reactiva una casa', async () => {
    let active = true;
    const { calls } = open({
      [`GET ${HOUSES_URL}`]: () => ({
        status: 200,
        body: [house({ status: active ? 'ACTIVE' : 'INACTIVE' })],
      }),
      [`POST ${HOUSES_URL}/${HOUSE_A}/deactivate`]: () => {
        active = false;
        return { status: 200, body: { id: HOUSE_A } };
      },
    });
    renderApp(FINANCE_URL);
    fireEvent.click(await screen.findByLabelText('Desactivar Betano'));
    expect(await screen.findByText('Se desactivó «Betano».')).toBeTruthy();
    expect(await screen.findByLabelText('Reactivar Betano')).toBeTruthy();
    expect(calls.some((c) => c.path === `${HOUSES_URL}/${HOUSE_A}/deactivate`)).toBe(true);
  });

  describe('registrar movimiento', () => {
    it('solo ofrece los tipos permitidos por el rol', async () => {
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
              'movements.deposit',
            ],
          }),
        },
      });
      renderApp(FINANCE_URL);
      const group = await screen.findByRole('group', { name: 'Tipo de movimiento' });
      expect(within(group).getByRole('button', { name: 'Depósito' })).toBeTruthy();
      expect(within(group).queryByRole('button', { name: 'Transferencia' })).toBeNull();
      expect(within(group).queryByRole('button', { name: 'Extraordinario' })).toBeNull();
    });

    it('registra un depósito', async () => {
      const { calls } = open({
        [`POST ${MOVEMENTS_URL}/deposits`]: {
          status: 201,
          body: { id: 'm1', amount: '50.00' },
        },
      });
      renderApp(FINANCE_URL);
      const form = await screen.findByRole('form', { name: 'Depósito' });
      // Espera a que las casas terminen de cargar antes de elegir una: si se interactúa con el
      // <select> mientras `GET /houses` sigue pendiente, no hay opción «Betano» que seleccionar.
      await within(form).findByRole('option', { name: 'Betano' });
      fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
      fireEvent.change(within(form).getByLabelText('Monto'), { target: { value: '50' } });
      fireEvent.change(within(form).getByLabelText('Motivo (opcional)'), {
        target: { value: 'Recarga' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar depósito' }));

      expect(await screen.findByText('Se registró el depósito.')).toBeTruthy();
      expect(calls.find((c) => c.path === `${MOVEMENTS_URL}/deposits`)!.body).toEqual({
        houseId: HOUSE_A,
        amount: '50.00',
        reason: 'Recarga',
      });
    });

    it('transferencia: exige casas distintas y registra la transferencia', async () => {
      const { calls } = open({
        [`GET ${HOUSES_URL}`]: {
          status: 200,
          body: [house(), house({ id: HOUSE_B, name: 'Betsafe' })],
        },
        [`POST ${MOVEMENTS_URL}/transfers`]: {
          status: 201,
          body: { id: 'm2', amount: '30.00' },
        },
      });
      renderApp(FINANCE_URL);
      const group = await screen.findByRole('group', { name: 'Tipo de movimiento' });
      fireEvent.click(within(group).getByRole('button', { name: 'Transferencia' }));
      const form = screen.getByRole('form', { name: 'Transferencia' });
      await within(form).findAllByRole('option', { name: 'Betsafe' });

      fireEvent.change(within(form).getByLabelText('Desde'), { target: { value: HOUSE_A } });
      fireEvent.change(within(form).getByLabelText('Monto'), { target: { value: '30' } });
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar transferencia' }));
      expect(await within(form).findByRole('alert')).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

      fireEvent.change(within(form).getByLabelText('Hacia'), { target: { value: HOUSE_B } });
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar transferencia' }));

      expect(await screen.findByText('Se registró la transferencia.')).toBeTruthy();
      expect(calls.find((c) => c.path === `${MOVEMENTS_URL}/transfers`)!.body).toEqual({
        fromHouseId: HOUSE_A,
        toHouseId: HOUSE_B,
        amount: '30.00',
      });
    });

    it('extraordinario exige motivo y contraseña reciente', async () => {
      let reauthed = false;
      const { calls } = open({
        [`POST ${MOVEMENTS_URL}/extraordinary`]: () =>
          reauthed
            ? { status: 201, body: { id: 'm3', amount: '20.00' } }
            : apiError(403, 'REAUTH_REQUIRED'),
        'POST /auth/reauth': () => {
          reauthed = true;
          return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
        },
      });
      renderApp(FINANCE_URL);
      const group = await screen.findByRole('group', { name: 'Tipo de movimiento' });
      fireEvent.click(within(group).getByRole('button', { name: 'Extraordinario' }));
      const form = screen.getByRole('form', { name: 'Extraordinario' });
      await within(form).findByRole('option', { name: 'Betano' });

      fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
      fireEvent.change(within(form).getByLabelText('Monto'), { target: { value: '20' } });
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar movimiento' }));
      expect(await within(form).findByRole('alert')).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

      fireEvent.change(within(form).getByLabelText('Motivo'), {
        target: { value: 'Cashback de la casa' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Registrar movimiento' }));

      const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'mi-clave-secreta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText('Se registró el movimiento extraordinario.')).toBeTruthy();
      const posts = calls.filter((c) => c.path === `${MOVEMENTS_URL}/extraordinary`);
      expect(posts).toHaveLength(2);
      expect(posts[1]!.body).toEqual({
        houseId: HOUSE_A,
        amount: '20.00',
        direction: 'CREDIT',
        reason: 'Cashback de la casa',
      });
    });
  });

  describe('historial de movimientos', () => {
    it('sin movimientos, muestra el aviso correspondiente', async () => {
      open();
      renderApp(FINANCE_URL);
      expect(await screen.findByText('Todavía no hay movimientos.')).toBeTruthy();
    });

    it('lista los movimientos, incluidas las transferencias', async () => {
      open({
        [`GET ${MOVEMENTS_URL}`]: {
          status: 200,
          body: [
            {
              id: 'm1',
              operationId: 'op1',
              projectId: PROJECT_ID,
              stageId: 'e1',
              type: 'DEPOSIT',
              direction: 'CREDIT',
              houseId: HOUSE_A,
              houseName: 'Betano',
              fromHouseId: null,
              fromHouseName: null,
              toHouseId: null,
              toHouseName: null,
              amount: '50.00',
              reason: 'Recarga',
              occurredAt: '2026-06-02T10:00:00.000Z',
              createdAt: '2026-06-02T10:00:00.000Z',
              createdBy: { id: ANA.id, name: 'Ana Pérez' },
            },
            {
              id: 'm2',
              operationId: 'op2',
              projectId: PROJECT_ID,
              stageId: 'e1',
              type: 'TRANSFER',
              direction: null,
              houseId: null,
              houseName: null,
              fromHouseId: HOUSE_A,
              fromHouseName: 'Betano',
              toHouseId: HOUSE_B,
              toHouseName: 'Betsafe',
              amount: '30.00',
              reason: null,
              occurredAt: '2026-06-02T11:00:00.000Z',
              createdAt: '2026-06-02T11:00:00.000Z',
              createdBy: { id: ANA.id, name: 'Ana Pérez' },
            },
          ],
        },
      });
      renderApp(FINANCE_URL);
      const historyTable = (await screen.findByText('Betano → Betsafe')).closest('table')!;
      expect(within(historyTable).getByText('Depósito (Entrada)')).toBeTruthy();
      expect(within(historyTable).getByText('Transferencia')).toBeTruthy();
    });
  });

  describe('retiros', () => {
    it('solicita un retiro', async () => {
      const { calls } = open({
        [`POST ${WITHDRAWALS_URL}`]: { status: 201, body: withdrawal() },
      });
      renderApp(FINANCE_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Solicitar retiro' }));
      const form = screen.getByRole('form', { name: 'Solicitar retiro' });
      await within(form).findByRole('option', { name: 'Betano' });
      fireEvent.change(within(form).getByLabelText('Casa'), { target: { value: HOUSE_A } });
      fireEvent.change(within(form).getByLabelText('Monto'), { target: { value: '100' } });
      fireEvent.change(within(form).getByLabelText('Motivo'), {
        target: { value: 'Retiro de ganancias' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Solicitar' }));

      expect(
        await screen.findByText('Se solicitó el retiro; el monto ya está reservado.'),
      ).toBeTruthy();
      expect(calls.find((c) => c.path === WITHDRAWALS_URL && c.method === 'POST')!.body).toEqual({
        houseId: HOUSE_A,
        amount: '100.00',
        reason: 'Retiro de ganancias',
      });
    });

    it('aprueba un retiro pendiente con contraseña reciente', async () => {
      let reauthed = false;
      const { calls } = open({
        [`GET ${WITHDRAWALS_URL}`]: { status: 200, body: [withdrawal()] },
        [`POST ${WITHDRAWALS_URL}/${WITHDRAWAL_ID}/approve`]: () =>
          reauthed
            ? { status: 200, body: withdrawal({ status: 'APPROVED' }) }
            : apiError(403, 'REAUTH_REQUIRED'),
        'POST /auth/reauth': () => {
          reauthed = true;
          return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
        },
      });
      renderApp(FINANCE_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));

      const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'mi-clave-secreta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText('Se aprobó el retiro de S/ 100.00.')).toBeTruthy();
      const posts = calls.filter((c) => c.path === `${WITHDRAWALS_URL}/${WITHDRAWAL_ID}/approve`);
      expect(posts.map((c) => c.body)).toEqual([{ version: 1 }, { version: 1 }]);
    });

    it('rechaza un retiro con motivo', async () => {
      const { calls } = open({
        [`GET ${WITHDRAWALS_URL}`]: { status: 200, body: [withdrawal()] },
        [`POST ${WITHDRAWALS_URL}/${WITHDRAWAL_ID}/reject`]: {
          status: 200,
          body: withdrawal({ status: 'REJECTED' }),
        },
      });
      renderApp(FINANCE_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
      fireEvent.change(screen.getByPlaceholderText('Motivo (opcional)'), {
        target: { value: 'Falta comprobante' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));

      expect(await screen.findByText('Se rechazó el retiro.')).toBeTruthy();
      expect(
        calls.find((c) => c.path === `${WITHDRAWALS_URL}/${WITHDRAWAL_ID}/reject`)!.body,
      ).toEqual({
        version: 1,
        reason: 'Falta comprobante',
      });
    });

    it('quien solicitó puede cancelar su propio retiro aunque no apruebe', async () => {
      const { calls } = open({
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
              'withdrawals.request',
            ],
          }),
        },
        [`GET ${WITHDRAWALS_URL}`]: {
          status: 200,
          body: [withdrawal({ requestedBy: { id: ANA.id, name: 'Ana Pérez' } })],
        },
        [`POST ${WITHDRAWALS_URL}/${WITHDRAWAL_ID}/cancel`]: {
          status: 200,
          body: withdrawal({ status: 'CANCELLED' }),
        },
      });
      renderApp(FINANCE_URL);
      expect(await screen.findByRole('button', { name: 'Cancelar' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(await screen.findByText('Se canceló el retiro.')).toBeTruthy();
      expect(calls.some((c) => c.path === `${WITHDRAWALS_URL}/${WITHDRAWAL_ID}/cancel`)).toBe(true);
    });

    it('quien no solicitó ni aprueba no ve acciones sobre el retiro', async () => {
      open({
        [`GET ${URL}`]: {
          status: 200,
          body: projectDetail({
            isOwner: false,
            myRole: 'READER',
            myPermissions: ['project.view', 'stages.view', 'houses.view', 'movements.view'],
          }),
        },
        [`GET ${WITHDRAWALS_URL}`]: {
          status: 200,
          body: [withdrawal({ requestedBy: { id: 'other-user', name: 'Otro' } })],
        },
      });
      renderApp(FINANCE_URL);
      await screen.findByText('S/ 100.00 de Betano');
      expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    });
  });

  it('muestra el error de la API', async () => {
    open({ [`GET ${HOUSES_URL}`]: apiError(500, 'INTERNAL_ERROR') });
    renderApp(FINANCE_URL);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  describe('conciliación (§32, §80, §109.1)', () => {
    it('muestra "Requiere nueva conciliación" y permite confirmar', async () => {
      const { calls } = open({
        [`POST ${HOUSES_URL}/${HOUSE_A}/reconciliations`]: {
          status: 201,
          body: {
            id: 'c1',
            projectId: PROJECT_ID,
            houseId: HOUSE_A,
            houseName: 'Betano',
            occurredAt: '2026-06-01T12:00:00.000Z',
            letferAvailable: '500.00',
            officialAvailable: '500.00',
            committed: '0.00',
            difference: '0.00',
            status: 'MATCHED',
            performedBy: { id: ANA.id, name: 'Ana Pérez' },
            note: null,
            invalidatedAt: null,
            invalidatedReason: null,
            createdAt: '2026-06-01T12:00:00.000Z',
          },
        },
      });
      renderApp(FINANCE_URL);
      expect(await screen.findByText('Requiere nueva conciliación')).toBeTruthy();

      const form = screen.getByRole('form', { name: 'Conciliar' });
      fireEvent.change(within(form).getByLabelText('Saldo disponible oficial'), {
        target: { value: '500' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Conciliar' }));

      expect(await screen.findByText('Coincide: se registró la conciliación.')).toBeTruthy();
      expect(
        calls.find(
          (c) => c.path === `${HOUSES_URL}/${HOUSE_A}/reconciliations` && c.method === 'POST',
        )!.body,
      ).toEqual({ officialAvailable: '500.00' });
    });

    it('sin permiso reconciliations.confirm, no se ofrece el formulario, solo la consulta', async () => {
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
              'reconciliations.view',
            ],
          }),
        },
      });
      renderApp(FINANCE_URL);
      await screen.findByText('Requiere nueva conciliación');
      expect(screen.queryByRole('form', { name: 'Conciliar' })).toBeNull();
    });

    it('sin permiso reconciliations.view, no se muestra la sección', async () => {
      open({
        [`GET ${URL}`]: {
          status: 200,
          body: projectDetail({
            isOwner: false,
            myRole: 'READER',
            myPermissions: ['project.view', 'stages.view', 'houses.view', 'movements.view'],
          }),
        },
      });
      renderApp(FINANCE_URL);
      await screen.findByText('Betano');
      expect(screen.queryByRole('heading', { name: 'Conciliación' })).toBeNull();
    });

    it('el historial muestra el estado de cada checkpoint', async () => {
      open({
        [`GET ${HOUSES_URL}/${HOUSE_A}/reconciliations`]: {
          status: 200,
          body: [
            {
              id: 'c1',
              projectId: PROJECT_ID,
              houseId: HOUSE_A,
              houseName: 'Betano',
              occurredAt: '2026-06-01T12:00:00.000Z',
              letferAvailable: '500.00',
              officialAvailable: '450.00',
              committed: '0.00',
              difference: '-50.00',
              status: 'DISCREPANCY',
              performedBy: { id: ANA.id, name: 'Ana Pérez' },
              note: null,
              invalidatedAt: null,
              invalidatedReason: null,
              createdAt: '2026-06-01T12:00:00.000Z',
            },
          ],
        },
      });
      renderApp(FINANCE_URL);
      expect(await screen.findByText('Discrepancia')).toBeTruthy();
      expect(screen.getByText('S/ -50.00')).toBeTruthy();
    });
  });
});
