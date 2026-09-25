import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STATE,
  apiError,
  OWNER_PERMISSIONS,
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
const TRASH_URL = `${URL}/trash`;

const BET = {
  kind: 'BET',
  id: 'b1',
  label: 'Real vs. Barça — Real gana',
  detail: 'Casa Uno · stake 1.0000',
  deletedAt: '2026-04-01T00:00:00.000Z',
  deletedBy: { id: 'u1', name: 'Olga Pérez' },
  deletionReason: 'Duplicada',
  purgeEligibleAt: '2026-06-30T00:00:00.000Z',
  purgeEligible: true,
};
const STAGE = {
  kind: 'STAGE',
  id: 's1',
  label: 'Etapa vieja',
  detail: 'unidad 10.00',
  deletedAt: '2026-05-25T00:00:00.000Z',
  deletedBy: null,
  deletionReason: null,
  purgeEligibleAt: '2026-08-23T00:00:00.000Z',
  purgeEligible: false,
};

function open(permissions: string[], extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail({ myPermissions: permissions }) },
    ...extra,
  });
}

describe('papelera del proyecto (§36, §111.2)', () => {
  it('lista apuestas y etapas con quién, cuándo, motivo y elegibilidad', async () => {
    open(OWNER_PERMISSIONS, {
      [`GET ${TRASH_URL}`]: { status: 200, body: [STAGE, BET] },
    });
    renderApp(TRASH_URL);
    expect(await screen.findByRole('heading', { name: 'Papelera del proyecto' })).toBeTruthy();
    expect(await screen.findByText('Real vs. Barça — Real gana')).toBeTruthy();
    expect(screen.getByText('Etapa vieja')).toBeTruthy();
    expect(screen.getByText(/por Olga Pérez/)).toBeTruthy();
    expect(screen.getByText(/Motivo: Duplicada/)).toBeTruthy();
    // Solo lo que ya cumplió la retención se marca elegible para purga; nada se purga.
    expect(screen.getAllByText('Elegible para purga')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Eliminados' })).toBeTruthy();
  });

  it('restaura una apuesta y recarga la lista', async () => {
    let restored = false;
    const { calls } = open(OWNER_PERMISSIONS, {
      [`GET ${TRASH_URL}`]: () => ({ status: 200, body: restored ? [] : [BET] }),
      [`POST ${URL}/bets/b1/restore`]: () => {
        restored = true;
        return { status: 200, body: { id: 'b1' } };
      },
    });
    renderApp(TRASH_URL);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restaurar Real vs. Barça — Real gana' }),
    );
    expect(
      await screen.findByText('«Real vs. Barça — Real gana» se restauró correctamente.'),
    ).toBeTruthy();
    expect(await screen.findByText('La papelera está vacía.')).toBeTruthy();
    expect(
      calls.some((call) => call.method === 'POST' && call.path === `${URL}/bets/b1/restore`),
    ).toBe(true);
  });

  it('restaura una etapa por su propio endpoint', async () => {
    const { calls } = open(OWNER_PERMISSIONS, {
      [`GET ${TRASH_URL}`]: { status: 200, body: [STAGE] },
      [`POST ${URL}/stages/s1/restore`]: { status: 200, body: { id: 's1' } },
    });
    renderApp(TRASH_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Etapa vieja' }));
    await screen.findByText('«Etapa vieja» se restauró correctamente.');
    expect(calls.some((call) => call.path === `${URL}/stages/s1/restore`)).toBe(true);
  });

  it('muestra el error de la API si no se puede restaurar', async () => {
    open(OWNER_PERMISSIONS, {
      [`GET ${TRASH_URL}`]: { status: 200, body: [STAGE] },
      [`POST ${URL}/stages/s1/restore`]: apiError(409, 'INVALID_STATE', 'La etapa ya está activa.'),
    });
    renderApp(TRASH_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Etapa vieja' }));
    expect(await screen.findByText('La etapa ya está activa.')).toBeTruthy();
  });

  it('sin permisos de restauración no hay pestaña, ni consulta, ni botones', async () => {
    const permissions = OWNER_PERMISSIONS.filter(
      (permission) => permission !== 'bets.restore' && permission !== 'stages.restore',
    );
    const { calls } = open(permissions);
    renderApp(TRASH_URL);
    expect(
      await screen.findByText('No tienes permiso para ver la papelera de este proyecto.'),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Eliminados' })).toBeNull();
    expect(calls.some((call) => call.path === TRASH_URL)).toBe(false);
  });

  it('con solo stages.restore no se ofrece restaurar apuestas', async () => {
    const permissions = OWNER_PERMISSIONS.filter((permission) => permission !== 'bets.restore');
    open(permissions, { [`GET ${TRASH_URL}`]: { status: 200, body: [STAGE, BET] } });
    renderApp(TRASH_URL);
    await screen.findByRole('button', { name: 'Restaurar Etapa vieja' });
    expect(
      screen.queryByRole('button', { name: 'Restaurar Real vs. Barça — Real gana' }),
    ).toBeNull();
  });
});
