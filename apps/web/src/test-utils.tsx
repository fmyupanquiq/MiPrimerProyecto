import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from './App.js';

export interface StubResponse {
  status: number;
  body?: unknown;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

type Handler = StubResponse | ((call: RecordedCall) => StubResponse);

/**
 * Sustituye `fetch` por un simulador de la API. Las rutas se indican como `"MÉTODO /ruta"`
 * (sin el prefijo `/api`); una petición no prevista hace fallar la prueba.
 */
export function stubApi(routes: Record<string, Handler>): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(input).replace(/^\/api/, '');
      const call: RecordedCall = {
        method,
        path,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);

      const handler = routes[`${method} ${path}`];
      if (!handler) return Promise.reject(new Error(`Petición no prevista: ${method} ${path}`));
      const { status, body } = typeof handler === 'function' ? handler(call) : handler;
      return Promise.resolve(
        new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return { calls };
}

export function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

export const ANA = {
  id: '0195f7c0-0000-7000-8000-000000000001',
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@example.com',
  avatarRef: null,
  status: 'ACTIVE',
  globalRole: 'USER',
  createdAt: '2026-06-01T12:00:00.000Z',
  lastLoginAt: null,
  version: 1,
} as const;

export const SESSION = {
  id: '0195f7c0-0000-7000-8000-000000000002',
  persistent: false,
  createdAt: '2026-06-01T12:00:00.000Z',
  lastSeenAt: '2026-06-01T12:00:00.000Z',
  expiresAt: '2026-06-02T00:00:00.000Z',
  ip: '127.0.0.1',
  userAgent: 'test',
  current: true,
} as const;

export const UNAUTHENTICATED: StubResponse = {
  status: 401,
  body: { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Se requiere iniciar sesión.' },
};

export const AUTH_STATE: StubResponse = {
  status: 200,
  body: { user: ANA, session: SESSION, permissions: ['projects.create'] },
};

// ---------------------------------------------------------------------------------------------
// Datos de ejemplo de la Fase 2 (proyectos, miembros, invitaciones)
// ---------------------------------------------------------------------------------------------
export const PROJECT_ID = '0195f7c0-0000-7000-8000-0000000000a1';

export const apiError = (status: number, code: string, message = 'x'): StubResponse => ({
  status,
  body: { statusCode: status, code, message },
});

/** Respuesta de `GET /auth/me` con permisos globales a medida. */
export function authState(
  permissions: string[] = ['projects.create'],
  user: Record<string, unknown> = ANA,
): StubResponse {
  return { status: 200, body: { user, session: SESSION, permissions } };
}

export function projectSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: 'Grupo Norte',
    description: '',
    imageRef: null,
    status: 'ACTIVE',
    ownerId: ANA.id,
    ownerName: 'Ana Pérez',
    isOwner: true,
    myRole: 'PROJECT_ADMIN',
    createdAt: '2026-06-01T12:00:00.000Z',
    deletedAt: null,
    purgeEligibleAt: null,
    previousStatus: null,
    ...overrides,
  };
}

/** Permisos de la persona que es propietaria y Administradora de Proyecto. */
export const OWNER_PERMISSIONS = [
  'invitations.create',
  'invitations.disable',
  'invitations.view',
  'members.remove',
  'members.update_role',
  'members.view',
  'project.close',
  'project.reopen',
  'project.restore',
  'project.trash',
  'project.update',
  'project.view',
  'projects.create',
];

export function projectDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...projectSummary(),
    currency: 'PEN',
    timezone: 'America/Lima',
    dateFormat: 'DD/MM/YYYY',
    version: 1,
    updatedAt: '2026-06-01T12:00:00.000Z',
    myPermissions: OWNER_PERMISSIONS,
    ...overrides,
  };
}
