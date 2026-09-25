import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
  apiError,
  authState,
  projectSummary,
  renderApp,
  SESSION,
  stubApi,
  type Handler,
} from '../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN = ['projects.create', 'projects.list_all', 'projects.transfer_ownership'];
const BETO = '0195f7c0-0000-7000-8000-0000000000b1';
const CARLA = '0195f7c0-0000-7000-8000-0000000000c1';
const P1 = '0195f7c0-0000-7000-8000-0000000000a1';
const P2 = '0195f7c0-0000-7000-8000-0000000000a2';

const member = (overrides: Record<string, unknown>) => ({
  userId: BETO,
  firstName: 'Beto',
  lastName: 'Vega',
  email: null,
  roleId: 'r1',
  roleKey: 'COLLABORATOR',
  roleName: 'Colaborador',
  isOwner: false,
  status: 'ACTIVE',
  accountStatus: 'ACTIVE',
  joinedAt: '2026-06-01T12:00:00.000Z',
  leftAt: null,
  removedAt: null,
  version: 1,
  ...overrides,
});

const open = (permissions: string[], extra: Record<string, Handler> = {}) =>
  stubApi({
    'GET /auth/me': authState(permissions),
    'GET /projects': { status: 200, body: [] },
    ...extra,
  });

describe('proyectos del sistema (§111.5)', () => {
  const trashed = projectSummary({
    id: P2,
    name: 'Proyecto viejo',
    status: 'TRASHED',
    previousStatus: 'ACTIVE',
    ownerId: CARLA,
    ownerName: 'Carla Ríos',
    deletedAt: '2026-05-01T12:00:00.000Z',
    purgeEligibleAt: '2026-07-30T12:00:00.000Z',
  });

  it('lista proyectos activos y en la papelera, con su propietario', async () => {
    open(ADMIN, {
      'GET /projects?scope=all': { status: 200, body: [projectSummary({ id: P1 })] },
      'GET /projects/trash': { status: 200, body: [trashed] },
    });
    renderApp('/admin/projects');
    const list = await screen.findByRole('list', { name: 'Proyectos' });
    expect(await within(list).findByText('Grupo Norte')).toBeTruthy();
    expect(within(list).getByText('Proyecto viejo')).toBeTruthy();
    expect(within(list).getByText(/Propietario: Carla Ríos/)).toBeTruthy();
    expect(within(list).getByText(/Elegible para purga desde el/)).toBeTruthy();
    // No existe ninguna acción de eliminación definitiva (D8-3).
    expect(screen.queryByRole('button', { name: /eliminar|purgar/i })).toBeNull();
  });

  it('transfiere la propiedad con reautenticación, sin ofrecer a quien ya es propietario', async () => {
    let reauthed = false;
    let transferred = false;
    const { calls } = open(ADMIN, {
      'GET /projects?scope=all': () => ({
        status: 200,
        body: [projectSummary({ id: P1, ownerId: transferred ? BETO : ANA.id })],
      }),
      'GET /projects/trash': { status: 200, body: [] },
      [`GET /projects/${P1}/members?status=ACTIVE`]: {
        status: 200,
        body: [
          member({ userId: ANA.id, firstName: 'Ana', lastName: 'Pérez', isOwner: true }),
          member({}),
        ],
      },
      [`POST /projects/${P1}/transfer-ownership`]: () => {
        if (!reauthed) return apiError(403, 'REAUTH_REQUIRED');
        transferred = true;
        return { status: 200, body: projectSummary({ id: P1, ownerId: BETO }) };
      },
      'POST /auth/reauth': () => {
        reauthed = true;
        return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
      },
    });
    renderApp('/admin/projects');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Transferir la propiedad de Grupo Norte' }),
    );
    const form = await screen.findByRole('form', { name: 'Transferir propiedad de Grupo Norte' });
    const select = within(form).getByLabelText('Nueva persona propietaria');
    await within(form).findByRole('option', { name: /Beto Vega/ });
    expect(within(form).queryByRole('option', { name: /Ana Pérez/ })).toBeNull();
    fireEvent.change(select, { target: { value: BETO } });
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmar transferencia' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('La propiedad de «Grupo Norte» pasó a Beto Vega.')).toBeTruthy();
    const posts = calls.filter((call) => call.path === `/projects/${P1}/transfer-ownership`);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual({ newOwnerId: BETO });
  });

  it('permite transferir la propiedad de un proyecto en la papelera', async () => {
    open(ADMIN, {
      'GET /projects?scope=all': { status: 200, body: [] },
      'GET /projects/trash': { status: 200, body: [trashed] },
      [`GET /projects/${P2}/members?status=ACTIVE`]: {
        status: 200,
        body: [member({ userId: CARLA, isOwner: true }), member({})],
      },
    });
    renderApp('/admin/projects');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Transferir la propiedad de Proyecto viejo' }),
    );
    expect(await screen.findByRole('option', { name: /Beto Vega/ })).toBeTruthy();
  });

  it('avisa si no hay otros miembros y no deja confirmar sin elegir', async () => {
    open(ADMIN, {
      'GET /projects?scope=all': { status: 200, body: [projectSummary({ id: P1 })] },
      'GET /projects/trash': { status: 200, body: [] },
      [`GET /projects/${P1}/members?status=ACTIVE`]: {
        status: 200,
        body: [member({ userId: ANA.id, isOwner: true })],
      },
    });
    renderApp('/admin/projects');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Transferir la propiedad de Grupo Norte' }),
    );
    expect(await screen.findByText(/No hay otros miembros activos/)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Confirmar transferencia' }).disabled,
    ).toBe(true);
  });

  it('muestra el error de la API si la transferencia falla', async () => {
    open(ADMIN, {
      'GET /projects?scope=all': { status: 200, body: [projectSummary({ id: P1 })] },
      'GET /projects/trash': { status: 200, body: [] },
      [`GET /projects/${P1}/members?status=ACTIVE`]: { status: 200, body: [member({})] },
      [`POST /projects/${P1}/transfer-ownership`]: apiError(
        409,
        'INVALID_STATE',
        'La nueva persona propietaria debe ser miembro activo del proyecto.',
      ),
    });
    renderApp('/admin/projects');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Transferir la propiedad de Grupo Norte' }),
    );
    await screen.findByRole('option', { name: /Beto Vega/ });
    fireEvent.change(screen.getByLabelText('Nueva persona propietaria'), {
      target: { value: BETO },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar transferencia' }));
    expect(
      await screen.findByText('La nueva persona propietaria debe ser miembro activo del proyecto.'),
    ).toBeTruthy();
  });

  it('sin transfer_ownership no hay botón; sin list_all avisa y no consulta', async () => {
    open(['projects.create', 'projects.list_all'], {
      'GET /projects?scope=all': { status: 200, body: [projectSummary({ id: P1 })] },
      'GET /projects/trash': { status: 200, body: [] },
    });
    renderApp('/admin/projects');
    await screen.findByText('Grupo Norte');
    expect(screen.queryByRole('button', { name: /Transferir la propiedad/ })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    const { calls } = open(['projects.create']);
    renderApp('/admin/projects');
    expect(await screen.findByText('No tienes permiso para ver todos los proyectos.')).toBeTruthy();
    expect(calls.some((call) => call.path.includes('scope=all'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Proyectos' })).toBeNull();
  });
});

describe('Mi cuenta: sesiones abiertas (§111.5)', () => {
  const other = {
    ...SESSION,
    id: '0195f7c0-0000-7000-8000-0000000000e2',
    current: false,
    persistent: true,
    ip: '203.0.113.7',
    userAgent: 'Firefox en Windows',
    createdAt: '2026-05-20T10:00:00.000Z',
  };
  const mine = { ...SESSION, userAgent: 'Chrome en Windows' };

  it('marca la sesión actual (sin botón) y permite cerrar otra', async () => {
    let revoked = false;
    const { calls } = open(['projects.create'], {
      'GET /users/me/deletion-request': { status: 200, body: { request: null } },
      'GET /auth/sessions': () => ({
        status: 200,
        body: { sessions: revoked ? [mine] : [mine, other] },
      }),
      [`DELETE /auth/sessions/${other.id}`]: () => {
        revoked = true;
        return { status: 204 };
      },
    });
    renderApp('/account');
    const list = await screen.findByRole('list', { name: 'Sesiones abiertas' });
    expect(await within(list).findByText('Esta sesión')).toBeTruthy();
    expect(within(list).getByText('Sesión persistente')).toBeTruthy();
    expect(within(list).getAllByRole('button')).toHaveLength(1); // solo la ajena se puede cerrar
    fireEvent.click(within(list).getByRole('button', { name: /Cerrar la sesión iniciada el/ }));
    expect(await screen.findByText('Se cerró la sesión.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    // La lista se recarga y la sesión cerrada desaparece.
    await waitFor(() => expect(screen.queryByText('Sesión persistente')).toBeNull());
  });

  it('cierra las demás sesiones de una vez', async () => {
    open(['projects.create'], {
      'GET /users/me/deletion-request': { status: 200, body: { request: null } },
      'GET /auth/sessions': { status: 200, body: { sessions: [mine, other] } },
      'POST /auth/sessions/revoke-others': { status: 200, body: { revoked: 1 } },
    });
    renderApp('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar las demás sesiones' }));
    expect(await screen.findByText('Se cerró 1 sesión.')).toBeTruthy();
  });

  it('sin otras sesiones no ofrece cerrar las demás', async () => {
    open(['projects.create'], {
      'GET /users/me/deletion-request': { status: 200, body: { request: null } },
      'GET /auth/sessions': { status: 200, body: { sessions: [mine] } },
    });
    renderApp('/account');
    await screen.findByText('Esta sesión');
    expect(screen.queryByRole('button', { name: 'Cerrar las demás sesiones' })).toBeNull();
  });

  it('muestra el error si no se puede cerrar una sesión', async () => {
    open(['projects.create'], {
      'GET /users/me/deletion-request': { status: 200, body: { request: null } },
      'GET /auth/sessions': { status: 200, body: { sessions: [mine, other] } },
      [`DELETE /auth/sessions/${other.id}`]: apiError(404, 'NOT_FOUND'),
    });
    renderApp('/account');
    fireEvent.click(await screen.findByRole('button', { name: /Cerrar la sesión iniciada el/ }));
    expect(
      await screen.findByText('No se encontró lo que buscas, o no tienes acceso.'),
    ).toBeTruthy();
  });
});

describe('ficha de usuario: cerrar todas sus sesiones (§111.5)', () => {
  const USER = '0195f7c0-0000-7000-8000-0000000000b1';
  const detail = (sessions: number) => ({
    id: USER,
    firstName: 'Beto',
    lastName: 'Vega',
    email: 'beto@example.com',
    status: 'ACTIVE',
    globalRole: 'USER',
    createdAt: '2026-05-01T12:00:00.000Z',
    lastLoginAt: null,
    version: 1,
    ownedProjectCount: 0,
    hasPendingDeletionRequest: false,
    deletedAt: null,
    ownedProjects: [],
    activeSessionCount: sessions,
    deletionRequest: null,
  });

  it('cierra las sesiones con reautenticación y recarga el contador', async () => {
    let reauthed = false;
    let closed = false;
    open(['projects.create', 'system.users.view', 'system.users.manage'], {
      [`GET /admin/users/${USER}`]: () => ({ status: 200, body: detail(closed ? 0 : 3) }),
      [`POST /admin/users/${USER}/revoke-sessions`]: () => {
        if (!reauthed) return apiError(403, 'REAUTH_REQUIRED');
        closed = true;
        return { status: 200, body: { revoked: 3 } };
      },
      'POST /auth/reauth': () => {
        reauthed = true;
        return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
      },
    });
    renderApp(`/admin/users/${USER}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar todas sus sesiones' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Se cerraron 3 sesiones.')).toBeTruthy();
    expect(await screen.findByText('0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerrar todas sus sesiones' })).toBeNull();
  });

  it('sin permiso manage o sin sesiones abiertas no se ofrece', async () => {
    open(['projects.create', 'system.users.view'], {
      [`GET /admin/users/${USER}`]: { status: 200, body: detail(2) },
    });
    renderApp(`/admin/users/${USER}`);
    await screen.findByRole('heading', { name: 'Beto Vega' });
    expect(screen.queryByRole('button', { name: 'Cerrar todas sus sesiones' })).toBeNull();
  });
});
