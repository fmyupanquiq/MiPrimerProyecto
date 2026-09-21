import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import {
  ANA,
  apiError,
  AUTH_STATE,
  type Handler,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
  UNAUTHENTICATED,
} from '../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TOKEN = 'T'.repeat(43);
const INVITE = `/invite?token=${TOKEN}`;
const PREVIEW = {
  projectName: 'Grupo Norte',
  roleName: 'Colaborador',
  invitedBy: 'Adela Vega',
  expiresAt: '2026-06-08T12:00:00.000Z',
  singleUse: true,
  restrictedEmailHint: null,
};
const ACCEPTED = {
  status: 200,
  body: {
    projectId: PROJECT_ID,
    projectName: 'Grupo Norte',
    roleName: 'Colaborador',
    outcome: 'ADDED',
  },
};

function open(
  auth: Handler,
  extra: Record<string, Handler> = {},
  preview: Handler = { status: 200, body: PREVIEW },
) {
  return stubApi({
    'GET /auth/me': auth,
    'POST /invitations/preview': preview,
    'GET /projects': { status: 200, body: [] },
    [`GET /projects/${PROJECT_ID}`]: { status: 200, body: projectDetail() },
    ...extra,
  });
}

const fillRegister = (overrides: Record<string, string> = {}) => {
  const values = {
    Nombre: 'Nora',
    Apellido: 'Quispe',
    'Correo electrónico': 'Nora@Example.com',
    'Contraseña nueva': 'contraseña-larga-2026',
    'Repite la contraseña': 'contraseña-larga-2026',
    ...overrides,
  };
  const form = screen.getByRole('form', { name: 'Crear cuenta' });
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  }
  fireEvent.click(within(form).getByRole('button', { name: 'Crear cuenta' }));
};

