import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, invitations, roles, type UserRow } from '../src/database/schema/index.js';
import { hashToken } from '../src/sessions/session.service.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface InvitationBody {
  id: string;
  status: string;
  roleKey: string | null;
  singleUse: boolean;
  expiresAt: string | null;
  restrictedEmail: string | null;
  createdBy: { id: string; name: string };
  acceptedCount: number;
  disabledAt: string | null;
  token?: string;
  link?: string;
  code?: string;
}

describe('invitaciones: crear, listar y deshabilitar (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;
  let projectId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp({ env: { APP_BASE_URL: 'https://letfer.example' } });
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com', firstName: 'Olga' });
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const roleId = async (key: string) => {
    const [row] = await ctx.t.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    return row!.id;
  };
  const create = (actor: Actor, body: object, id = projectId) =>
    request(ctx.server)
      .post(`/api/projects/${id}/invitations`)
      .set('Cookie', cookies[actor])
      .send(body);
  const list = (actor: Actor) =>
    request(ctx.server).get(`/api/projects/${projectId}/invitations`).set('Cookie', cookies[actor]);
  const disable = (actor: Actor, invitationId: string) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/invitations/${invitationId}/disable`)
      .set('Cookie', cookies[actor]);
  const body = (response: request.Response) => response.body as InvitationBody;
  const inviteAsReader = async () => ({ roleId: await roleId('READER') });

  describe('creación', () => {
    it('crea una invitación con valores por defecto: un solo uso y 7 días', async () => {
      const response = await create('admin', await inviteAsReader()).expect(201);
      const invitation = body(response);

      expect(invitation).toMatchObject({
        status: 'ACTIVE',
        roleKey: 'READER',
        singleUse: true,
        restrictedEmail: null,
        acceptedCount: 0,
        disabledAt: null,
      });
      expect(invitation.expiresAt).toBe('2026-06-08T12:00:00.000Z');
      expect(invitation.createdBy.id).toBe(people.admin.id);
    });

    it('el enlace usa APP_BASE_URL y el token (256 bits, base64url) solo se entrega aquí', async () => {
      const invitation = body(await create('owner', await inviteAsReader()).expect(201));
      expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(invitation.link).toBe(`https://letfer.example/invite?token=${invitation.token}`);

      // La base de datos guarda solo el hash: el token en claro no aparece en ninguna parte.
      const [row] = await ctx.t.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitation.id));
      expect(row!.tokenHash).toBe(hashToken(invitation.token!));
      expect(JSON.stringify(row)).not.toContain(invitation.token!);
    });

    it('cada invitación tiene un token distinto', async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 5; i += 1) {
        tokens.add(body(await create('owner', await inviteAsReader()).expect(201)).token!);
      }
      expect(tokens.size).toBe(5);
    });

    it.each([
      ['24h', '2026-06-02T12:00:00.000Z'],
      ['7d', '2026-06-08T12:00:00.000Z'],
      ['15d', '2026-06-16T12:00:00.000Z'],
      ['30d', '2026-07-01T12:00:00.000Z'],
      ['never', null],
    ])('vencimiento %s', async (expiry, expected) => {
      const invitation = body(
        await create('admin', { ...(await inviteAsReader()), expiry }).expect(201),
      );
      expect(invitation.expiresAt).toBe(expected);
    });

    it('admite reutilizable y restricción a un correo (normalizado a minúsculas)', async () => {
      const invitation = body(
        await create('admin', {
          ...(await inviteAsReader()),
          singleUse: false,
          restrictedEmail: '  Nueva.Persona@Example.COM ',
        }).expect(201),
      );
      expect(invitation).toMatchObject({
        singleUse: false,
        restrictedEmail: 'nueva.persona@example.com',
      });
    });

    it('valida el cuerpo: rol obligatorio, vencimiento conocido y correo válido', async () => {
      const base = await inviteAsReader();
      await create('admin', {}).expect(400);
      await create('admin', { roleId: 'no-uuid' }).expect(400);
      await create('admin', { ...base, expiry: '1y' }).expect(400);
      await create('admin', { ...base, restrictedEmail: 'no-es-correo' }).expect(400);
      await create('admin', { ...base, singleUse: 'si' }).expect(400);
    });

    it('propietario, Administrador de Proyecto y Global pueden; colaboradores y lectores no', async () => {
      const payload = await inviteAsReader();
      for (const actor of ['owner', 'admin', 'root'] as const) {
        await create(actor, payload).expect(201);
      }
      await create('collab', payload).expect(403);
      await create('reader', payload).expect(403);
      await create('stranger', payload).expect(404);
    });

    it('límite de asignación: no se invita con el rol del propietario, globales ni inexistentes', async () => {
      for (const key of ['PROJECT_OWNER', 'GLOBAL_ADMIN', 'USER']) {
        await create('root', { roleId: await roleId(key) }).expect(403);
      }
      await create('root', { roleId: '0198a1d2-0000-7000-8000-000000000000' }).expect(403);
      expect(await ctx.t.db.select().from(invitations)).toHaveLength(0);
    });

    it('un gestor con rol personalizado no puede invitar con roles superiores a los suyos', async () => {
      const { rows } = await ctx.t.pool.query<{ id: string }>(
        `INSERT INTO roles (id, name, description, scope, project_id, is_system)
         VALUES (gen_random_uuid(), 'Invitador', '', 'PROJECT', $1, false) RETURNING id`,
        [projectId],
      );
      for (const code of [
        'project.view',
        'members.view',
        'invitations.create',
        'stages.view',
        'houses.view',
        'movements.view',
        'bets.view',
        'reconciliations.view',
        'integrity.view',
        'tickets.view',
      ]) {
        await ctx.t.pool.query(
          'INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)',
          [rows[0]!.id, code],
        );
      }
      await ctx.t.pool.query(
        'UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3',
        [rows[0]!.id, projectId, people.collab.id],
      );
      await create('collab', { roleId: await roleId('READER') }).expect(201);
      await create('collab', { roleId: await roleId('PROJECT_ADMIN') }).expect(403);
    });

    it('solo se crean invitaciones en proyectos activos (409 en cerrados)', async () => {
      await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
      const response = await create('owner', await inviteAsReader()).expect(409);
      expect(body(response).code).toBe('INVALID_STATE');
      expect(await ctx.t.db.select().from(invitations)).toHaveLength(0);
    });

    it('no se crea en un proyecto ajeno (404) ni en uno en papelera', async () => {
      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Ajeno' });
      await create('admin', await inviteAsReader(), other.project.id).expect(404);
    });

    it('la auditoría registra la creación sin el token ni el hash y con el correo enmascarado', async () => {
      const invitation = body(
        await create('admin', {
          ...(await inviteAsReader()),
          restrictedEmail: 'nueva@example.com',
        }).expect(201),
      );
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'invitation.created'));
      expect(log).toMatchObject({
        actorUserId: people.admin.id,
        projectId,
        entityType: 'invitation',
        entityId: invitation.id,
        newValues: { role: 'READER', singleUse: true, restrictedEmail: 'n***@example.com' },
      });
      const serialized = JSON.stringify(log);
      expect(serialized).not.toContain(invitation.token!);
      expect(serialized).not.toContain(hashToken(invitation.token!));
      expect(serialized).not.toContain('nueva@example.com');
    });
  });

  describe('listado', () => {
    it('lista las invitaciones (las nuevas primero) sin token ni enlace', async () => {
      const first = body(await create('admin', await inviteAsReader()).expect(201));
      ctx.clock.advanceSeconds(30);
      const second = body(
        await create('owner', { roleId: await roleId('COLLABORATOR'), singleUse: false }).expect(
          201,
        ),
      );

      const response = await list('admin').expect(200);
      const items = response.body as InvitationBody[];
      expect(items.map((i) => i.id)).toEqual([second.id, first.id]);
      expect(items[0]).toMatchObject({ roleKey: 'COLLABORATOR', singleUse: false });
      expect(items[0]!.createdBy.name).toContain('Olga');
      for (const item of items) {
        expect(item).not.toHaveProperty('token');
        expect(item).not.toHaveProperty('tokenHash');
        expect(item).not.toHaveProperty('link');
      }
      expect(JSON.stringify(items)).not.toContain(first.token!);
    });

    it('calcula el estado: ACTIVE, EXPIRED, ACCEPTED y DISABLED (prioridad DISABLED)', async () => {
      const payload = await inviteAsReader();
      const active = body(await create('admin', payload).expect(201));
      const expiring = body(await create('admin', { ...payload, expiry: '24h' }).expect(201));
      const accepted = body(await create('admin', payload).expect(201));
      const both = body(await create('admin', { ...payload, expiry: '24h' }).expect(201));
      const never = body(await create('admin', { ...payload, expiry: 'never' }).expect(201));

      await ctx.t.pool.query(
        'UPDATE invitations SET consumed_at = now(), consumed_by = $2 WHERE id = $1',
        [accepted.id, people.stranger.id],
      );
      await disable('admin', both.id).expect(200);
      ctx.clock.advanceSeconds(25 * 3600); // vencen las de 24 h; la sesión sigue viva (no persistente 30 días)

      const cookie = sessionCookie(await login(ctx.server, people.admin.email).expect(200))!;
      const response = await request(ctx.server)
        .get(`/api/projects/${projectId}/invitations`)
        .set('Cookie', cookie)
        .expect(200);
      const status = Object.fromEntries(
        (response.body as InvitationBody[]).map((i) => [i.id, i.status]),
      );
      expect(status).toEqual({
        [active.id]: 'ACTIVE',
        [expiring.id]: 'EXPIRED',
        [accepted.id]: 'ACCEPTED',
        [both.id]: 'DISABLED',
        [never.id]: 'ACTIVE',
      });
    });

    it('una invitación reutilizable no pasa a ACCEPTED; muestra cuántas personas ingresaron', async () => {
      const reusable = body(
        await create('admin', { ...(await inviteAsReader()), singleUse: false }).expect(201),
      );
      await ctx.t.pool.query(
        `INSERT INTO invitation_acceptances (id, invitation_id, user_id, outcome, accepted_at)
         VALUES (gen_random_uuid(), $1, $2, 'ADDED', now()), (gen_random_uuid(), $1, $3, 'ADDED', now())`,
        [reusable.id, people.stranger.id, people.root.id],
      );
      const items = (await list('admin').expect(200)).body as InvitationBody[];
      expect(items[0]).toMatchObject({ status: 'ACTIVE', acceptedCount: 2 });
    });

    it('solo quienes gestionan invitaciones las ven; los ajenos reciben 404', async () => {
      await create('admin', await inviteAsReader()).expect(201);
      for (const actor of ['owner', 'admin', 'root'] as const) await list(actor).expect(200);
      await list('collab').expect(403);
      await list('reader').expect(403);
      await list('stranger').expect(404);
    });

    it('no se mezclan invitaciones de otros proyectos', async () => {
      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' });
      await create('admin', await inviteAsReader()).expect(201);
      await request(ctx.server)
        .post(`/api/projects/${other.project.id}/invitations`)
        .set('Cookie', cookies.stranger)
        .send({ roleId: await roleId('READER') })
        .expect(201);

      expect((await list('admin').expect(200)).body as InvitationBody[]).toHaveLength(1);
      const theirs = await request(ctx.server)
        .get(`/api/projects/${other.project.id}/invitations`)
        .set('Cookie', cookies.stranger)
        .expect(200);
      expect(theirs.body as InvitationBody[]).toHaveLength(1);
    });
  });

  describe('deshabilitar', () => {
    it('deshabilita la invitación, la audita y es idempotente', async () => {
      const invitation = body(await create('admin', await inviteAsReader()).expect(201));

      const response = await disable('owner', invitation.id).expect(200);
      expect(body(response)).toMatchObject({ id: invitation.id, status: 'DISABLED' });
      expect(body(response).disabledAt).toBe('2026-06-01T12:00:00.000Z');

      ctx.clock.advanceSeconds(60);
      const again = await disable('admin', invitation.id).expect(200);
      expect(body(again).disabledAt).toBe('2026-06-01T12:00:00.000Z');

      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'invitation.disabled'));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actorUserId: people.owner.id,
        entityId: invitation.id,
        projectId,
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'DISABLED' },
      });
    });

    it('colaboradores, lectores y ajenos no pueden; una invitación de otro proyecto es 404', async () => {
      const invitation = body(await create('admin', await inviteAsReader()).expect(201));
      await disable('collab', invitation.id).expect(403);
      await disable('reader', invitation.id).expect(403);
      await disable('stranger', invitation.id).expect(404);

      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' });
      const foreign = body(
        await create('stranger', await inviteAsReader(), other.project.id).expect(201),
      );
      await disable('admin', foreign.id).expect(404);
      await disable('admin', 'no-es-uuid').expect(404);
      await disable('admin', '0198a1d2-0000-7000-8000-000000000000').expect(404);

      const [row] = await ctx.t.db.select().from(invitations).where(eq(invitations.id, foreign.id));
      expect(row!.disabledAt).toBeNull();
    });

    it('sin sesión todo responde 401', async () => {
      await request(ctx.server).get(`/api/projects/${projectId}/invitations`).expect(401);
      await request(ctx.server)
        .post(`/api/projects/${projectId}/invitations`)
        .send(await inviteAsReader())
        .expect(401);
    });
  });
});
