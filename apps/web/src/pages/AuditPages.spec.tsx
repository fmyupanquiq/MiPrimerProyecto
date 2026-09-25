import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
  authState,
  AUTH_STATE,
  apiError,
  OWNER_PERMISSIONS,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  type Handler,
} from '../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const AUDIT_URL = `${URL}/audit`;

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  occurredAt: '2026-06-01T12:00:00.000Z',
  actor: { id: ANA.id, name: 'Ana Pérez' },
  projectId: PROJECT_ID,
  action: 'bet.created',
  entityType: 'bet',
  entityId: 'b1',
  oldValues: null,
  newValues: { stakeAmount: '10.00' },
  metadata: null,
  ip: '127.0.0.1',
  userAgent: 'test',
  sessionId: null,
  requestId: 'req-1',
  ...overrides,
});

function openProject(permissions: string[], extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail({ myPermissions: permissions }) },
    ...extra,
  });
}

describe('auditoría del proyecto (§111.1)', () => {
  it('muestra la pestaña y los registros a quien tiene audit.view', async () => {
    openProject([...OWNER_PERMISSIONS, 'audit.view'], {
      [`GET ${URL}/audit-logs`]: {
        status: 200,
        body: { items: [entry()], nextCursor: null },
      },
    });
    renderApp(AUDIT_URL);
    expect(await screen.findByRole('heading', { name: 'Auditoría del proyecto' })).toBeTruthy();
    expect(await screen.findByText('bet.created')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Auditoría' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Registros de auditoría' });
    expect(within(list).getByText('Ana Pérez')).toBeTruthy();
  });

  it('sin audit.view no hay pestaña y la pantalla avisa, sin pedir nada a la API', async () => {
    const { calls } = openProject(OWNER_PERMISSIONS);
    renderApp(AUDIT_URL);
    expect(
      await screen.findByText('No tienes permiso para ver la auditoría de este proyecto.'),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Auditoría' })).toBeNull();
    expect(calls.some((call) => call.path.includes('audit-logs'))).toBe(false);
  });

  it('"Cargar más" añade la página siguiente usando el cursor', async () => {
    const { calls } = openProject([...OWNER_PERMISSIONS, 'audit.view'], {
      [`GET ${URL}/audit-logs`]: {
        status: 200,
        body: { items: [entry({ id: 'e1', action: 'bet.created' })], nextCursor: 'CURSOR-1' },
      },
      [`GET ${URL}/audit-logs?cursor=CURSOR-1`]: {
        status: 200,
        body: { items: [entry({ id: 'e2', action: 'bet.settled' })], nextCursor: null },
      },
    });
    renderApp(AUDIT_URL);
    await screen.findByText('bet.created');
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('bet.settled')).toBeTruthy();
    expect(screen.getByText('bet.created')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
    expect(calls.map((call) => call.path)).toContain(`${URL}/audit-logs?cursor=CURSOR-1`);
  });

  it('aplica los filtros en la consulta y permite limpiarlos', async () => {
    const { calls } = openProject([...OWNER_PERMISSIONS, 'audit.view'], {
      [`GET ${URL}/audit-logs`]: { status: 200, body: { items: [entry()], nextCursor: null } },
      [`GET ${URL}/audit-logs?action=member.`]: {
        status: 200,
        body: { items: [], nextCursor: null },
      },
    });
    renderApp(AUDIT_URL);
    await screen.findByText('bet.created');
    fireEvent.change(screen.getByLabelText('Acción (p. ej. bet.)'), {
      target: { value: 'member.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(await screen.findByText('No hay registros de auditoría con esos filtros.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(await screen.findByText('bet.created')).toBeTruthy();
    expect(calls.filter((call) => call.path === `${URL}/audit-logs`).length).toBe(2);
  });

  it('muestra los valores anterior y nuevo al abrir un registro', async () => {
    openProject([...OWNER_PERMISSIONS, 'audit.view'], {
      [`GET ${URL}/audit-logs`]: {
        status: 200,
        body: {
          items: [
            entry({ oldValues: { stakeAmount: '5.00' }, newValues: { stakeAmount: '10.00' } }),
          ],
          nextCursor: null,
        },
      },
    });
    renderApp(AUDIT_URL);
    await screen.findByText('bet.created');
    expect(screen.getByText('Valor anterior')).toBeTruthy();
    expect(screen.getByText(/"stakeAmount": "5.00"/)).toBeTruthy();
    expect(screen.getByText(/"stakeAmount": "10.00"/)).toBeTruthy();
  });

  it('muestra un aviso si la consulta falla', async () => {
    openProject([...OWNER_PERMISSIONS, 'audit.view'], {
      [`GET ${URL}/audit-logs`]: apiError(403, 'FORBIDDEN'),
    });
    renderApp(AUDIT_URL);
    expect(await screen.findByText('No tienes permiso para realizar esta acción.')).toBeTruthy();
  });
});

describe('auditoría del sistema (§111.1)', () => {
  const ADMIN = ['projects.create', 'system.audit.view'];

  it('lista registros de todo el sistema y filtra por "sin proyecto"', async () => {
    const { calls } = stubApi({
      'GET /auth/me': authState(ADMIN),
      'GET /projects': { status: 200, body: [] },
      'GET /admin/audit-logs': {
        status: 200,
        body: { items: [entry({ projectId: PROJECT_ID })], nextCursor: null },
      },
      'GET /admin/audit-logs?system=true': {
        status: 200,
        body: {
          items: [entry({ id: 's1', projectId: null, action: 'auth.login.succeeded' })],
          nextCursor: null,
        },
      },
    });
    renderApp('/admin/audit');
    expect(await screen.findByRole('heading', { name: 'Auditoría del sistema' })).toBeTruthy();
    await screen.findByText('bet.created');

    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: 'system' } });
    expect(await screen.findByText('auth.login.succeeded')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('bet.created')).toBeNull());
    expect(calls.map((call) => call.path)).toContain('/admin/audit-logs?system=true');
  });

  it('sin system.audit.view avisa y no consulta la API', async () => {
    const { calls } = stubApi({
      'GET /auth/me': authState(['projects.create']),
      'GET /projects': { status: 200, body: [] },
    });
    renderApp('/admin/audit');
    expect(
      await screen.findByText('No tienes permiso para ver la auditoría del sistema.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.path.includes('audit-logs'))).toBe(false);
  });

  it('la pestaña "Auditoría" de Administración solo aparece con el permiso', async () => {
    stubApi({
      'GET /auth/me': authState(ADMIN),
      'GET /projects': { status: 200, body: [] },
      'GET /admin/integrity-checks': { status: 200, body: [] },
      'GET /admin/backups': { status: 200, body: [] },
    });
    renderApp('/admin');
    expect(await screen.findByRole('link', { name: 'Auditoría' })).toBeTruthy();
  });
});
