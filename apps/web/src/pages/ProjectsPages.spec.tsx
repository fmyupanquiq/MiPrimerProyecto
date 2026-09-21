import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginPathFor, safeNextPath } from '../auth/redirect.js';
import {
  ANA,
  apiError,
  authState,
  AUTH_STATE,
  projectDetail,
  PROJECT_ID,
  projectSummary,
  renderApp,
  stubApi,
  UNAUTHENTICATED,
} from '../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Mis proyectos', () => {
  it('lista los proyectos con su estado, propietario y el rol de la persona', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': {
        status: 200,
        body: [
          projectSummary({ description: 'Apuestas deportivas del grupo' }),
          projectSummary({
            id: '0195f7c0-0000-7000-8000-0000000000a2',
            name: 'Grupo Sur',
            status: 'CLOSED',
            isOwner: false,
            ownerName: 'Luis Rojas',
            myRole: 'COLLABORATOR',
          }),
        ],
      },
    });
    renderApp('/');

    const north = await screen.findByRole('link', { name: 'Grupo Norte' });
    expect(north.getAttribute('href')).toBe(`/projects/${PROJECT_ID}`);
    expect(screen.getByText('Apuestas deportivas del grupo')).toBeTruthy();
    expect(screen.getByText(/Eres el propietario/)).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();

    expect(screen.getByRole('link', { name: 'Grupo Sur' })).toBeTruthy();
    expect(screen.getByText('Cerrado')).toBeTruthy();
    expect(screen.getByText(/Propietario: Luis Rojas · Tu rol: Colaborador/)).toBeTruthy();
  });

  it('sin proyectos explica cómo empezar', async () => {
    stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': { status: 200, body: [] } });
    renderApp('/');
    expect((await screen.findByRole('status')).textContent).toMatch(/acepta una invitación/);
  });

  it('muestra un error si no se pueden cargar', async () => {
    stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': apiError(500, 'INTERNAL_ERROR') });
    renderApp('/');
    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo completar/);
  });

  it('el enlace "Papelera" lleva a la papelera', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      'GET /projects/trash': { status: 200, body: [] },
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Papelera' }));
    expect(await screen.findByRole('heading', { name: 'Papelera' })).toBeTruthy();
  });

  describe('crear un proyecto (F1: cualquier usuario con rol USER)', () => {
    it('cualquier persona con el permiso projects.create ve el botón', async () => {
      stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': { status: 200, body: [] } });
      renderApp('/');
      expect(await screen.findByRole('button', { name: 'Nuevo proyecto' })).toBeTruthy();
    });

    it('sin el permiso no se ofrece crear proyectos', async () => {
      stubApi({ 'GET /auth/me': authState([]), 'GET /projects': { status: 200, body: [] } });
      renderApp('/');
      await screen.findByRole('heading', { name: 'Mis proyectos' });
      expect(screen.queryByRole('button', { name: 'Nuevo proyecto' })).toBeNull();
    });

    it('envía el proyecto con los valores por defecto (Lima, DD/MM/AAAA, sin moneda editable)', async () => {
      const { calls } = stubApi({
        'GET /auth/me': AUTH_STATE,
        'GET /projects': { status: 200, body: [] },
        'POST /projects': { status: 201, body: projectDetail({ name: 'Mi grupo' }) },
      });
      renderApp('/');
      fireEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));

      const form = screen.getByRole('form', { name: 'Nuevo proyecto' });
      expect(within(form).getByText(/Moneda: PEN/)).toBeTruthy();
      fireEvent.change(within(form).getByLabelText('Nombre'), {
        target: { value: '  Mi grupo  ' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear proyecto' }));

      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        name: 'Mi grupo',
        description: '',
        timezone: 'America/Lima',
        dateFormat: 'DD/MM/YYYY',
      });
    });

    it('permite elegir zona horaria y formato de fecha', async () => {
      const { calls } = stubApi({
        'GET /auth/me': AUTH_STATE,
        'GET /projects': { status: 200, body: [] },
        'POST /projects': { status: 201, body: projectDetail() },
      });
      renderApp('/');
      fireEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
      const form = screen.getByRole('form', { name: 'Nuevo proyecto' });
      fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'X' } });
      fireEvent.change(within(form).getByLabelText('Descripción (opcional)'), {
        target: { value: 'Una descripción' },
      });
      fireEvent.change(within(form).getByLabelText('Zona horaria'), {
        target: { value: 'America/Bogota' },
      });
      fireEvent.change(within(form).getByLabelText('Formato de fecha'), {
        target: { value: 'YYYY-MM-DD' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear proyecto' }));

      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        name: 'X',
        description: 'Una descripción',
        timezone: 'America/Bogota',
        dateFormat: 'YYYY-MM-DD',
      });
    });

    it('valida en el navegador: nombre obligatorio y zona horaria conocida', async () => {
      const { calls } = stubApi({
        'GET /auth/me': AUTH_STATE,
        'GET /projects': { status: 200, body: [] },
      });
      renderApp('/');
      fireEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
      const form = screen.getByRole('form', { name: 'Nuevo proyecto' });

      fireEvent.click(within(form).getByRole('button', { name: 'Crear proyecto' }));
      expect(await within(form).findByRole('alert')).toBeTruthy();

      fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'X' } });
      fireEvent.change(within(form).getByLabelText('Zona horaria'), {
        target: { value: 'Marte/Olympus' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear proyecto' }));
      await waitFor(() =>
        expect(within(form).getByRole('alert').textContent).toMatch(/Zona horaria no válida/),
      );
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });

    it('muestra el error de la API sin perder lo escrito', async () => {
      stubApi({
        'GET /auth/me': AUTH_STATE,
        'GET /projects': { status: 200, body: [] },
        'POST /projects': apiError(403, 'FORBIDDEN'),
      });
      renderApp('/');
      fireEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
      const form = screen.getByRole('form', { name: 'Nuevo proyecto' });
      fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Mi grupo' } });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear proyecto' }));

      expect((await within(form).findByRole('alert')).textContent).toMatch(/No tienes permiso/);
      expect((within(form).getByLabelText('Nombre') as HTMLInputElement).value).toBe('Mi grupo');
    });

    it('Cancelar cierra el formulario', async () => {
      stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': { status: 200, body: [] } });
      renderApp('/');
      fireEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('form', { name: 'Nuevo proyecto' })).toBeNull();
    });
  });

  describe('Administrador Global', () => {
    it('puede ver todos los proyectos del sistema; el resto de personas no ve la opción', async () => {
      const { calls } = stubApi({
        'GET /auth/me': authState(['projects.create', 'projects.list_all']),
        'GET /projects': { status: 200, body: [] },
        'GET /projects?scope=all': {
          status: 200,
          body: [projectSummary({ name: 'De otra persona', isOwner: false, myRole: null })],
        },
      });
      renderApp('/');
      fireEvent.click(await screen.findByLabelText('Ver todos los proyectos del sistema'));

      expect(await screen.findByRole('link', { name: 'De otra persona' })).toBeTruthy();
      expect(calls.some((c) => c.path === '/projects?scope=all')).toBe(true);
    });

    it('sin el permiso list_all no aparece la opción', async () => {
      stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': { status: 200, body: [] } });
      renderApp('/');
      await screen.findByRole('heading', { name: 'Mis proyectos' });
      expect(screen.queryByLabelText('Ver todos los proyectos del sistema')).toBeNull();
    });
  });
});

