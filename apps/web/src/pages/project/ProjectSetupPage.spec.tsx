import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
const unconfigured = { setupComplete: false, activeStage: null };

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail(unconfigured) },
    ...extra,
  });
}

describe('configuración inicial del proyecto (D1)', () => {
  it('desde el resumen se ofrece completar la configuración si falta', async () => {
    open();
    renderApp(URL);
    expect(await screen.findByText(/todavía no tiene etapa, casas ni banca/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Completar configuración' }));
    expect(await screen.findByRole('form', { name: 'Configuración inicial' })).toBeTruthy();
  });

  it('sin permiso, no se muestra el aviso de configuración pendiente', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          ...unconfigured,
          isOwner: false,
          myRole: 'READER',
          myPermissions: ['project.view'],
        }),
      },
    });
    renderApp(URL);
    await screen.findByRole('heading', { name: 'Grupo Norte' });
    expect(screen.queryByRole('link', { name: 'Completar configuración' })).toBeNull();
  });

  it('envía la unidad y las casas, y entra al proyecto ya configurado', async () => {
    const { calls } = open({
      [`POST ${URL}/setup`]: {
        status: 201,
        body: projectDetail({ setupComplete: true }),
      },
    });
    renderApp(`${URL}/setup`);
    const form = await screen.findByRole('form', { name: 'Configuración inicial' });

    fireEvent.change(screen.getByLabelText('Unidad de stake de la Etapa 1'), {
      target: { value: '10.00' },
    });
    fireEvent.change(screen.getByLabelText('Nombre de la casa 1'), {
      target: { value: 'Betano' },
    });
    fireEvent.change(screen.getByLabelText('Monto inicial de la casa 1'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir casa' }));
    fireEvent.change(screen.getByLabelText('Nombre de la casa 2'), {
      target: { value: 'Betsafe' },
    });
    fireEvent.change(screen.getByLabelText('Monto inicial de la casa 2'), {
      target: { value: '0' },
    });
    expect(screen.getByText('S/ 500.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Completar configuración' }));

    expect(await screen.findByRole('heading', { name: 'Grupo Norte' })).toBeTruthy();
    expect(calls.find((c) => c.path === `${URL}/setup`)!.body).toEqual({
      unitStake: '10.00',
      houses: [
        { name: 'Betano', initialAmount: '500.00' },
        { name: 'Betsafe', initialAmount: '0.00' },
      ],
    });
    void form;
  });

  it('permite quitar una fila de casa (mínimo una)', async () => {
    open();
    renderApp(`${URL}/setup`);
    await screen.findByRole('form', { name: 'Configuración inicial' });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir casa' }));
    expect(screen.getByLabelText('Nombre de la casa 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar la casa 2' }));
    expect(screen.queryByLabelText('Nombre de la casa 2')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Quitar la casa 1' }).disabled,
    ).toBe(true);
  });

  it('valida en el navegador antes de llamar a la API', async () => {
    const { calls } = open();
    renderApp(`${URL}/setup`);
    await screen.findByRole('form', { name: 'Configuración inicial' });

    fireEvent.change(screen.getByLabelText('Unidad de stake de la Etapa 1'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Completar configuración' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('muestra el error de la API si ya se completó', async () => {
    open({
      [`POST ${URL}/setup`]: apiError(
        409,
        'INVALID_STATE',
        'Este proyecto ya completó su configuración inicial.',
      ),
    });
    renderApp(`${URL}/setup`);
    await screen.findByRole('form', { name: 'Configuración inicial' });
    fireEvent.change(screen.getByLabelText('Unidad de stake de la Etapa 1'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Nombre de la casa 1'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Completar configuración' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Este proyecto ya completó su configuración inicial.',
      ),
    );
  });
});
