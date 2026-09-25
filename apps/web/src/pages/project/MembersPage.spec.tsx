import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANA,
  apiError,
  AUTH_STATE,
  type Handler,
  projectDetail,
  PROJECT_ID,
  renderApp,
  stubApi,
} from '../../test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

const URL = `/projects/${PROJECT_ID}`;
const MEMBERS_URL = `${URL}/members`;
const R_ADMIN = '0195f7c0-0000-7000-8000-00000000a001';
const R_COLLAB = '0195f7c0-0000-7000-8000-00000000a002';
const R_READER = '0195f7c0-0000-7000-8000-00000000a003';
const BETO = '0195f7c0-0000-7000-8000-0000000000b1';
const CARLA = '0195f7c0-0000-7000-8000-0000000000c1';

const member = (overrides: Record<string, unknown>) => ({
  userId: BETO,
  firstName: 'Beto',
  lastName: 'Vega',
  email: 'beto@example.com',
  roleId: R_COLLAB,
  roleKey: 'COLLABORATOR',
  roleName: 'Colaborador',
  isOwner: false,
  status: 'ACTIVE',
  accountStatus: 'ACTIVE',
  joinedAt: '2026-06-01T12:00:00.000Z',
  leftAt: null,
  removedAt: null,
  version: 3,
  ...overrides,
});
const OWNER = member({
  userId: ANA.id,
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@example.com',
  roleId: R_ADMIN,
  roleKey: 'PROJECT_ADMIN',
  roleName: 'Administrador de proyecto',
  isOwner: true,
  version: 1,
});
const BETO_MEMBER = member({});
const CARLA_MEMBER = member({
  userId: CARLA,
  firstName: 'Carla',
  lastName: 'Ríos',
  email: 'carla@example.com',
  roleId: R_READER,
  roleKey: 'READER',
  roleName: 'Lector',
});

const ASSIGNABLE = [
  { id: R_ADMIN, key: 'PROJECT_ADMIN', name: 'Administrador de proyecto', description: '' },
  { id: R_COLLAB, key: 'COLLABORATOR', name: 'Colaborador', description: '' },
  { id: R_READER, key: 'READER', name: 'Lector', description: '' },
];

const invitation = (overrides: Record<string, unknown> = {}) => ({
  id: '0195f7c0-0000-7000-8000-0000000000e1',
  projectId: PROJECT_ID,
  roleId: R_READER,
  roleKey: 'READER',
  roleName: 'Lector',
  status: 'ACTIVE',
  singleUse: true,
  expiresAt: '2026-06-08T12:00:00.000Z',
  restrictedEmail: null,
  createdAt: '2026-06-01T12:00:00.000Z',
  createdBy: { id: ANA.id, name: 'Ana Pérez' },
  acceptedCount: 0,
  disabledAt: null,
  ...overrides,
});

const READER_VIEW = {
  isOwner: false,
  myRole: 'READER',
  myPermissions: ['members.view', 'project.view', 'projects.create'],
};

function open(project: Record<string, unknown> = {}, extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /auth/me': AUTH_STATE,
    'GET /projects': { status: 200, body: [] },
    [`GET ${URL}`]: { status: 200, body: projectDetail(project) },
    [`GET ${MEMBERS_URL}?status=ACTIVE`]: {
      status: 200,
      body: [OWNER, BETO_MEMBER, CARLA_MEMBER],
    },
    [`GET ${URL}/assignable-roles`]: { status: 200, body: ASSIGNABLE },
    [`GET ${URL}/invitations`]: { status: 200, body: [] },
    ...extra,
  });
}

