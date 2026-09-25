import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANA, authState, renderApp, stubApi, type Handler } from '../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADMIN_PERMISSIONS = [
  'projects.create',
  'system.integrity.run',
  'system.backups.view',
  'system.backups.create',
  'system.backups.restore',
];

function open(permissions: string[], extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': authState(permissions),
    'GET /projects': { status: 200, body: [] },
    'GET /admin/integrity-checks': { status: 200, body: [] },
    'GET /admin/backups': { status: 200, body: [] },
    ...extra,
  });
}

describe('administración de la instancia (§37, §38, §109)', () => {
  it('sin ningún permiso system.*, avisa que no hay acceso', async () => {
    open(['projects.create']);
    renderApp('/admin');
    expect(await screen.findByText('No tienes permiso para ver esta sección.')).toBeTruthy();
  });

  it('con permisos, muestra ambas secciones', async () => {
    open(ADMIN_PERMISSIONS);
    renderApp('/admin');
    expect(
      await screen.findByRole('heading', { name: 'Verificación de integridad global' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Backups' })).toBeTruthy();
  });

  it('el enlace "Administración" solo aparece con permiso system.*', async () => {
    open(ADMIN_PERMISSIONS);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Administración' })).toBeTruthy();
  });

  it('sin permiso system.*, el enlace "Administración" no aparece', async () => {
    open(['projects.create']);
    renderApp('/');
    await screen.findByRole('link', { name: 'Mis proyectos' });
    expect(screen.queryByRole('link', { name: 'Administración' })).toBeNull();
  });

  it('ejecuta la verificación global y muestra el resultado', async () => {
    const run = {
      id: 'r1',
      projectId: null,
      runBy: { id: ANA.id, name: 'Ana Pérez' },
      startedAt: '2026-06-01T12:00:00.000Z',
      finishedAt: '2026-06-01T12:00:01.000Z',
      status: 'ISSUES_FOUND',
      findings: [{ check: 'NEGATIVE_AVAILABLE', message: 'Hallazgo', affected: ['house:h1'] }],
    };
    let ran = false;
    open(ADMIN_PERMISSIONS, {
      'GET /admin/integrity-checks': () => ({ status: 200, body: ran ? [run] : [] }),
      'POST /admin/integrity-checks': () => {
        ran = true;
        return { status: 201, body: run };
      },
    });
    renderApp('/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar ahora' }));
    expect(await screen.findByText('Hallazgos encontrados')).toBeTruthy();
    expect(screen.getByText('Disponible negativo')).toBeTruthy();
  });

  describe('backups', () => {
    const generation = {
      id: '0195f7c0-0000-7000-8000-0000000000b1',
      takenAt: '2026-06-01T12:00:00.000Z',
      triggeredBy: 'MANUAL',
      fileName: 'letfer-2026-06-01.dump',
      sizeBytes: 2048,
      checksum: 'a'.repeat(64),
      status: 'COMPLETED',
      errorMessage: null,
    };

    it('crea un backup manual', async () => {
      const { calls } = open(ADMIN_PERMISSIONS, {
        'POST /admin/backups': { status: 201, body: generation },
      });
      renderApp('/admin');
      fireEvent.click(await screen.findByRole('button', { name: 'Backup manual ahora' }));
      expect(await screen.findByText('Backup completado.')).toBeTruthy();
      expect(calls.some((c) => c.path === '/admin/backups' && c.method === 'POST')).toBe(true);
    });

    it('restaurar exige escribir la confirmación y reautenticación', async () => {
      let reauthed = false;
      const { calls } = open(ADMIN_PERMISSIONS, {
        'GET /admin/backups': { status: 200, body: [generation] },
        'POST /admin/backups/restore': () =>
          reauthed
            ? { status: 200, body: generation }
            : { status: 403, body: { statusCode: 403, code: 'REAUTH_REQUIRED', message: 'x' } },
        'POST /auth/reauth': () => {
          reauthed = true;
          return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
        },
      });
      renderApp('/admin');
      fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }));
      const form = screen.getByRole('form', { name: 'Confirmar restauración' });
      fireEvent.change(within(form).getByRole('textbox'), {
        target: { value: generation.id },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Confirmar restauración' }));

      const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'mi-clave-secreta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText(/^Se restauró la generación del /)).toBeTruthy();
      const posts = calls.filter((c) => c.path === '/admin/backups/restore');
      expect(posts).toHaveLength(2);
      expect(posts[1]!.body).toEqual({ generationId: generation.id, confirmation: generation.id });
    });

    it('sin permiso system.backups.restore, no se ofrece el botón Restaurar', async () => {
      open(['projects.create', 'system.backups.view'], {
        'GET /admin/backups': { status: 200, body: [generation] },
      });
      renderApp('/admin');
      await screen.findByText(new RegExp(generation.fileName));
      expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
    });
  });
});

