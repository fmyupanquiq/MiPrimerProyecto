import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STATE, renderApp, stubApi, UNAUTHENTICATED } from './test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillLogin(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: password } });
}

describe('sesión y rutas', () => {
  it('sin sesión, la página principal redirige al inicio de sesión', async () => {
    stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
  });

  it('con una sesión abierta muestra directamente el contenedor autenticado', async () => {
    stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': { status: 200, body: [] } });
    renderApp('/');
    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    expect(screen.getByText(/ana@example.com/)).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeTruthy();
  });

  it('con una sesión abierta, /login redirige a la página principal', async () => {
    stubApi({ 'GET /auth/me': AUTH_STATE, 'GET /projects': { status: 200, body: [] } });
    renderApp('/login');
    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
  });

  it('las rutas desconocidas redirigen a la principal (y de ahí al login sin sesión)', async () => {
    stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp('/no-existe');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
  });

  it('cerrar sesión llama a la API y vuelve al inicio de sesión', async () => {
    const { calls } = stubApi({
      'GET /auth/me': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
      'POST /auth/logout': { status: 204 },
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /auth/logout');
  });
});

describe('inicio de sesión', () => {
  it('envía las credenciales y entra; por defecto no mantiene la sesión', async () => {
    const { calls } = stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/login': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fillLogin('  Ana@Example.com ', 'mi-clave-secreta');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    const login = calls.find((c) => c.path === '/auth/login')!;
    expect(login.method).toBe('POST');
    expect(login.body).toEqual({
      email: 'ana@example.com',
      password: 'mi-clave-secreta',
      keepSignedIn: false,
    });
  });

  it('"Mantener sesión iniciada" se envía como keepSignedIn: true', async () => {
    const { calls } = stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/login': AUTH_STATE,
      'GET /projects': { status: 200, body: [] },
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fillLogin('ana@example.com', 'mi-clave-secreta');
    fireEvent.click(screen.getByLabelText('Mantener sesión iniciada'));
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByText('Ana Pérez');
    expect(calls.find((c) => c.path === '/auth/login')!.body).toMatchObject({ keepSignedIn: true });
  });

  it('muestra el error de credenciales incorrectas sin entrar', async () => {
    stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/login': {
        status: 401,
        body: { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' },
      },
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fillLogin('ana@example.com', 'incorrecta');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Correo o contraseña incorrectos.');
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
  });

  it('informa cuánto esperar cuando la cuenta está bloqueada', async () => {
    stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/login': {
        status: 429,
        body: { statusCode: 429, code: 'ACCOUNT_LOCKED', message: 'x', retryAfterSeconds: 900 },
      },
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fillLogin('ana@example.com', 'cualquiera');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toContain('15 minutos');
  });

  it('valida en el navegador antes de llamar a la API', async () => {
    const { calls } = stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fillLogin('no-es-un-correo', '');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(0);
  });

  it('un fallo de red muestra un mensaje genérico', async () => {
    stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    // 'POST /auth/login' no está previsto: el simulador rechaza la petición como un fallo de red.
    fillLogin('ana@example.com', 'mi-clave-secreta');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo conectar/);
  });
});

describe('recuperación de contraseña', () => {
  it('muestra siempre el mismo mensaje al solicitar el enlace', async () => {
    const { calls } = stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/password/forgot': { status: 202, body: { accepted: true } },
    });
    renderApp('/forgot-password');
    fireEvent.change(await screen.findByLabelText('Correo electrónico'), {
      target: { value: 'Cualquiera@Example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Si el correo está registrado/);
    expect(calls.find((c) => c.path === '/auth/password/forgot')!.body).toEqual({
      email: 'cualquiera@example.com',
    });
  });

  it('valida el correo antes de llamar a la API', async () => {
    const { calls } = stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp('/forgot-password');
    fireEvent.change(await screen.findByLabelText('Correo electrónico'), {
      target: { value: 'no-es-correo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(calls.filter((c) => c.path.includes('forgot'))).toHaveLength(0);
  });
});

describe('restablecer contraseña', () => {
  const TOKEN = 'T'.repeat(43);
  const fill = (password: string, repeat = password) => {
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: repeat } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
  };

  it('sin token en el enlace pide solicitar uno nuevo', async () => {
    stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp('/reset-password');
    expect((await screen.findByRole('alert')).textContent).toMatch(/enlace no es válido/);
    expect(screen.getByRole('link', { name: 'Solicitar un enlace nuevo' })).toBeTruthy();
  });

  it('valida coincidencia y política de contraseñas antes de llamar a la API', async () => {
    const { calls } = stubApi({ 'GET /auth/me': UNAUTHENTICATED });
    renderApp(`/reset-password?token=${TOKEN}`);
    await screen.findByLabelText('Contraseña nueva');

    fill('una-clave-larga-1', 'otra-distinta-99');
    expect((await screen.findByRole('alert')).textContent).toMatch(/no coinciden/);

    fill('corta');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/al menos 10 caracteres/),
    );
    expect(calls.filter((c) => c.path.includes('reset'))).toHaveLength(0);
  });

  it('restablece la contraseña con el token y lo confirma', async () => {
    const { calls } = stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/password/reset': { status: 204 },
    });
    renderApp(`/reset-password?token=${TOKEN}`);
    await screen.findByLabelText('Contraseña nueva');
    fill('clave-nueva-segura-2026');

    expect(await screen.findByRole('heading', { name: 'Contraseña actualizada' })).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/password/reset')!.body).toEqual({
      token: TOKEN,
      newPassword: 'clave-nueva-segura-2026',
    });
    expect(screen.getByRole('link', { name: 'Ir a iniciar sesión' })).toBeTruthy();
  });

  it('un enlace caducado muestra el error de la API', async () => {
    stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/password/reset': {
        status: 400,
        body: { statusCode: 400, code: 'INVALID_TOKEN', message: 'x' },
      },
    });
    renderApp(`/reset-password?token=${TOKEN}`);
    await screen.findByLabelText('Contraseña nueva');
    fill('clave-nueva-segura-2026');

    expect((await screen.findByRole('alert')).textContent).toMatch(/no es válido o ha caducado/);
  });

  it('muestra las reglas que solo conoce el servidor (parte local del correo)', async () => {
    stubApi({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/password/reset': {
        status: 400,
        body: {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: [
            { path: 'newPassword', message: 'No puede contener la parte local del correo.' },
          ],
        },
      },
    });
    renderApp(`/reset-password?token=${TOKEN}`);
    await screen.findByLabelText('Contraseña nueva');
    fill('mi-ana.perez-2026');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No puede contener la parte local del correo.',
    );
  });
});