describe('miembros', () => {
  it('quien gestiona ve nombres, correos, propietario, "(tú)", roles editables y acciones', async () => {
    open();
    renderApp(MEMBERS_URL);

    const row = async (name: string) => {
      const rows = await screen.findAllByRole('row');
      return rows.find((candidate) => candidate.textContent?.includes(name))!;
    };
    const ana = await row('Ana Pérez');
    expect(within(ana).getByText('Propietario')).toBeTruthy();
    expect(within(ana).getByText('(tú)')).toBeTruthy();
    expect(within(ana).getByText('ana@example.com')).toBeTruthy();
    // El propietario no tiene selector de rol ni se puede expulsar.
    expect(within(ana).queryByRole('combobox')).toBeNull();
    expect(within(ana).queryByRole('button')).toBeNull();

    const beto = await row('Beto Vega');
    const select = within(beto).getByRole('combobox', { name: 'Rol de Beto Vega' });
    expect((select as HTMLSelectElement).value).toBe(R_COLLAB);
    expect(within(beto).getByRole('button', { name: 'Expulsar a Beto Vega' })).toBeTruthy();
  });

  it('un lector ve la lista sin correos ni acciones, y no consulta lo que no necesita', async () => {
    const { calls } = open(READER_VIEW, {
      [`GET ${MEMBERS_URL}?status=ACTIVE`]: {
        status: 200,
        body: [
          { ...OWNER, email: null },
          { ...BETO_MEMBER, email: null },
        ],
      },
    });
    renderApp(MEMBERS_URL);

    expect(await screen.findByText('Beto Vega')).toBeTruthy();
    expect(screen.queryByText('beto@example.com')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Correo' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Expulsar/ })).toBeNull();
    expect(screen.queryByLabelText('Mostrar miembros')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Invitaciones' })).toBeNull();
    // Sin permisos no se piden los roles asignables ni las invitaciones.
    expect(calls.some((c) => c.path.includes('assignable-roles'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/invitations'))).toBe(false);
  });

  describe('cambio de rol', () => {
    it('envía el rol elegido con la versión de la membresía y recarga la lista', async () => {
      let loads = 0;
      const { calls } = open(
        {},
        {
          [`GET ${MEMBERS_URL}?status=ACTIVE`]: () => {
            loads += 1;
            return { status: 200, body: [OWNER, BETO_MEMBER, CARLA_MEMBER] };
          },
          [`PATCH ${MEMBERS_URL}/${BETO}`]: { status: 200, body: member({ roleId: R_READER }) },
        },
      );
      renderApp(MEMBERS_URL);
      const select = await screen.findByRole('combobox', { name: 'Rol de Beto Vega' });
      fireEvent.change(select, { target: { value: R_READER } });

      expect(await screen.findByText('Se cambió el rol de Beto Vega.')).toBeTruthy();
      expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
        roleId: R_READER,
        version: 3,
      });
      await waitFor(() => expect(loads).toBe(2));
    });

    it('un conflicto de versión muestra el aviso y recarga la lista real', async () => {
      let loads = 0;
      open(
        {},
        {
          [`GET ${MEMBERS_URL}?status=ACTIVE`]: () => {
            loads += 1;
            return { status: 200, body: [OWNER, BETO_MEMBER] };
          },
          [`PATCH ${MEMBERS_URL}/${BETO}`]: apiError(409, 'CONCURRENCY_CONFLICT'),
        },
      );
      renderApp(MEMBERS_URL);
      fireEvent.change(await screen.findByRole('combobox', { name: 'Rol de Beto Vega' }), {
        target: { value: R_ADMIN },
      });

      expect((await screen.findByRole('alert')).textContent).toMatch(/Otra persona modificó/);
      await waitFor(() => expect(loads).toBe(2));
    });

    it('no llama a la API si se elige el mismo rol', async () => {
      const { calls } = open();
      renderApp(MEMBERS_URL);
      fireEvent.change(await screen.findByRole('combobox', { name: 'Rol de Beto Vega' }), {
        target: { value: R_COLLAB },
      });
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    });

    it('solo ofrece los roles que la persona puede asignar (sin propietario ni globales)', async () => {
      open();
      renderApp(MEMBERS_URL);
      const select = await screen.findByRole('combobox', { name: 'Rol de Beto Vega' });
      const labels = within(select)
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(labels).toEqual(['Administrador de proyecto', 'Colaborador', 'Lector']);
    });

    it('conserva visible el rol actual aunque no se pueda volver a asignar', async () => {
      open(
        {},
        {
          [`GET ${URL}/assignable-roles`]: { status: 200, body: [ASSIGNABLE[1]!, ASSIGNABLE[2]!] },
          [`GET ${MEMBERS_URL}?status=ACTIVE`]: {
            status: 200,
            body: [OWNER, member({ userId: BETO, roleId: R_ADMIN, roleKey: 'PROJECT_ADMIN' })],
          },
        },
      );
      renderApp(MEMBERS_URL);
      const select = await screen.findByRole('combobox', { name: 'Rol de Beto Vega' });
      expect((select as HTMLSelectElement).value).toBe(R_ADMIN);
      expect(within(select).getAllByRole('option')).toHaveLength(3);
    });
  });

  describe('expulsión', () => {
    it('pide confirmación, envía el motivo y actualiza la lista', async () => {
      let removed = false;
      const { calls } = open(
        {},
        {
          [`GET ${MEMBERS_URL}?status=ACTIVE`]: () => ({
            status: 200,
            body: removed ? [OWNER, CARLA_MEMBER] : [OWNER, BETO_MEMBER, CARLA_MEMBER],
          }),
          [`DELETE ${MEMBERS_URL}/${BETO}`]: () => {
            removed = true;
            return { status: 204 };
          },
        },
      );
      renderApp(MEMBERS_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Expulsar a Beto Vega' }));
      const group = screen.getByRole('group', { name: 'Expulsar a Beto Vega' });
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      fireEvent.change(within(group).getByLabelText('Motivo (opcional)'), {
        target: { value: ' Incumplió acuerdos ' },
      });
      fireEvent.click(within(group).getByRole('button', { name: 'Confirmar' }));

      expect(await screen.findByText('Beto Vega ya no es miembro del proyecto.')).toBeTruthy();
      expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({
        reason: 'Incumplió acuerdos',
      });
      await waitFor(() => expect(screen.queryByRole('cell', { name: /Beto Vega/ })).toBeNull());
    });

    it('cancelar no expulsa', async () => {
      const { calls } = open();
      renderApp(MEMBERS_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Expulsar a Carla Ríos' }));
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Expulsar a Carla Ríos' })).getByRole('button', {
          name: 'Cancelar',
        }),
      );
      expect(screen.getByRole('button', { name: 'Expulsar a Carla Ríos' })).toBeTruthy();
      expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    });

    it('muestra el mensaje de la API cuando no se puede (propietario protegido)', async () => {
      open(
        {},
        {
          [`DELETE ${MEMBERS_URL}/${BETO}`]: apiError(
            409,
            'OWNER_PROTECTED',
            'El propietario del proyecto no se puede expulsar.',
          ),
        },
      );
      renderApp(MEMBERS_URL);
      fireEvent.click(await screen.findByRole('button', { name: 'Expulsar a Beto Vega' }));
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Expulsar a Beto Vega' })).getByRole('button', {
          name: 'Confirmar',
        }),
      );
      expect((await screen.findByRole('alert')).textContent).toBe(
        'El propietario del proyecto no se puede expulsar.',
      );
    });
  });

  it('el filtro muestra a quienes salieron o fueron expulsados', async () => {
    const { calls } = open(
      {},
      {
        [`GET ${MEMBERS_URL}?status=REMOVED`]: {
          status: 200,
          body: [
            member({
              userId: CARLA,
              firstName: 'Carla',
              lastName: 'Ríos',
              status: 'REMOVED',
              removedAt: '2026-06-02T12:00:00.000Z',
            }),
          ],
        },
      },
    );
    renderApp(MEMBERS_URL);
    fireEvent.change(await screen.findByLabelText('Mostrar miembros'), {
      target: { value: 'REMOVED' },
    });

    const row = (await screen.findByText('Carla Ríos')).closest('tr')!;
    expect(within(row).getByText(/Expulsado/)).toBeTruthy();
    // Un miembro que ya no está activo no se puede editar ni expulsar de nuevo.
    expect(within(row).queryByRole('combobox')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(calls.some((c) => c.path === `${MEMBERS_URL}?status=REMOVED`)).toBe(true);
  });
});