describe('Papelera de proyectos', () => {
  const trashed = projectSummary({
    name: 'Grupo viejo',
    status: 'TRASHED',
    previousStatus: 'CLOSED',
    deletedAt: '2026-06-01T12:00:00.000Z',
    purgeEligibleAt: '2026-08-30T12:00:00.000Z',
  });

  it('lista los proyectos borrados con el estado anterior y la fecha límite mínima', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects/trash': { status: 200, body: [trashed] },
    });
    renderApp('/projects/trash');
    expect(await screen.findByText('Grupo viejo')).toBeTruthy();
    expect(screen.getByText(/Estado anterior: Cerrado/)).toBeTruthy();
    expect(screen.getByText(/Restaurable como mínimo hasta/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restaurar Grupo viejo' })).toBeTruthy();
  });

  it('está vacía si no hay proyectos borrados', async () => {
    stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects/trash': { status: 200, body: [] } });
    renderApp('/projects/trash');
    expect((await screen.findByRole('status')).textContent).toBe('La papelera está vacía.');
  });

  it('restaura un proyecto y actualiza la lista', async () => {
    let restored = false;
    const { calls } = stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects/trash': () => ({ status: 200, body: restored ? [] : [trashed] }),
      [`POST /projects/${PROJECT_ID}/restore`]: () => {
        restored = true;
        return { status: 200, body: projectDetail() };
      },
    });
    renderApp('/projects/trash');
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Grupo viejo' }));

    expect((await screen.findByText(/se restauró correctamente/)).textContent).toContain(
      'Grupo viejo',
    );
    await waitFor(() => expect(screen.queryByText(/Estado anterior/)).toBeNull());
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  describe('reautenticación al restaurar (§39)', () => {
    const reauthRoutes = (options: { passwordOk?: boolean } = {}) => {
      let attempts = 0;
      return stubApi({
        'GET /auth/me': AUTH_STATE,
        'GET /projects/trash': { status: 200, body: [trashed] },
        [`POST /projects/${PROJECT_ID}/restore`]: () => {
          attempts += 1;
          // La primera vez la API exige la contraseña; tras confirmarla, se acepta.
          return attempts === 1 && !reauthDone
            ? apiError(403, 'REAUTH_REQUIRED')
            : { status: 200, body: projectDetail() };
        },
        'POST /auth/reauth': () => {
          if (options.passwordOk === false) return apiError(403, 'INVALID_CREDENTIALS');
          reauthDone = true;
          return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
        },
      });
    };
    let reauthDone = false;

    it('pide la contraseña, la confirma y reintenta la restauración una vez', async () => {
      reauthDone = false;
      const { calls } = reauthRoutes();
      renderApp('/projects/trash');
      fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Grupo viejo' }));

      const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'mi-clave-secreta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText(/se restauró correctamente/)).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      const sequence = calls.filter((c) => c.method === 'POST').map((c) => c.path);
      expect(sequence).toEqual([
        `/projects/${PROJECT_ID}/restore`,
        '/auth/reauth',
        `/projects/${PROJECT_ID}/restore`,
      ]);
      expect(calls.find((c) => c.path === '/auth/reauth')!.body).toEqual({
        password: 'mi-clave-secreta',
      });
    });

    it('una contraseña incorrecta deja el cuadro abierto con el error y no restaura', async () => {
      reauthDone = false;
      const { calls } = reauthRoutes({ passwordOk: false });
      renderApp('/projects/trash');
      fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Grupo viejo' }));

      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'incorrecta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect((await within(dialog).findByRole('alert')).textContent).toBe(
        'Correo o contraseña incorrectos.',
      );
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(calls.filter((c) => c.path.endsWith('/restore'))).toHaveLength(1);
    });

    it('cancelar el cuadro no restaura ni muestra un error', async () => {
      reauthDone = false;
      const { calls } = reauthRoutes();
      renderApp('/projects/trash');
      fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Grupo viejo' }));

      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(/se restauró/)).toBeNull();
      expect(calls.filter((c) => c.path.endsWith('/restore'))).toHaveLength(1);
      expect(calls.some((c) => c.path === '/auth/reauth')).toBe(false);
    });

    it('exige la contraseña antes de llamar a la API de reautenticación', async () => {
      reauthDone = false;
      const { calls } = reauthRoutes();
      renderApp('/projects/trash');
      fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Grupo viejo' }));

      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
      expect((await within(dialog).findByRole('alert')).textContent).toBe('Ingresa tu contraseña.');
      expect(calls.some((c) => c.path === '/auth/reauth')).toBe(false);
    });
  });

  it('un error distinto de la reautenticación se muestra sin abrir el cuadro', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects/trash': { status: 200, body: [trashed] },
      [`POST /projects/${PROJECT_ID}/restore`]: apiError(
        409,
        'INVALID_STATE',
        'Ya no está en la papelera.',
      ),
    });
    renderApp('/projects/trash');
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Grupo viejo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Ya no está en la papelera.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('volver a la página pedida tras iniciar sesión', () => {
  it('sin sesión, una ruta interna redirige al login recordando la ruta y vuelve al entrar', async () => {
    stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/login': AUTH_STATE,
      'GET /projects/trash': { status: 200, body: [] },
    });
    renderApp('/projects/trash');

    await screen.findByRole('heading', { name: 'Iniciar sesión' });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: ANA.email },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Papelera' })).toBeTruthy();
  });

  it('safeNextPath solo admite rutas internas', () => {
    expect(safeNextPath('/projects/abc?x=1')).toBe('/projects/abc?x=1');
    expect(safeNextPath('/')).toBe('/');
    for (const bad of [
      null,
      undefined,
      '',
      'https://malicioso.example',
      '//malicioso.example',
      '/\\malicioso.example',
      'javascript:alert(1)',
      'proyectos',
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe('/');
    }
  });

  it('loginPathFor codifica la ruta y no añade next para la principal', () => {
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/invite?token=abc')).toBe('/login?next=%2Finvite%3Ftoken%3Dabc');
  });

  it('un next malicioso se ignora y se entra a la página principal', async () => {
    stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
    });
    renderApp('/login?next=https%3A%2F%2Fmalicioso.example');
    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeTruthy();
  });
});
