import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from './App.js';
import { ThemeProvider } from './theme.js';

export interface StubResponse {
  status: number;
  body?: unknown;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

export type Handler = StubResponse | ((call: RecordedCall) => StubResponse);

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
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
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

export const STAGE_ID = '0195f7c0-0000-7000-8000-0000000000e1';

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
    // Por defecto, un proyecto ya configurado (Fase 3): las pruebas que necesiten uno sin
    // configurar pasan `setupComplete: false, activeStage: null` explícitamente.
    setupComplete: true,
    activeStage: { id: STAGE_ID, name: 'Etapa 1', unitStake: '10.00' },
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
  'project.setup',
  'project.trash',
  'project.update',
  'project.view',
  'projects.create',
  'stages.view',
  'stages.create',
  'stages.correct_unit',
  'stages.trash',
  'stages.restore',
  'houses.view',
  'houses.create',
  'houses.deactivate',
  'movements.view',
  'movements.deposit',
  'movements.transfer',
  'movements.extraordinary',
  'withdrawals.request',
  'withdrawals.approve',
  'bets.view',
  'bets.create',
  'bets.update_own',
  'bets.update_any',
  'bets.settle',
  'bets.trash_own',
  'bets.trash_any',
  'bets.restore',
  'bets.move_stage',
  'bets.confirm_return',
  'bets.correct',
  'audit.view',
  'reconciliations.view',
  'reconciliations.confirm',
  'integrity.view',
  'integrity.run',
  'tickets.view',
  'tickets.upload',
  'tickets.analyze',
  'imports.view',
  'import.run',
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

// --- Acciones de una apuesta en la lista (Fase 10.3: menú ⋮ y selector de estado) ---------------

/** Botones de acción visibles en la fila (Editar, Eliminar): fuera del menú ⋮ desde la 10.3e. */
const ROW_BUTTONS = ['Editar', 'Eliminar'];

async function betRow(index: number): Promise<HTMLElement> {
  await screen.findAllByRole('button', { name: /^Estado:/ });
  const rows = document.querySelectorAll<HTMLElement>('[data-bet-row]');
  const row = rows[index];
  if (!row) throw new Error(`No hay apuesta en la posición ${index}`);
  return row;
}

/**
 * Elige la acción `name` de la apuesta `index` (0 = primera): el botón visible de la fila si lo
 * es (Editar, Eliminar) o, si no, la opción del menú ⋮.
 */
export async function openRowAction(name: string, index = 0) {
  const row = await betRow(index);
  const direct = ROW_BUTTONS.includes(name) ? within(row).queryByRole('button', { name }) : null;
  if (direct) {
    fireEvent.click(direct);
    return;
  }
  fireEvent.click(within(row).getByRole('button', { name: 'Más acciones' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

/** Abre el selector de estado de la apuesta `index` y elige el estado `name`. */
export async function chooseRowStatus(name: string, index = 0) {
  const selectors = await screen.findAllByRole('button', { name: /^Estado:/ });
  fireEvent.click(selectors[index]!);
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

/**
 * Acciones de la apuesta `index`: los botones visibles de la fila (Editar, Eliminar) y las del
 * menú ⋮. Vacío si no tiene ninguna. Deja el menú cerrado.
 */
export function rowActionNames(index = 0): string[] {
  const row = document.querySelectorAll<HTMLElement>('[data-bet-row]')[index];
  if (!row) return [];
  const direct = ROW_BUTTONS.filter((name) => within(row).queryByRole('button', { name }));
  const menu = within(row).queryByRole('button', { name: 'Más acciones' });
  if (!menu) return direct;
  fireEvent.click(menu);
  const names = screen.queryAllByRole('menuitem').map((item) => item.textContent ?? '');
  fireEvent.click(menu);
  return [...direct, ...names];
}