describe('invitaciones', () => {
  const createdInvitation = {
    ...invitation(),
    token: 'T'.repeat(43),
    link: `http://localhost:5173/invite?token=${'T'.repeat(43)}`,
  };

  it('lista las invitaciones con su estado, uso, vencimiento, correo y quién las creó', async () => {
    open(
      {},
      {
        [`GET ${URL}/invitations`]: {
          status: 200,
          body: [
            invitation({ restrictedEmail: 'nueva@example.com', acceptedCount: 1 }),
            invitation({
              id: 'i2',
              status: 'EXPIRED',
              singleUse: false,
              expiresAt: null,
              roleKey: 'COLLABORATOR',
              roleName: 'Colaborador',
            }),
          ],
        },
      },
    );
    renderApp(MEMBERS_URL);
    const table = await screen.findByRole('table', { name: 'Invitaciones' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText('Vigente')).toBeTruthy();
    expect(within(rows[0]!).getByText('Un solo uso')).toBeTruthy();
    expect(within(rows[0]!).getByText('nueva@example.com')).toBeTruthy();
    expect(within(rows[0]!).getByText('Ana Pérez')).toBeTruthy();
    expect(within(rows[1]!).getByText('Vencida')).toBeTruthy();
    expect(within(rows[1]!).getByText('Reutilizable')).toBeTruthy();
    expect(within(rows[1]!).getByText('Sin vencimiento')).toBeTruthy();
    expect(within(rows[1]!).getByText('Cualquiera')).toBeTruthy();
    // Solo se puede deshabilitar una invitación vigente.
    expect(within(rows[1]!).queryByRole('button')).toBeNull();
    expect(within(rows[0]!).getByRole('button', { name: /Deshabilitar/ })).toBeTruthy();
  });

  it('la lista nunca trae ni muestra enlaces: solo se conocen al crear', async () => {
    open({}, { [`GET ${URL}/invitations`]: { status: 200, body: [invitation()] } });
    renderApp(MEMBERS_URL);
    await screen.findByRole('table', { name: 'Invitaciones' });
    expect(screen.queryByLabelText('Enlace de invitación')).toBeNull();
    expect(document.body.textContent).not.toMatch(/invite\?token=/);
  });

  describe('crear', () => {
    it('usa por defecto Lector, 7 días y un solo uso, y muestra el enlace una sola vez', async () => {
      let created = false;
      const { calls } = open(
        {},
        {
          [`GET ${URL}/invitations`]: () => ({
            status: 200,
            body: created ? [invitation()] : [],
          }),
          [`POST ${URL}/invitations`]: () => {
            created = true;
            return { status: 201, body: createdInvitation };
          },
        },
      );
      renderApp(MEMBERS_URL);
      const form = await screen.findByRole('form', { name: 'Nueva invitación' });
      await waitFor(() =>
        expect(within(form).getByLabelText<HTMLSelectElement>('Rol al ingresar').value).toBe(
          R_READER,
        ),
      );
      expect(within(form).getByLabelText<HTMLSelectElement>('Vencimiento').value).toBe('7d');
      expect(within(form).getByLabelText<HTMLInputElement>(/Un solo uso/).checked).toBe(true);
      fireEvent.click(within(form).getByRole('button', { name: 'Crear invitación' }));

      const box = await screen.findByRole('region', { name: 'Enlace de invitación' });
      expect(within(box).getByLabelText<HTMLInputElement>('Enlace de invitación').value).toBe(
        createdInvitation.link,
      );
      expect(within(box).getByText(/Se muestra una sola vez/)).toBeTruthy();
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        roleId: R_READER,
        expiry: '7d',
        singleUse: true,
        restrictedEmail: null,
      });

      // Al cerrarlo el enlace desaparece y no hay forma de recuperarlo.
      fireEvent.click(within(box).getByRole('button', { name: 'Ya lo copié' }));
      expect(screen.queryByRole('region', { name: 'Enlace de invitación' })).toBeNull();
      expect(document.body.textContent).not.toContain(createdInvitation.token);
      // La lista se actualizó con la invitación nueva, sin el enlace.
      expect(await screen.findByRole('table', { name: 'Invitaciones' })).toBeTruthy();
    });

    it('permite elegir rol, vencimiento, varios usos y restringir a un correo', async () => {
      const { calls } = open(
        {},
        { [`POST ${URL}/invitations`]: { status: 201, body: createdInvitation } },
      );
      renderApp(MEMBERS_URL);
      const form = await screen.findByRole('form', { name: 'Nueva invitación' });
      await waitFor(() =>
        expect(within(form).getByRole('option', { name: 'Colaborador' })).toBeTruthy(),
      );

      fireEvent.change(within(form).getByLabelText('Rol al ingresar'), {
        target: { value: R_COLLAB },
      });
      fireEvent.change(within(form).getByLabelText('Vencimiento'), { target: { value: 'never' } });
      fireEvent.click(within(form).getByLabelText(/Un solo uso/));
      fireEvent.change(within(form).getByLabelText('Restringir a un correo (opcional)'), {
        target: { value: '  Nueva@Ejemplo.com ' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear invitación' }));

      await screen.findByRole('region', { name: 'Enlace de invitación' });
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        roleId: R_COLLAB,
        expiry: 'never',
        singleUse: false,
        restrictedEmail: 'nueva@ejemplo.com',
      });
    });

    it('valida el correo antes de llamar a la API', async () => {
      const { calls } = open();
      renderApp(MEMBERS_URL);
      const form = await screen.findByRole('form', { name: 'Nueva invitación' });
      await waitFor(() =>
        expect(within(form).getByRole('option', { name: 'Lector' })).toBeTruthy(),
      );
      fireEvent.change(within(form).getByLabelText('Restringir a un correo (opcional)'), {
        target: { value: 'no-es-un-correo' },
      });
      fireEvent.click(within(form).getByRole('button', { name: 'Crear invitación' }));

      expect((await within(form).findByRole('alert')).textContent).toMatch(
        /no es una dirección válida/,
      );
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });

    it('muestra el error de la API (p. ej. rol fuera del límite de asignación)', async () => {
      open({}, { [`POST ${URL}/invitations`]: apiError(403, 'FORBIDDEN') });
      renderApp(MEMBERS_URL);
      const form = await screen.findByRole('form', { name: 'Nueva invitación' });
      await waitFor(() =>
        expect(within(form).getByRole('option', { name: 'Lector' })).toBeTruthy(),
      );
      fireEvent.click(within(form).getByRole('button', { name: 'Crear invitación' }));
      expect((await within(form).findByRole('alert')).textContent).toMatch(/No tienes permiso/);
      expect(screen.queryByRole('region', { name: 'Enlace de invitación' })).toBeNull();
    });

    it('en un proyecto cerrado no se ofrece crear invitaciones', async () => {
      open({ status: 'CLOSED' });
      renderApp(MEMBERS_URL);
      expect(
        await screen.findByText('Solo se pueden crear invitaciones en un proyecto activo.'),
      ).toBeTruthy();
      expect(screen.queryByRole('form', { name: 'Nueva invitación' })).toBeNull();
    });

    it('copia el enlace al portapapeles', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      open({}, { [`POST ${URL}/invitations`]: { status: 201, body: createdInvitation } });
      renderApp(MEMBERS_URL);
      const form = await screen.findByRole('form', { name: 'Nueva invitación' });
      await waitFor(() =>
        expect(within(form).getByRole('option', { name: 'Lector' })).toBeTruthy(),
      );
      fireEvent.click(within(form).getByRole('button', { name: 'Crear invitación' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Copiar enlace' }));
      expect(await screen.findByText('Enlace copiado.')).toBeTruthy();
      expect(writeText).toHaveBeenCalledWith(createdInvitation.link);
    });

    it('si el navegador no permite copiar, deja el enlace seleccionado y lo explica', async () => {
      open({}, { [`POST ${URL}/invitations`]: { status: 201, body: createdInvitation } });
      renderApp(MEMBERS_URL);
      const form = await screen.findByRole('form', { name: 'Nueva invitación' });
      await waitFor(() =>
        expect(within(form).getByRole('option', { name: 'Lector' })).toBeTruthy(),
      );
      fireEvent.click(within(form).getByRole('button', { name: 'Crear invitación' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Copiar enlace' }));
      expect((await screen.findByText(/No se pudo copiar automáticamente/)).textContent).toMatch(
        /Ctrl\+C/,
      );
    });
  });

  describe('deshabilitar', () => {
    it('pide confirmación, deshabilita y actualiza el estado', async () => {
      let disabled = false;
      const { calls } = open(
        {},
        {
          [`GET ${URL}/invitations`]: () => ({
            status: 200,
            body: [invitation({ status: disabled ? 'DISABLED' : 'ACTIVE' })],
          }),
          [`POST ${URL}/invitations/${invitation().id}/disable`]: () => {
            disabled = true;
            return { status: 200, body: invitation({ status: 'DISABLED' }) };
          },
        },
      );
      renderApp(MEMBERS_URL);
      fireEvent.click(
        await screen.findByRole('button', { name: /Deshabilitar invitación de Lector/ }),
      );
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Deshabilitar invitación' })).getByRole('button', {
          name: 'Confirmar',
        }),
      );

      expect(await screen.findByText('Deshabilitada')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Deshabilitar invitación de/ })).toBeNull();
    });

    it('cancelar no deshabilita', async () => {
      const { calls } = open(
        {},
        { [`GET ${URL}/invitations`]: { status: 200, body: [invitation()] } },
      );
      renderApp(MEMBERS_URL);
      fireEvent.click(await screen.findByRole('button', { name: /Deshabilitar invitación de/ }));
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Deshabilitar invitación' })).getByRole('button', {
          name: 'Cancelar',
        }),
      );
      expect(screen.getByRole('button', { name: /Deshabilitar invitación de/ })).toBeTruthy();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });
  });
});
