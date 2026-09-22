import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  AUTH_STATE,
  OWNER_PERMISSIONS,
  projectDetail,
  PROJECT_ID,
  renderApp,
  STAGE_ID,
  stubApi,
  type Handler,
} from '../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = `/projects/${PROJECT_ID}`;
const STAGES_URL = `${URL}/stages`;

const stage = (overrides: Record<string, unknown> = {}) => ({
  id: STAGE_ID,
  projectId: PROJECT_ID,
  name: 'Etapa 1',
  unitStake: '10.00',
  status: 'ACTIVE',
  createdAt: '2026-06-01T12:00:00.000Z',
  deletedAt: null,
  purgeEligibleAt: null,
  version: 1,
  ...overrides,
});

function open(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail() },
    [`GET ${STAGES_URL}`]: { status: 200, body: [stage()] },
    ...extra,
  });
}
const READER_VIEW = {
  isOwner: false,
  myRole: 'READER',
  myPermissions: ['project.view', 'stages.view'],
};

describe('etapas del proyecto (§11, §12, §86)', () => {
  it('lista la etapa activa con su unidad', async () => {
    open();
    renderApp(STAGES_URL);
    expect(await screen.findByText('Etapa 1')).toBeTruthy();
    expect(screen.getByText('Activa')).toBeTruthy();
    expect(screen.getByText('Unidad: S/ 10.00')).toBeTruthy();
  });

  it('sin permiso de escritura, solo se consulta', async () => {
    open({ [`GET ${URL}`]: { status: 200, body: projectDetail(READER_VIEW) } });
    renderApp(STAGES_URL);
    await screen.findByText('Etapa 1');
    expect(screen.queryByRole('button', { name: 'Nueva etapa' })).toBeNull();
    expect(screen.queryByLabelText('Ver la papelera')).toBeNull();
  });

  it('antes de completar el setup, remite a la configuración inicial', async () => {
    open({
      [`GET ${URL}`]: {
        status: 200,
        body: projectDetail({ setupComplete: false, activeStage: null }),
      },
    });
    renderApp(STAGES_URL);
    expect(
      await screen.findByRole('link', { name: /configuración inicial del proyecto/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Etapa 1')).toBeNull();
  });

  describe('crear/activar una nueva etapa', () => {
    it('cierra la anterior y activa la nueva (nombre autogenerado)', async () => {
      let created = false;
      const { calls } = open({
        [`GET ${STAGES_URL}`]: () => ({
          status: 200,
          body: created
            ? [
                stage({ status: 'CLOSED' }),
                stage({ id: 'e2', name: 'Etapa 2', unitStake: '20.00' }),
              ]
            : [stage()],
        }),
        [`POST ${STAGES_URL}`]: () => {
          created = true;
          return { status: 201, body: stage({ id: 'e2', name: 'Etapa 2', unitStake: '20.00' }) };
        },
      });
      renderApp(STAGES_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Nueva etapa' }));
      const form = screen.getByRole('form', { name: 'Nueva etapa' });
      fireEvent.change(within(form).getByLabelText('Unidad de stake'), {
        target: { value: '20.00' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear y activar' }));

      expect(await screen.findByText(/Se activó «Etapa 2»/)).toBeTruthy();
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ unitStake: '20.00' });
      expect(await screen.findByText('Etapa 2')).toBeTruthy();
    });

    it('admite un nombre personalizado', async () => {
      const { calls } = open({
        [`POST ${STAGES_URL}`]: { status: 201, body: stage({ id: 'e2', name: 'Verano' }) },
      });
      renderApp(STAGES_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Nueva etapa' }));
      const form = screen.getByRole('form', { name: 'Nueva etapa' });
      fireEvent.change(within(form).getByLabelText('Nombre (opcional)'), {
        target: { value: 'Verano' },
      });
      fireEvent.change(within(form).getByLabelText('Unidad de stake'), { target: { value: '5' } });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear y activar' }));
      await screen.findByText(/Se activó «Verano»/);
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        name: 'Verano',
        unitStake: '5.00',
      });
    });

    it('valida la unidad en el navegador', async () => {
      const { calls } = open();
      renderApp(STAGES_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Nueva etapa' }));
      const form = screen.getByRole('form', { name: 'Nueva etapa' });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear y activar' }));
      expect(await within(form).findByRole('alert')).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });
  });

  describe('corregir unidad (§12.1)', () => {
    it('pide vista previa antes de confirmar, y confirma con contraseña reciente', async () => {
      let reauthed = false;
      const { calls } = open({
        [`POST ${STAGES_URL}/${STAGE_ID}/unit`]: (call) => {
          const body = call.body as { confirm: boolean };
          if (!body.confirm) {
            return {
              status: 200,
              body: {
                currentUnitStake: '10.00',
                newUnitStake: '15.00',
                affectedBets: 0,
                impact: 'Sin apuestas.',
              },
            };
          }
          if (!reauthed) return apiError(403, 'REAUTH_REQUIRED');
          return { status: 200, body: stage({ unitStake: '15.00', version: 2 }) };
        },
        'POST /auth/reauth': () => {
          reauthed = true;
          return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
        },
      });
      renderApp(STAGES_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Corregir unidad' }));
      fireEvent.change(screen.getByLabelText('Nueva unidad'), { target: { value: '15.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ver impacto' }));

      expect(await screen.findByText(/Apuestas afectadas: 0/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar corrección' }));

      const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'mi-clave-secreta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText(/Se corrigió la unidad/)).toBeTruthy();
      const posts = calls.filter((c) => c.path === `${STAGES_URL}/${STAGE_ID}/unit`);
      expect(posts.map((c) => (c.body as { confirm: boolean }).confirm)).toEqual([
        false,
        true,
        true,
      ]);
    });
  });

  describe('papelera', () => {
    it('una etapa cerrada se puede enviar a la papelera con confirmación', async () => {
      let trashed = false;
      const { calls } = open({
        [`GET ${STAGES_URL}`]: () => ({
          status: 200,
          body: trashed ? [] : [stage({ status: 'CLOSED' })],
        }),
        [`POST ${STAGES_URL}/${STAGE_ID}/trash`]: () => {
          trashed = true;
          return { status: 200, body: { id: STAGE_ID } };
        },
      });
      renderApp(STAGES_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Enviar a la papelera' }));
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
      const group = screen.getByRole('group', { name: 'Enviar Etapa 1 a la papelera' });
      fireEvent.click(within(group).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText(/se envió a la papelera/)).toBeTruthy();
    });

    it('no se ofrece enviar a la papelera la etapa activa', async () => {
      open();
      renderApp(STAGES_URL);
      await screen.findByText('Etapa 1');
      expect(screen.queryByRole('button', { name: 'Enviar a la papelera' })).toBeNull();
    });

    it('quien puede restaurar ve la papelera y puede restaurar (con contraseña reciente)', async () => {
      const trashedStage = stage({ status: 'TRASHED', deletedAt: '2026-06-02T00:00:00.000Z' });
      let reauthed = false;
      const { calls } = open({
        [`GET ${STAGES_URL}?status=TRASHED`]: { status: 200, body: [trashedStage] },
        [`POST ${STAGES_URL}/${STAGE_ID}/restore`]: () =>
          reauthed ? { status: 200, body: { id: STAGE_ID } } : apiError(403, 'REAUTH_REQUIRED'),
        'POST /auth/reauth': () => {
          reauthed = true;
          return { status: 200, body: { reauthenticatedAt: '2026-06-01T12:00:00.000Z' } };
        },
      });
      renderApp(STAGES_URL);
      fireEvent.click(await screen.findByLabelText('Ver la papelera'));
      await screen.findByText('Etapa 1');
      expect(screen.getByText('En la papelera')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
      const dialog = await screen.findByRole('dialog', { name: 'Confirma tu contraseña' });
      fireEvent.change(within(dialog).getByLabelText('Contraseña actual'), {
        target: { value: 'mi-clave-secreta' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText(/se restauró/)).toBeTruthy();
      expect(calls.some((c) => c.path === `${STAGES_URL}/${STAGE_ID}/restore`)).toBe(true);
    });

    it('sin permiso de restaurar no se ofrece ver la papelera', async () => {
      const adminPermissions = OWNER_PERMISSIONS.filter((p) => p !== 'stages.restore');
      open({
        [`GET ${URL}`]: {
          status: 200,
          body: projectDetail({
            isOwner: false,
            myRole: 'PROJECT_ADMIN',
            myPermissions: adminPermissions,
          }),
        },
      });
      renderApp(STAGES_URL);
      await screen.findByText('Etapa 1');
      expect(screen.queryByLabelText('Ver la papelera')).toBeNull();
    });
  });

  it('muestra el error de la API', async () => {
    open({ [`GET ${STAGES_URL}`]: apiError(500, 'INTERNAL_ERROR') });
    renderApp(STAGES_URL);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
