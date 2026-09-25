import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANA, apiError, authState, renderApp, stubApi, type Handler } from '../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN = [
  'projects.create',
  'system.users.view',
  'system.users.manage',
  'system.account_deletions.decide',
];
const BETO = '0195f7c0-0000-7000-8000-0000000000b1';
const REQ = '0195f7c0-0000-7000-8000-0000000000d1';

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: BETO,
  firstName: 'Beto',
  lastName: 'Vega',
  email: 'beto@example.com',
  status: 'ACTIVE',
  globalRole: 'USER',
  createdAt: '2026-05-01T12:00:00.000Z',
  lastLoginAt: null,
  version: 3,
  ownedProjectCount: 0,
  hasPendingDeletionRequest: false,
  ...overrides,
});
const userDetail = (overrides: Record<string, unknown> = {}) => ({
  ...userRow(),
  deletedAt: null,
  ownedProjects: [],
  activeSessionCount: 2,
  deletionRequest: null,
  ...overrides,
});
const deletionRequest = (overrides: Record<string, unknown> = {}) => ({
  id: REQ,
  userId: BETO,
  userName: 'Beto Vega',
  userEmail: 'beto@example.com',
  status: 'PENDING',
  reason: 'Ya no lo uso',
  requestedAt: '2026-06-01T12:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  version: 1,
  ...overrides,
});

const open = (permissions: string[], extra: Record<string, Handler> = {}) =>
  stubApi({
    'GET /auth/me': authState(permissions),
    'GET /projects': { status: 200, body: [] },
    ...extra,
  });

