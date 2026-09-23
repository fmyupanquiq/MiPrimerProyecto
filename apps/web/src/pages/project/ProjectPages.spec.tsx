import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  AUTH_STATE,
  OWNER_PERMISSIONS,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  type Handler,
  type StubResponse,
} from '../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const ADMIN_PERMISSIONS = OWNER_PERMISSIONS.filter(
  (p) => !['project.reopen', 'project.trash', 'project.restore'].includes(p),
);
const READER_PERMISSIONS = ['members.view', 'project.view', 'projects.create'];

const asAdmin = { isOwner: false, myRole: 'PROJECT_ADMIN', myPermissions: ADMIN_PERMISSIONS };
const asReader = { isOwner: false, myRole: 'READER', myPermissions: READER_PERMISSIONS };
const asGlobalAdmin = { isOwner: false, myRole: null };

function open(path: string, project: StubResponse, extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    'GET /projects/trash': { status: 200, body: [] },
    [`GET ${URL}`]: project,
    ...extra,
  });
}
const detail = (overrides: Record<string, unknown> = {}): StubResponse => ({
  status: 200,
  body: projectDetail(overrides),
});

describe('diseño del proyecto', () => {
  it('muestra el nombre, el estado, "sin etapa" y la navegación', async () => {
    open(URL, detail());
    renderApp(URL);

    expect(await screen.findByRole('heading', { name: 'Grupo Norte' })).toBeTruthy();
    expect(screen.getByText('Etapa: Etapa 1')).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Proyecto' });
    expect(within(nav).getByRole('link', { name: 'Resumen' }).getAttribute('href')).toBe(URL);
    expect(within(nav).getByRole('link', { name: 'Miembros' }).getAttribute('href')).toBe(
      `${URL}/members`,
    );
    expect(within(nav).getByRole('link', { name: 'Configuración' }).getAttribute('href')).toBe(
      `${URL}/settings`,
    );
  });

  it('el resumen muestra propietario, rol, moneda, zona horaria y formato de fecha', async () => {
    open(URL, detail({ description: 'Grupo de apuestas', timezone: 'America/Bogota' }));
    renderApp(URL);

    expect(await screen.findByText('Grupo de apuestas')).toBeTruthy();
    expect(screen.getByText('Propietario · Administrador de proyecto')).toBeTruthy();
    expect(screen.getByText('PEN')).toBeTruthy();
    expect(screen.getByText('America/Bogota')).toBeTruthy();
    expect(screen.getByText(/DD\/MM\/AAAA/)).toBeTruthy();
  });

  it('el resumen ya no anuncia etapas, banca y casas como pendientes de fases futuras', async () => {
    open(URL, detail());
    renderApp(URL);

    await screen.findByRole('heading', { name: 'Grupo Norte' });
    expect(screen.getByText('Las apuestas se configuran en la fase siguiente.')).toBeTruthy();
    expect(screen.queryByText(/etapas, la banca, las casas/)).toBeNull();
  });

  it('un proyecto cerrado avisa que no admite invitaciones', async () => {
    open(URL, detail({ status: 'CLOSED' }));
    renderApp(URL);
    expect((await screen.findByRole('status')).textContent).toMatch(/proyecto está cerrado/);
    expect(screen.getByText('Cerrado')).toBeTruthy();
  });

  it('un proyecto ajeno o inexistente responde igual: no encontrado, con salida a Mis proyectos', async () => {
    open(URL, apiError(404, 'NOT_FOUND'));
    renderApp(URL);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se encontró el proyecto, o no tienes acceso a él.',
    );
    expect(screen.getByRole('link', { name: '← Volver a mis proyectos' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Proyecto' })).toBeNull();
  });

  it('un fallo del servidor muestra el error genérico', async () => {
    open(URL, apiError(500, 'INTERNAL_ERROR'));
    renderApp(URL);
    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo completar/);
  });

  it('desde Mis proyectos se entra al proyecto y se navega entre sus pestañas', async () => {
    open(URL, detail(), {
      'GET /projects': {
        status: 200,
        body: [
          {
            id: PROJECT_ID,
            name: 'Grupo Norte',
            description: '',
            status: 'ACTIVE',
            isOwner: true,
            ownerName: 'Ana Pérez',
            myRole: 'PROJECT_ADMIN',
          },
        ],
      },
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Grupo Norte' }));
    expect(await screen.findByText('Etapa: Etapa 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Configuración' }));
    expect(await screen.findByRole('form', { name: 'Datos del proyecto' })).toBeTruthy();
  });

  it('tras crear un proyecto se entra directamente a él', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      'POST /projects': { status: 201, body: projectDetail({ name: 'Recién creado' }) },
      [`GET ${URL}`]: detail({ name: 'Recién creado' }),
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Recién creado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(await screen.findByRole('heading', { name: 'Recién creado' })).toBeTruthy();
    expect(screen.getByText('Etapa: Etapa 1')).toBeTruthy();
  });
});

describe('configuración: datos del proyecto', () => {
  const settings = `${URL}/settings`;

  it('quien puede editar guarda los cambios con la versión leída y ve el resultado', async () => {
    const { calls } = open(settings, detail(), {
      [`PATCH ${URL}`]: {
        status: 200,
        body: projectDetail({ name: 'Nuevo nombre', version: 2 }),
      },
    });
    renderApp(settings);
    const form = await screen.findByRole('form', { name: 'Datos del proyecto' });

    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Nuevo nombre' } });
    fireEvent.change(within(form).getByLabelText('Descripción'), { target: { value: 'Otra' } });
    fireEvent.change(within(form).getByLabelText('Formato de fecha'), {
      target: { value: 'MM/DD/YYYY' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    expect((await screen.findByText('Los cambios se guardaron.')).textContent).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      name: 'Nuevo nombre',
      description: 'Otra',
      timezone: 'America/Lima',
      dateFormat: 'MM/DD/YYYY',
      version: 1,
    });
    expect(screen.getByRole('heading', { name: 'Nuevo nombre' })).toBeTruthy();
    expect(
      within(screen.getByRole('form', { name: 'Datos del proyecto' })).getByDisplayValue(
        'Nuevo nombre',
      ),
    ).toBeTruthy();
  });

  it('la moneda se muestra como no modificable', async () => {
    open(settings, detail());
    renderApp(settings);
    await screen.findByRole('form', { name: 'Datos del proyecto' });
    expect(screen.getByText(/Moneda: PEN \(no se puede cambiar\)/)).toBeTruthy();
  });

  it('valida en el navegador y no llama a la API con datos inválidos', async () => {
    const { calls } = open(settings, detail());
    renderApp(settings);
    const form = await screen.findByRole('form', { name: 'Datos del proyecto' });

    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: '   ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(form).findByRole('alert')).toBeTruthy();

    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Ok' } });
    fireEvent.change(within(form).getByLabelText('Zona horaria'), {
      target: { value: 'Nada/Nada' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(within(form).getByRole('alert').textContent).toMatch(/Zona horaria no válida/),
    );
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('un conflicto de versión avisa y permite recargar los datos actuales', async () => {
    let loads = 0;
    open(
      settings,
      { status: 200 },
      {
        [`GET ${URL}`]: () => {
          loads += 1;
          return loads === 1
            ? { status: 200, body: projectDetail() }
            : {
                status: 200,
                body: projectDetail({ name: 'Cambiado por otra persona', version: 3 }),
              };
        },
        [`PATCH ${URL}`]: apiError(409, 'CONCURRENCY_CONFLICT'),
      },
    );
    renderApp(settings);
    const form = await screen.findByRole('form', { name: 'Datos del proyecto' });

    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Mi edición' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(/Otra persona modificó/);

    fireEvent.click(within(form).getByRole('button', { name: 'Recargar datos' }));
    expect(await screen.findByDisplayValue('Cambiado por otra persona')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sin permiso para editar los datos son solo de lectura', async () => {
    open(settings, detail(asReader));
    renderApp(settings);
    expect((await screen.findByRole('status')).textContent).toMatch(
      /No tienes permiso para modificar/,
    );
    expect(screen.queryByRole('form', { name: 'Datos del proyecto' })).toBeNull();
    expect(screen.getByText('America/Lima')).toBeTruthy();
  });
});

describe('configuración: estado del proyecto (F3)', () => {
  const settings = `${URL}/settings`;
  const confirm = async () => {
    const group = await screen.findByRole('group', { name: 'Confirmación' });
    return group;
  };

  describe('qué acciones ve cada rol', () => {
    const names = () =>
      screen
        .queryAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) =>
          [
            'Cerrar proyecto',
            'Reabrir proyecto',
            'Enviar a la papelera',
            'Salir del proyecto',
          ].includes(t ?? ''),
        );

    it('propietario: cerrar y papelera (no puede salir)', async () => {
      open(settings, detail());
      renderApp(settings);
      await screen.findByRole('heading', { name: 'Estado del proyecto' });
      expect(names()).toEqual(['Cerrar proyecto', 'Enviar a la papelera']);
    });

    it('propietario con el proyecto cerrado: reabrir y papelera', async () => {
      open(settings, detail({ status: 'CLOSED' }));
      renderApp(settings);
      await screen.findByRole('heading', { name: 'Estado del proyecto' });
      expect(names()).toEqual(['Reabrir proyecto', 'Enviar a la papelera']);
    });

    it('Administrador de Proyecto: cerrar y salir (ni reabrir ni papelera)', async () => {
      open(settings, detail(asAdmin));
      renderApp(settings);
      await screen.findByRole('heading', { name: 'Estado del proyecto' });
      expect(names()).toEqual(['Cerrar proyecto', 'Salir del proyecto']);
    });

    it('Administrador de Proyecto con el proyecto cerrado: solo salir', async () => {
      open(settings, detail({ ...asAdmin, status: 'CLOSED' }));
      renderApp(settings);
      await screen.findByRole('heading', { name: 'Estado del proyecto' });
      expect(names()).toEqual(['Salir del proyecto']);
    });

    it('lector: solo salir', async () => {
      open(settings, detail(asReader));
      renderApp(settings);
      await screen.findByRole('heading', { name: 'Estado del proyecto' });
      expect(names()).toEqual(['Salir del proyecto']);
    });

    it('Administrador Global sin ser miembro: cerrar y papelera, sin salir', async () => {
      open(settings, detail(asGlobalAdmin));
      renderApp(settings);
      await screen.findByRole('heading', { name: 'Estado del proyecto' });
      expect(names()).toEqual(['Cerrar proyecto', 'Enviar a la papelera']);
    });
  });

  it('cerrar pide confirmación y contraseña reciente, y deja el proyecto cerrado', async () => {
    let reauth = false;
    const { calls } = open(settings, detail(), {
      [`POST ${URL}/close`]: () =>
        reauth
          ? { status: 200, body: projectDetail({ status: 'CLOSED', version: 2 }) }
          : apiError(403, 'REAUTH_REQUIRED'),
      'POST /auth/reauth': () => {
        reauth = true;
        return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
      },
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar proyecto' }));
    // Todavía no se ha llamado a la API: falta confirmar.
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Confirmar' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
    fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect((await screen.findByText('El proyecto se cerró.')).textContent).toBeTruthy();
    expect(screen.getByText('Cerrado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reabrir proyecto' })).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      `${URL}/close`,
      '/auth/reauth',
      `${URL}/close`,
    ]);
  });

  it('cancelar la confirmación no llama a la API', async () => {
    const { calls } = open(settings, detail());
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar proyecto' }));
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('group', { name: 'Confirmación' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar proyecto' })).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('cancelar el cuadro de contraseña no ejecuta la acción ni muestra error', async () => {
    const { calls } = open(settings, detail(), {
      [`POST ${URL}/close`]: apiError(403, 'REAUTH_REQUIRED'),
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar proyecto' }));
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Confirmar' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(calls.filter((c) => c.path.endsWith('/close'))).toHaveLength(1);
  });

  it('reabrir deja el proyecto activo otra vez', async () => {
    open(settings, detail({ status: 'CLOSED' }), {
      [`POST ${URL}/reopen`]: {
        status: 200,
        body: projectDetail({ status: 'ACTIVE', version: 2 }),
      },
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir proyecto' }));
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('El proyecto se reabrió.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar proyecto' })).toBeTruthy();
  });

  it('enviar a la papelera envía el motivo y lleva a la papelera', async () => {
    const { calls } = open(settings, detail(), {
      [`POST ${URL}/trash`]: { status: 200, body: { id: PROJECT_ID, status: 'TRASHED' } },
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar a la papelera' }));
    const group = await confirm();
    fireEvent.change(within(group).getByLabelText('Motivo (opcional)'), {
      target: { value: '  Ya no lo usamos ' },
    });
    fireEvent.click(within(group).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('heading', { name: 'Papelera' })).toBeTruthy();
    expect(calls.find((c) => c.path === `${URL}/trash`)!.body).toEqual({
      reason: 'Ya no lo usamos',
    });
  });

  it('enviar a la papelera sin motivo envía un cuerpo vacío', async () => {
    const { calls } = open(settings, detail(), {
      [`POST ${URL}/trash`]: { status: 200, body: { id: PROJECT_ID, status: 'TRASHED' } },
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar a la papelera' }));
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Confirmar' }));
    await screen.findByRole('heading', { name: 'Papelera' });
    expect(calls.find((c) => c.path === `${URL}/trash`)!.body).toEqual({});
  });

  it('salir del proyecto vuelve a Mis proyectos sin pedir contraseña', async () => {
    const { calls } = open(settings, detail(asReader), {
      [`POST ${URL}/leave`]: { status: 204 },
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Salir del proyecto' }));
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeTruthy();
    expect(calls.some((c) => c.path === '/auth/reauth')).toBe(false);
  });

  it('muestra el error de la API (p. ej. transición no válida) y mantiene la confirmación', async () => {
    open(settings, detail(), {
      [`POST ${URL}/close`]: apiError(
        409,
        'INVALID_STATE',
        'No se puede cerrar un proyecto en estado CLOSED.',
      ),
    });
    renderApp(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar proyecto' }));
    fireEvent.click(within(await confirm()).getByRole('button', { name: 'Confirmar' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se puede cerrar un proyecto en estado CLOSED.',
    );
  });
});
