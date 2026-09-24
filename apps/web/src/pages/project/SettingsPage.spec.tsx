import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
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
const SETTINGS_URL = `${URL}/settings`;
const INTEGRITY_URL = `${URL}/integrity-checks`;

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail() },
    [`GET ${INTEGRITY_URL}`]: { status: 200, body: [] },
    ...extra,
  });
}

describe('verificación de integridad del proyecto (§38, §109.2)', () => {
  it('sin ejecuciones previas, avisa que no se ha verificado nada', async () => {
    open();
    renderApp(SETTINGS_URL);
    expect(await screen.findByRole('heading', { name: 'Verificación de integridad' })).toBeTruthy();
    expect(
      await screen.findByText('Todavía no se ha ejecutado ninguna verificación.'),
    ).toBeTruthy();
  });

  it('ejecuta el chequeo y muestra el resultado OK', async () => {
    const run = {
      id: 'r1',
      projectId: PROJECT_ID,
      runBy: { id: ANA.id, name: 'Ana Pérez' },
      startedAt: '2026-06-01T12:00:00.000Z',
      finishedAt: '2026-06-01T12:00:01.000Z',
      status: 'OK',
      findings: [],
    };
    let ran = false;
    const { calls } = open({
      [`GET ${INTEGRITY_URL}`]: () => ({ status: 200, body: ran ? [run] : [] }),
      [`POST ${INTEGRITY_URL}`]: () => {
        ran = true;
        return { status: 201, body: run };
      },
    });
    renderApp(SETTINGS_URL);
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar ahora' }));
    expect(await screen.findByText('Sin hallazgos')).toBeTruthy();
    expect(calls.some((c) => c.path === INTEGRITY_URL && c.method === 'POST')).toBe(true);
  });

  it('muestra los hallazgos cuando los hay', async () => {
    open({
      [`GET ${INTEGRITY_URL}`]: {
        status: 200,
        body: [
          {
            id: 'r1',
            projectId: PROJECT_ID,
            runBy: { id: ANA.id, name: 'Ana Pérez' },
            startedAt: '2026-06-01T12:00:00.000Z',
            finishedAt: '2026-06-01T12:00:01.000Z',
            status: 'ISSUES_FOUND',
            findings: [
              {
                check: 'NEGATIVE_AVAILABLE',
                message: 'Una casa quedó con disponible negativo.',
                affected: ['house:h1'],
              },
            ],
          },
        ],
      },
    });
    renderApp(SETTINGS_URL);
    expect(await screen.findByText('Hallazgos encontrados')).toBeTruthy();
    expect(screen.getByText('Disponible negativo')).toBeTruthy();
    expect(screen.getByText(/Una casa quedó con disponible negativo/)).toBeTruthy();
  });

  it('sin permiso integrity.run, no se ofrece el botón, solo la consulta', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({
          isOwner: false,
          myRole: 'READER',
          myPermissions: ['project.view', 'integrity.view'],
        }),
      },
    });
    renderApp(SETTINGS_URL);
    await screen.findByRole('heading', { name: 'Verificación de integridad' });
    expect(screen.queryByRole('button', { name: 'Verificar ahora' })).toBeNull();
  });

  it('sin permiso integrity.view, no se muestra la sección', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({ isOwner: false, myRole: 'READER', myPermissions: ['project.view'] }),
      },
    });
    renderApp(SETTINGS_URL);
    await screen.findByRole('heading', { name: 'Estado del proyecto' });
    expect(screen.queryByRole('heading', { name: 'Verificación de integridad' })).toBeNull();
  });
});