describe('usuarios (Administrador Global, §111.3)', () => {
  it('lista usuarios con su estado y avisos de eliminación y propiedad', async () => {
    open(ADMIN, {
      'GET /admin/users?limit=25&offset=0': {
        status: 200,
        body: {
          total: 2,
          items: [
            userRow({ hasPendingDeletionRequest: true, ownedProjectCount: 2 }),
            userRow({
              id: ANA.id,
              firstName: 'Ana',
              lastName: 'Pérez',
              email: 'ana@example.com',
              globalRole: 'GLOBAL_ADMIN',
            }),
          ],
        },
      },
    });
    renderApp('/admin/users');
    const list = await screen.findByRole('list', { name: 'Usuarios' });
    expect(await within(list).findByText('Pidió eliminar su cuenta')).toBeTruthy();
    expect(within(list).getByText('Propietaria de 2 proyectos')).toBeTruthy();
    expect(within(list).getByText('Administrador Global')).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'Beto Vega' })).toBeTruthy();
    expect(screen.getByText('Mostrando 1–2 de 2')).toBeTruthy();
  });

  it('busca y filtra, y vuelve a la primera página', async () => {
    const { calls } = open(ADMIN, {
      'GET /admin/users?limit=25&offset=0': {
        status: 200,
        body: { total: 60, items: [userRow()] },
      },
      'GET /admin/users?limit=25&offset=25': {
        status: 200,
        body: { total: 60, items: [userRow()] },
      },
      'GET /admin/users?search=beto&status=DISABLED&limit=25&offset=0': {
        status: 200,
        body: { total: 0, items: [] },
      },
    });
    renderApp('/admin/users');
    await screen.findByText('Mostrando 1–25 de 60');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Mostrando 26–50 de 60');

    fireEvent.change(screen.getByLabelText('Buscar por nombre o correo'), {
      target: { value: 'beto' },
    });
    fireEvent.change(screen.getByLabelText('Estado de la cuenta'), {
      target: { value: 'DISABLED' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('No hay usuarios con esos filtros.')).toBeTruthy();
    expect(calls.map((call) => call.path)).toContain(
      '/admin/users?search=beto&status=DISABLED&limit=25&offset=0',
    );
  });

  it('sin permiso avisa y no consulta la API; el enlace de la pestaña no aparece', async () => {
    const { calls } = open(['projects.create'], {});
    renderApp('/admin/users');
    expect(await screen.findByText('No tienes permiso para ver los usuarios.')).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith('/admin/users'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Usuarios' })).toBeNull();
  });
});

describe('ficha de usuario', () => {
  const DETAIL = `/admin/users/${BETO}`;

  it('muestra propiedad, sesiones y la solicitud de eliminación', async () => {
    open(ADMIN, {
      [`GET ${DETAIL}`]: {
        status: 200,
        body: userDetail({
          ownedProjects: [{ id: 'p1', name: 'Grupo Norte', status: 'ACTIVE' }],
          deletionRequest: deletionRequest(),
        }),
      },
    });
    renderApp(`/admin/users/${BETO}`);
    expect(await screen.findByRole('heading', { name: 'Beto Vega' })).toBeTruthy();
    expect(screen.getByText('Grupo Norte')).toBeTruthy();
    expect(screen.getByText(/transfiere primero la propiedad/)).toBeTruthy();
    expect(screen.getByText(/Motivo: Ya no lo uso/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a las solicitudes de eliminación' })).toBeTruthy();
  });

  it('deshabilita la cuenta con reautenticación y muestra el nuevo estado', async () => {
    let reauthed = false;
    const { calls } = open(ADMIN, {
      [`GET ${DETAIL}`]: { status: 200, body: userDetail() },
      [`POST ${DETAIL}/disable`]: () =>
        reauthed
          ? { status: 200, body: userDetail({ status: 'DISABLED', version: 4 }) }
          : apiError(403, 'REAUTH_REQUIRED'),
      'POST /auth/reauth': () => {
        reauthed = true;
        return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
      },
    });
    renderApp(`/admin/users/${BETO}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Deshabilitar cuenta' }));
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: 'Abuso' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar deshabilitación' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('La cuenta se deshabilitó.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Reactivar cuenta' })).toBeTruthy();
    const posts = calls.filter((call) => call.path === `${DETAIL}/disable`);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual({ version: 3, reason: 'Abuso' });
  });

  it('muestra el mensaje de la API si la protección lo impide', async () => {
    open(ADMIN, {
      [`GET ${DETAIL}`]: { status: 200, body: userDetail() },
      [`POST ${DETAIL}/disable`]: apiError(
        409,
        'LAST_GLOBAL_ADMIN',
        'No se puede deshabilitar ni eliminar al último Administrador Global activo.',
      ),
    });
    renderApp(`/admin/users/${BETO}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Deshabilitar cuenta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar deshabilitación' }));
    expect(
      await screen.findByText(
        'No se puede deshabilitar ni eliminar al último Administrador Global activo.',
      ),
    ).toBeTruthy();
    // La cuenta sigue activa en pantalla.
    expect(screen.getByText('Activa')).toBeTruthy();
  });

  it('reactiva una cuenta deshabilitada', async () => {
    open(ADMIN, {
      [`GET ${DETAIL}`]: { status: 200, body: userDetail({ status: 'DISABLED' }) },
      [`POST ${DETAIL}/enable`]: { status: 200, body: userDetail({ version: 4 }) },
    });
    renderApp(`/admin/users/${BETO}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar cuenta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reactivación' }));
    expect(await screen.findByText('La cuenta se reactivó.')).toBeTruthy();
  });

  it('una cuenta eliminada no ofrece cambios de estado; sin permiso manage tampoco', async () => {
    open(ADMIN, {
      [`GET ${DETAIL}`]: {
        status: 200,
        body: userDetail({ status: 'DELETED', deletedAt: '2026-06-02T12:00:00.000Z' }),
      },
    });
    renderApp(`/admin/users/${BETO}`);
    await screen.findByRole('heading', { name: 'Beto Vega' });
    expect(screen.queryByRole('button', { name: /Deshabilitar|Reactivar/ })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    open(['projects.create', 'system.users.view'], {
      [`GET ${DETAIL}`]: { status: 200, body: userDetail() },
    });
    renderApp(`/admin/users/${BETO}`);
    await screen.findByRole('heading', { name: 'Beto Vega' });
    expect(screen.queryByRole('button', { name: 'Deshabilitar cuenta' })).toBeNull();
  });

  it('un usuario inexistente muestra "No se encontró el usuario."', async () => {
    open(ADMIN, { [`GET ${DETAIL}`]: apiError(404, 'NOT_FOUND') });
    renderApp(`/admin/users/${BETO}`);
    expect(await screen.findByText('No se encontró el usuario.')).toBeTruthy();
  });
});

describe('solicitudes de eliminación de cuenta (§8)', () => {
  it('aprueba con reautenticación y recarga la lista', async () => {
    let reauthed = false;
    let approved = false;
    const { calls } = open(ADMIN, {
      'GET /admin/account-deletions?status=PENDING': () => ({
        status: 200,
        body: approved ? [] : [deletionRequest()],
      }),
      [`POST /admin/account-deletions/${REQ}/approve`]: () => {
        if (!reauthed) return apiError(403, 'REAUTH_REQUIRED');
        approved = true;
        return { status: 200, body: deletionRequest({ status: 'APPROVED', version: 2 }) };
      },
      'POST /auth/reauth': () => {
        reauthed = true;
        return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
      },
    });
    renderApp('/admin/deletions');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aprobar la eliminación de Beto Vega' }),
    );
    fireEvent.change(screen.getByLabelText('Motivo de la decisión (opcional)'), {
      target: { value: 'Confirmado por correo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación de Beto Vega' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('La cuenta de Beto Vega se eliminó.')).toBeTruthy();
    expect(await screen.findByText('No hay solicitudes con ese estado.')).toBeTruthy();
    const posts = calls.filter((call) => call.path.endsWith('/approve'));
    expect(posts[1]!.body).toEqual({ version: 1, reason: 'Confirmado por correo' });
  });

  it('rechaza sin pedir la contraseña', async () => {
    const { calls } = open(ADMIN, {
      'GET /admin/account-deletions?status=PENDING': { status: 200, body: [deletionRequest()] },
      [`POST /admin/account-deletions/${REQ}/reject`]: {
        status: 200,
        body: deletionRequest({ status: 'REJECTED', version: 2 }),
      },
    });
    renderApp('/admin/deletions');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rechazar la solicitud de Beto Vega' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo de Beto Vega' }));
    expect(await screen.findByText('Se rechazó la solicitud de Beto Vega.')).toBeTruthy();
    expect(calls.some((call) => call.path === '/auth/reauth')).toBe(false);
  });

  it('muestra el aviso de la API cuando la persona es propietaria de proyectos', async () => {
    open(ADMIN, {
      'GET /admin/account-deletions?status=PENDING': { status: 200, body: [deletionRequest()] },
      [`POST /admin/account-deletions/${REQ}/approve`]: apiError(
        409,
        'OWNS_PROJECTS',
        'Esta cuenta es propietaria de proyectos. Transfiere su propiedad antes de deshabilitarla o eliminarla.',
      ),
    });
    renderApp('/admin/deletions');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aprobar la eliminación de Beto Vega' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación de Beto Vega' }));
    expect(await screen.findByText(/Transfiere su propiedad antes/)).toBeTruthy();
    // La solicitud sigue pendiente y con sus botones.
    const list = screen.getByRole('list', { name: 'Solicitudes de eliminación' });
    expect(within(list).getByText('Pendiente')).toBeTruthy();
  });

  it('las solicitudes ya decididas no ofrecen acciones y el filtro cambia la consulta', async () => {
    const { calls } = open(ADMIN, {
      'GET /admin/account-deletions?status=PENDING': { status: 200, body: [] },
      'GET /admin/account-deletions': {
        status: 200,
        body: [
          deletionRequest({
            status: 'REJECTED',
            decidedAt: '2026-06-02T12:00:00.000Z',
            decidedBy: { id: ANA.id, name: 'Ana Pérez' },
            decisionReason: 'Hablemos',
          }),
        ],
      },
    });
    renderApp('/admin/deletions');
    await screen.findByText('No hay solicitudes con ese estado.');
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '' } });
    expect(await screen.findByText(/por Ana Pérez · Hablemos/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Aprobar/ })).toBeNull();
    expect(calls.map((call) => call.path)).toContain('/admin/account-deletions');
  });

  it('sin permiso decide avisa y no consulta; la pestaña no aparece', async () => {
    const { calls } = open(['projects.create', 'system.users.view'], {});
    renderApp('/admin/deletions');
    expect(
      await screen.findByText('No tienes permiso para decidir sobre estas solicitudes.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith('/admin/account-deletions'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Eliminación de cuentas' })).toBeNull();
  });
});

describe('Mi cuenta: eliminar mi cuenta', () => {
  const MINE = '/users/me/deletion-request';

  it('sin solicitud previa, ofrece solicitar y la deja pendiente', async () => {
    const { calls } = open(['projects.create'], {
      [`GET ${MINE}`]: { status: 200, body: { request: null } },
      [`POST ${MINE}`]: { status: 201, body: deletionRequest({ userId: ANA.id }) },
    });
    renderApp('/account');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Solicitar eliminación de mi cuenta' }),
    );
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), {
      target: { value: 'Ya no lo uso' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud de eliminación' }));
    expect(await screen.findByText(/Pediste eliminar tu cuenta/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar solicitud' })).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST' && call.path === MINE)!.body).toEqual({
      reason: 'Ya no lo uso',
    });
  });

  it('con una solicitud pendiente permite cancelarla', async () => {
    open(['projects.create'], {
      [`GET ${MINE}`]: { status: 200, body: { request: deletionRequest({ userId: ANA.id }) } },
      [`DELETE ${MINE}`]: {
        status: 200,
        body: deletionRequest({ userId: ANA.id, status: 'CANCELLED', decidedAt: 'x', version: 2 }),
      },
    });
    renderApp('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Solicitar eliminación de mi cuenta' }),
      ).toBeTruthy(),
    );
  });

  it('muestra el error si ya hay una solicitud pendiente (409)', async () => {
    open(['projects.create'], {
      [`GET ${MINE}`]: { status: 200, body: { request: null } },
      [`POST ${MINE}`]: apiError(409, 'CONFLICT'),
    });
    renderApp('/account');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Solicitar eliminación de mi cuenta' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud de eliminación' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('el nombre de la persona en la cabecera lleva a "Mi cuenta"', async () => {
    open(['projects.create'], { [`GET ${MINE}`]: { status: 200, body: { request: null } } });
    renderApp('/');
    fireEvent.click(await screen.findByTitle('Mi cuenta'));
    expect(await screen.findByRole('heading', { name: 'Mi cuenta' })).toBeTruthy();
  });
});