describe('invitación: enlace y vista previa', () => {
  it('sin token muestra que la invitación no es válida y no llama a la API', async () => {
    const { calls } = open(UNAUTHENTICATED);
    renderApp('/invite');
    expect(await screen.findByRole('heading', { name: 'Invitación no válida' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/no contiene ninguna invitación/);
    expect(calls.some((c) => c.path === '/invitations/preview')).toBe(false);
  });

  it('un enlace inválido (usado, vencido, deshabilitado…) se explica sin distinguir el motivo', async () => {
    open(UNAUTHENTICATED, {}, apiError(400, 'INVALID_TOKEN'));
    renderApp(INVITE);
    expect(await screen.findByRole('heading', { name: 'Invitación no válida' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/puede haber caducado, haberse usado/);
    expect(screen.queryByRole('button', { name: 'Aceptar invitación' })).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('un fallo del servidor permite reintentar', async () => {
    let calls = 0;
    open(UNAUTHENTICATED, {}, () => {
      calls += 1;
      return calls === 1 ? apiError(500, 'INTERNAL_ERROR') : { status: 200, body: PREVIEW };
    });
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText(/te invitó al proyecto/)).toBeTruthy();
  });

  it('muestra quién invita, el proyecto, el rol y la vigencia; envía el token a la vista previa', async () => {
    const { calls } = open(UNAUTHENTICATED);
    renderApp(INVITE);
    const card = await screen.findByRole('region', { name: 'Invitación' });
    expect(within(card).getByText('Adela Vega')).toBeTruthy();
    expect(within(card).getByText('«Grupo Norte»')).toBeTruthy();
    expect(within(card).getByText('Colaborador')).toBeTruthy();
    expect(within(card).getByText(/Vigente hasta/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/invitations/preview')!.body).toEqual({ token: TOKEN });
  });

  it('indica cuando la invitación es solo para un correo y cuando no vence', async () => {
    open(
      UNAUTHENTICATED,
      {},
      {
        status: 200,
        body: { ...PREVIEW, expiresAt: null, restrictedEmailHint: 'n***@example.com' },
      },
    );
    renderApp(INVITE);
    const card = await screen.findByRole('region', { name: 'Invitación' });
    expect(within(card).getByText('n***@example.com')).toBeTruthy();
    expect(within(card).getByText('No tiene fecha de vencimiento.')).toBeTruthy();
  });

  it('el index.html impide enviar el token en la cabecera Referer', () => {
    expect(indexHtml).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"/);
  });
});

describe('invitación: sin cuenta (registro por invitación)', () => {
  it('ofrece crear la cuenta o iniciar sesión, sin aceptar nada por su cuenta', async () => {
    const { calls } = open(UNAUTHENTICATED);
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });
    expect(screen.getByRole('button', { name: 'Ya tengo cuenta' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aceptar invitación' })).toBeNull();
    expect(calls.some((c) => c.path === '/invitations/accept')).toBe(false);
  });

  it('crea la cuenta con el token y luego pide aceptar (crear la cuenta no acepta)', async () => {
    let authenticated = false;
    const { calls } = open(
      { status: 200 },
      {
        'GET /auth/me': () => (authenticated ? AUTH_STATE : UNAUTHENTICATED),
        'POST /auth/register': () => {
          authenticated = true;
          return AUTH_STATE;
        },
        'POST /invitations/accept': ACCEPTED,
      },
    );
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });
    fillRegister();

    expect((await screen.findByText(/Tu cuenta se creó/)).textContent).toMatch(
      /acepta la invitación/,
    );
    expect(screen.getByRole('button', { name: 'Aceptar invitación' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/register')!.body).toEqual({
      token: TOKEN,
      firstName: 'Nora',
      lastName: 'Quispe',
      email: 'nora@example.com',
      password: 'contraseña-larga-2026',
      keepSignedIn: false,
    });
    // Todavía no se ha aceptado.
    expect(calls.some((c) => c.path === '/invitations/accept')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar invitación' }));
    expect(await screen.findByRole('heading', { name: 'Grupo Norte' })).toBeTruthy();
    expect(calls.find((c) => c.path === '/invitations/accept')!.body).toEqual({ token: TOKEN });
  });

  it('valida en el navegador: contraseñas que no coinciden, política y datos obligatorios', async () => {
    const { calls } = open(UNAUTHENTICATED);
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });

    fillRegister({ 'Repite la contraseña': 'otra-distinta-2026' });
    expect((await screen.findByRole('alert')).textContent).toBe('Las contraseñas no coinciden.');

    fillRegister({ 'Contraseña nueva': 'corta', 'Repite la contraseña': 'corta' });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/al menos 10 caracteres/),
    );

    fillRegister({ Nombre: '  ' });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fillRegister({ 'Correo electrónico': 'no-es-correo' });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(calls.filter((c) => c.path === '/auth/register')).toHaveLength(0);
  });

  it('un correo ya registrado lo explica y lleva a iniciar sesión', async () => {
    open(UNAUTHENTICATED, { 'POST /auth/register': apiError(409, 'EMAIL_IN_USE') });
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });
    fillRegister();

    expect((await screen.findByRole('alert')).textContent).toMatch(/ya tiene una cuenta/);
    fireEvent.click(screen.getByRole('button', { name: 'Ya tengo cuenta: iniciar sesión' }));
    expect(await screen.findByRole('form', { name: 'Iniciar sesión' })).toBeTruthy();
  });

  it('con una invitación restringida a otro correo explica cuál debe usar', async () => {
    open(
      UNAUTHENTICATED,
      { 'POST /auth/register': apiError(403, 'FORBIDDEN') },
      { status: 200, body: { ...PREVIEW, restrictedEmailHint: 'n***@example.com' } },
    );
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });
    fillRegister({ 'Correo electrónico': 'otra@example.com' });
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /solo para la cuenta n\*\*\*@example\.com/,
    );
  });

  it('muestra las reglas de contraseña que solo conoce el servidor', async () => {
    open(UNAUTHENTICATED, {
      'POST /auth/register': {
        status: 400,
        body: {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: [{ path: 'password', message: 'No puede contener la parte local del correo.' }],
        },
      },
    });
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });
    fillRegister({
      'Correo electrónico': 'nora@example.com',
      'Contraseña nueva': 'una-clave-larga-99',
      'Repite la contraseña': 'una-clave-larga-99',
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No puede contener la parte local del correo.',
    );
  });

  it('si la invitación caducó mientras se registraba lo indica', async () => {
    open(UNAUTHENTICATED, { 'POST /auth/register': apiError(400, 'INVALID_TOKEN') });
    renderApp(INVITE);
    await screen.findByRole('form', { name: 'Crear cuenta' });
    fillRegister();
    expect((await screen.findByRole('alert')).textContent).toMatch(/ya no es válida/);
  });

  it('quien ya tiene cuenta inicia sesión aquí mismo y ve aceptar o rechazar', async () => {
    let authenticated = false;
    const { calls } = open(
      { status: 200 },
      {
        'GET /auth/me': () => (authenticated ? AUTH_STATE : UNAUTHENTICATED),
        'POST /auth/login': () => {
          authenticated = true;
          return AUTH_STATE;
        },
      },
    );
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Ya tengo cuenta' }));
    const form = await screen.findByRole('form', { name: 'Iniciar sesión' });
    fireEvent.change(within(form).getByLabelText('Correo electrónico'), {
      target: { value: ' Ana@Example.com ' },
    });
    fireEvent.change(within(form).getByLabelText('Contraseña'), {
      target: { value: 'mi-clave-secreta' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('button', { name: 'Aceptar invitación' })).toBeTruthy();
    expect(screen.queryByText(/Tu cuenta se creó/)).toBeNull();
    expect(calls.find((c) => c.path === '/auth/login')!.body).toEqual({
      email: 'ana@example.com',
      password: 'mi-clave-secreta',
      keepSignedIn: false,
    });
  });

  it('un inicio de sesión incorrecto muestra el error y no acepta nada', async () => {
    const { calls } = open(UNAUTHENTICATED, {
      'POST /auth/login': apiError(401, 'INVALID_CREDENTIALS'),
    });
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Ya tengo cuenta' }));
    const form = await screen.findByRole('form', { name: 'Iniciar sesión' });
    fireEvent.change(within(form).getByLabelText('Correo electrónico'), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.change(within(form).getByLabelText('Contraseña'), {
      target: { value: 'incorrecta' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Entrar' }));

    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Correo o contraseña incorrectos.',
    );
    expect(calls.some((c) => c.path === '/invitations/accept')).toBe(false);
  });
});

describe('invitación: con la sesión iniciada', () => {
  it('muestra la cuenta y permite aceptar: entra al proyecto', async () => {
    const { calls } = open(AUTH_STATE, { 'POST /invitations/accept': ACCEPTED });
    renderApp(INVITE);
    expect(await screen.findByText(/Sesión iniciada como/)).toBeTruthy();
    expect(screen.getByText(ANA.email, { exact: false })).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar invitación' }));
    expect(await screen.findByRole('heading', { name: 'Grupo Norte' })).toBeTruthy();
    expect(screen.getByText('Etapa: sin etapa activa')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/invitations/accept')).toHaveLength(1);
  });

  it('quien ya era miembro también entra al proyecto (aceptar es idempotente)', async () => {
    open(AUTH_STATE, {
      'POST /invitations/accept': {
        status: 200,
        body: { ...ACCEPTED.body, outcome: 'ALREADY_MEMBER' },
      },
    });
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar invitación' }));
    expect(await screen.findByRole('heading', { name: 'Grupo Norte' })).toBeTruthy();
  });

  it('rechazar solo lo confirma: no entra al proyecto ni deja de ser válido el enlace', async () => {
    const { calls } = open(AUTH_STATE, { 'POST /invitations/reject': { status: 204 } });
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Rechazaste la invitación/);
    expect(screen.getByRole('link', { name: 'Ir a mis proyectos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aceptar invitación' })).toBeNull();
    expect(calls.find((c) => c.path === '/invitations/reject')!.body).toEqual({ token: TOKEN });
    expect(calls.some((c) => c.path === '/invitations/accept')).toBe(false);
  });

  it('una invitación dirigida a otro correo lo explica y permite cambiar de cuenta', async () => {
    let authenticated = true;
    const { calls } = open(
      { status: 200 },
      {
        'GET /auth/me': () => (authenticated ? AUTH_STATE : UNAUTHENTICATED),
        'POST /invitations/accept': apiError(403, 'FORBIDDEN'),
        'POST /auth/logout': () => {
          authenticated = false;
          return { status: 204 };
        },
      },
    );
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar invitación' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/dirigida a otra cuenta/);

    fireEvent.click(screen.getByRole('button', { name: 'Usar otra cuenta' }));
    expect(await screen.findByRole('form', { name: 'Crear cuenta' })).toBeTruthy();
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(true);
    // Sigue en la misma invitación (el token no se perdió).
    expect(screen.getByRole('region', { name: 'Invitación' })).toBeTruthy();
  });

  it('si la invitación dejó de ser válida al aceptarla lo indica', async () => {
    open(AUTH_STATE, { 'POST /invitations/accept': apiError(400, 'INVALID_TOKEN') });
    renderApp(INVITE);
    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar invitación' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/ya no es válida/);
    // Los botones siguen disponibles para reintentar o rechazar.
    expect(screen.getByRole('button', { name: 'Aceptar invitación' })).toBeTruthy();
  });
});

describe('invitación: acceso desde un enlace con sesión cerrada', () => {
  it('la ruta pública no redirige al login: conserva el token', async () => {
    open(UNAUTHENTICATED);
    renderApp(INVITE);
    expect(await screen.findByText(/te invitó al proyecto/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).toBeNull();
  });
});