describe('mantenimiento: purga de registros auxiliares (§111.6)', () => {
  const MAINT = [...ADMIN_PERMISSIONS, 'system.maintenance.run'];
  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    trigger: 'MANUAL',
    runBy: { id: ANA.id, name: 'Ana Pérez' },
    startedAt: '2026-06-01T12:00:00.000Z',
    finishedAt: '2026-06-01T12:00:01.000Z',
    status: 'COMPLETED',
    retentionDays: 30,
    purged: { sessions: 3, loginAttempts: 1, passwordResetTokens: 2 },
    errorMessage: null,
    ...overrides,
  });

  it('muestra el historial, con quién o qué la lanzó', async () => {
    open(MAINT, {
      'GET /admin/maintenance/runs': {
        status: 200,
        body: [run({ id: 'm2', trigger: 'SCHEDULED', runBy: null }), run({ id: 'm1' })],
      },
    });
    renderApp('/admin');
    const list = await screen.findByRole('list', { name: 'Historial de mantenimiento' });
    expect(within(list).getByText(/Automática \(diaria\)/)).toBeTruthy();
    expect(within(list).getByText(/Ana Pérez/)).toBeTruthy();
    expect(
      within(list).getAllByText('3 sesiones, 1 intentos de acceso y 2 enlaces de recuperación'),
    ).toHaveLength(2);
  });

  it('purga ahora y muestra cuánto se eliminó', async () => {
    let done = false;
    const { calls } = open(MAINT, {
      'GET /admin/maintenance/runs': () => ({ status: 200, body: done ? [run()] : [] }),
      'POST /admin/maintenance/purge': () => {
        done = true;
        return { status: 200, body: run() };
      },
    });
    renderApp('/admin');
    expect(await screen.findByText('Todavía no se ha ejecutado ninguna purga.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Purgar ahora' }));
    expect(
      await screen.findByText(
        'Purga completada: 3 sesiones, 1 intentos de acceso y 2 enlaces de recuperación.',
      ),
    ).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Historial de mantenimiento' })).toBeTruthy();
    expect(calls.filter((call) => call.path === '/admin/maintenance/purge')).toHaveLength(1);
    // No se pide contraseña: solo elimina registros auxiliares caducados.
    expect(calls.some((call) => call.path === '/auth/reauth')).toBe(false);
  });

  it('avisa si la purga falló y no se eliminó nada', async () => {
    open(MAINT, {
      'GET /admin/maintenance/runs': { status: 200, body: [] },
      'POST /admin/maintenance/purge': {
        status: 200,
        body: run({
          status: 'FAILED',
          purged: { sessions: 0, loginAttempts: 0, passwordResetTokens: 0 },
          errorMessage: 'La purga falló y no se eliminó nada. Revisa los registros del servidor.',
        }),
      },
    });
    renderApp('/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Purgar ahora' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/no se eliminó nada/)).toBeTruthy();
  });

  it('sin system.maintenance.run la sección no aparece ni consulta la API', async () => {
    const { calls } = open(ADMIN_PERMISSIONS);
    renderApp('/admin');
    await screen.findByRole('heading', { name: 'Backups' });
    expect(screen.queryByRole('heading', { name: 'Mantenimiento' })).toBeNull();
    expect(calls.some((call) => call.path.startsWith('/admin/maintenance'))).toBe(false);
  });

  it('con solo el permiso de mantenimiento la pantalla no queda vacía', async () => {
    open(['projects.create', 'system.maintenance.run'], {
      'GET /admin/maintenance/runs': { status: 200, body: [] },
    });
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Mantenimiento' })).toBeTruthy();
  });
});
