import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  invitationAcceptances,
  invitations,
  projectMembers,
  roles,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'newbie' | 'other' | 'third';

interface Body {
  id: string;
  token: string;
  status: string;
  code: string;
  message: string;
  outcome: string;
  projectId: string;
  projectName: string;
  roleName: string;
  invitedBy: string;
  singleUse: boolean;
  restrictedEmailHint: string | null;
  acceptedCount: number;
}

describe('invitaciones: vista previa, aceptar y rechazar (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;
  let projectId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com', firstName: 'Olga' });
    people.admin = await ctx.createUser({
      email: 'admin@example.com',
      firstName: 'Adela',
      lastName: 'Vega',
    });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.newbie = await ctx.createUser({ email: 'newbie@example.com' });
    people.other = await ctx.createUser({ email: 'other@example.com' });
    people.third = await ctx.createUser({ email: 'third@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner: people.owner, name: 'Grupo Norte' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const roleId = async (key: string) => {
    const [row] = await ctx.t.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    return row!.id;
  };

  /** Crea una invitación por la API y devuelve su token e id. */
  const invite = async (
    options: {
      by?: Actor;
      role?: string;
      singleUse?: boolean;
      expiry?: string;
      restrictedEmail?: string;
    } = {},
  ) => {
    const response = await request(ctx.server)
      .post(`/api/projects/${projectId}/invitations`)
      .set('Cookie', cookies[options.by ?? 'admin'])
      .send({
        roleId: await roleId(options.role ?? 'READER'),
        singleUse: options.singleUse ?? true,
        expiry: options.expiry ?? '7d',
        ...(options.restrictedEmail ? { restrictedEmail: options.restrictedEmail } : {}),
      })
      .expect(201);
    const body = response.body as Body;
    return { token: body.token, id: body.id };
  };

  const preview = (token: string) =>
    request(ctx.server).post('/api/invitations/preview').send({ token });
  const accept = (actor: Actor, token: string) =>
    request(ctx.server)
      .post('/api/invitations/accept')
      .set('Cookie', cookies[actor])
      .send({ token });
  const reject = (actor: Actor, token: string) =>
    request(ctx.server)
      .post('/api/invitations/reject')
      .set('Cookie', cookies[actor])
      .send({ token });

  const membershipOf = async (user: UserRow) => {
    const [row] = await ctx.t.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
    return row;
  };
  const invitationRow = async (id: string) => {
    const [row] = await ctx.t.db.select().from(invitations).where(eq(invitations.id, id));
    return row!;
  };
  const countAudit = async (action: string) =>
    (await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.action, action))).length;
  const acceptances = async () => ctx.t.db.select().from(invitationAcceptances);

  describe('vista previa (pública)', () => {
    it('muestra proyecto, rol y quién invitó, sin necesidad de sesión', async () => {
      const { token } = await invite({ by: 'admin', role: 'COLLABORATOR' });
      const response = await preview(token).expect(200);
      expect(response.body).toEqual({
        projectName: 'Grupo Norte',
        roleName: 'Colaborador',
        invitedBy: 'Adela Vega',
        expiresAt: '2026-06-08T12:00:00.000Z',
        singleUse: true,
        restrictedEmailHint: null,
      });
      // No expone identificadores ni datos internos.
      expect(JSON.stringify(response.body)).not.toContain(projectId);
    });

    it('enmascara el correo al que está restringida', async () => {
      const { token } = await invite({ restrictedEmail: 'Invitada@Example.com' });
      const response = await preview(token).expect(200);
      expect((response.body as Body).restrictedEmailHint).toBe('i***@example.com');
      expect(JSON.stringify(response.body)).not.toContain('invitada@example.com');
    });

    it('todos los enlaces inválidos responden exactamente igual (INVALID_TOKEN)', async () => {
      const responses: request.Response[] = [];
      const disabled = await invite();
      await request(ctx.server)
        .post(`/api/projects/${projectId}/invitations/${disabled.id}/disable`)
        .set('Cookie', cookies.admin)
        .expect(200);
      const consumed = await invite();
      await ctx.t.pool.query(
        'UPDATE invitations SET consumed_at = now(), consumed_by = $2 WHERE id = $1',
        [consumed.id, people.other.id],
      );
      const expiring = await invite({ expiry: '24h' });

      responses.push(await preview(disabled.token));
      responses.push(await preview(consumed.token));
      responses.push(await preview('A'.repeat(43))); // formato válido pero inexistente
      responses.push(await preview('corto'));
      responses.push(await preview(''));
      ctx.clock.advanceSeconds(25 * 3600);
      responses.push(await preview(expiring.token));

      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(response.body).toEqual(responses[0]!.body);
      }
      expect((responses[0]!.body as Body).code).toBe('INVALID_TOKEN');
    });

    it('deja de ser válida si el proyecto no está activo (cerrado o en papelera)', async () => {
      const { token } = await invite();
      await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
      expect((await preview(token).expect(400)).body).toMatchObject({ code: 'INVALID_TOKEN' });

      await ctx.t.pool.query(
        `UPDATE projects SET status = 'TRASHED', previous_status = 'ACTIVE', deleted_at = now(),
           deleted_by = owner_id, purge_eligible_at = now() + interval '90 days' WHERE id = $1`,
        [projectId],
      );
      await preview(token).expect(400);
    });

    it('deja de ser válida si su creador ya no está autorizado (§105.7)', async () => {
      // Creador degradado a Colaborador.
      const demoted = await invite({ by: 'admin' });
      await ctx.t.pool.query(
        'UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3',
        [await roleId('COLLABORATOR'), projectId, people.admin.id],
      );
      await preview(demoted.token).expect(400);
      // Recupera su rol: vuelve a ser válida (la invitación no se destruyó).
      await ctx.t.pool.query(
        'UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3',
        [await roleId('PROJECT_ADMIN'), projectId, people.admin.id],
      );
      await preview(demoted.token).expect(200);

      // Creador expulsado.
      await ctx.t.pool.query(
        `UPDATE project_members SET status = 'REMOVED', removed_at = now() WHERE project_id = $1 AND user_id = $2`,
        [projectId, people.admin.id],
      );
      await preview(demoted.token).expect(400);
    });

    it('deja de ser válida si el creador está desactivado', async () => {
      const { token } = await invite({ by: 'admin' });
      await ctx.t.pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [
        people.admin.id,
      ]);
      await preview(token).expect(400);
    });

    it('una invitación creada por el Administrador Global (sin ser miembro) es válida', async () => {
      const { token } = await invite({ by: 'root' });
      expect((await preview(token).expect(200)).body).toMatchObject({ projectName: 'Grupo Norte' });
    });

    it('valida el cuerpo', async () => {
      await request(ctx.server).post('/api/invitations/preview').send({}).expect(400);
      await request(ctx.server).post('/api/invitations/preview').send({ token: 5 }).expect(400);
    });
  });

  describe('aceptar', () => {
    it('incorpora al usuario con el rol de la invitación, la consume y la audita', async () => {
      const { token, id } = await invite({ role: 'COLLABORATOR' });
      const response = await accept('newbie', token).expect(200);
      expect(response.body).toEqual({
        projectId,
        projectName: 'Grupo Norte',
        roleName: 'Colaborador',
        outcome: 'ADDED',
      });

      const membership = await membershipOf(people.newbie);
      expect(membership).toMatchObject({
        status: 'ACTIVE',
        roleId: await roleId('COLLABORATOR'),
      });
      expect(membership!.joinedAt.toISOString()).toBe('2026-06-01T12:00:00.000Z');

      const row = await invitationRow(id);
      expect(row).toMatchObject({ consumedBy: people.newbie.id });
      expect(await acceptances()).toMatchObject([
        { invitationId: id, userId: people.newbie.id, outcome: 'ADDED' },
      ]);

      // Ya ve el proyecto en su listado.
      const mine = await request(ctx.server).get('/api/projects').set('Cookie', cookies.newbie);
      expect((mine.body as { id: string; myRole: string }[]).map((p) => [p.id, p.myRole])).toEqual([
        [projectId, 'COLLABORATOR'],
      ]);

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'invitation.accepted'));
      expect(log).toMatchObject({
        actorUserId: people.newbie.id,
        projectId,
        entityId: id,
        newValues: { outcome: 'ADDED', role: 'COLLABORATOR' },
      });
    });

    it('se puede ingresar como Administrador de Proyecto si quien invita puede asignarlo', async () => {
      const { token } = await invite({ by: 'owner', role: 'PROJECT_ADMIN' });
      await accept('newbie', token).expect(200);
      expect((await membershipOf(people.newbie))!.roleId).toBe(await roleId('PROJECT_ADMIN'));
    });

    it('una invitación de un solo uso no admite a una segunda persona', async () => {
      const { token, id } = await invite({ singleUse: true });
      await accept('newbie', token).expect(200);
      const second = await accept('other', token).expect(400);
      expect((second.body as Body).code).toBe('INVALID_TOKEN');
      expect(await membershipOf(people.other)).toBeUndefined();
      expect((await acceptances()).length).toBe(1);
      // Y en la vista previa ya figura como no válida.
      await preview(token).expect(400);
      const list = await request(ctx.server)
        .get(`/api/projects/${projectId}/invitations`)
        .set('Cookie', cookies.admin);
      expect((list.body as Body[]).find((i) => i.id === id)!.status).toBe('ACCEPTED');
    });

    it('una invitación reutilizable admite a varias personas y sigue activa', async () => {
      const { token, id } = await invite({ singleUse: false });
      await accept('newbie', token).expect(200);
      await accept('other', token).expect(200);
      await accept('third', token).expect(200);

      const list = await request(ctx.server)
        .get(`/api/projects/${projectId}/invitations`)
        .set('Cookie', cookies.admin);
      expect((list.body as Body[]).find((i) => i.id === id)).toMatchObject({
        status: 'ACTIVE',
        acceptedCount: 3,
      });
      expect((await invitationRow(id)).consumedAt).toBeNull();
    });

    it('es idempotente: repetir la aceptación no duplica ni cambia nada', async () => {
      const { token, id } = await invite({ singleUse: true });
      await accept('newbie', token).expect(200);
      const before = await membershipOf(people.newbie);
      const auditBefore = await countAudit('invitation.accepted');

      const again = await accept('newbie', token).expect(200);
      expect((again.body as Body).outcome).toBe('ALREADY_MEMBER');
      expect(await membershipOf(people.newbie)).toEqual(before);
      expect(await countAudit('invitation.accepted')).toBe(auditBefore);
      expect((await acceptances()).filter((a) => a.invitationId === id)).toHaveLength(1);
    });

    it('quien ya es miembro activo no cambia de rol ni consume la invitación', async () => {
      const { token, id } = await invite({ role: 'READER', singleUse: true });
      const before = await membershipOf(people.collab);

      const response = await accept('collab', token).expect(200);
      expect((response.body as Body).outcome).toBe('ALREADY_MEMBER');
      expect(await membershipOf(people.collab)).toEqual(before);
      expect((await membershipOf(people.collab))!.roleId).toBe(await roleId('COLLABORATOR'));
      expect((await invitationRow(id)).consumedAt).toBeNull();
      expect(await acceptances()).toHaveLength(0);
      // Otra persona aún puede usar el enlace.
      await accept('newbie', token).expect(200);
    });

    it('el propietario que acepta un enlace de su propio proyecto no se degrada', async () => {
      const { token } = await invite({ role: 'READER' });
      const response = await accept('owner', token).expect(200);
      expect((response.body as Body).outcome).toBe('ALREADY_MEMBER');
      expect((await membershipOf(people.owner))!.roleId).toBe(await roleId('PROJECT_ADMIN'));
    });

    it('quien salió vuelve con una invitación nueva reutilizando su membresía', async () => {
      const original = await membershipOf(people.collab);
      await request(ctx.server)
        .post(`/api/projects/${projectId}/leave`)
        .set('Cookie', cookies.collab)
        .expect(204);

      ctx.clock.advanceSeconds(60);
      const { token } = await invite({ role: 'READER' });
      const response = await accept('collab', token).expect(200);
      expect((response.body as Body).outcome).toBe('REACTIVATED');

      const rejoined = await membershipOf(people.collab);
      expect(rejoined).toMatchObject({
        id: original!.id,
        status: 'ACTIVE',
        roleId: await roleId('READER'),
        leftAt: null,
      });
      expect(rejoined!.joinedAt.toISOString()).toBe(ctx.clock.now().toISOString());
      expect(await acceptances()).toMatchObject([
        { userId: people.collab.id, outcome: 'REACTIVATED' },
      ]);
    });

    it('un expulsado vuelve con una invitación nueva, pero no con una que ya usó', async () => {
      const reusable = await invite({ singleUse: false });
      await accept('newbie', reusable.token).expect(200);
      await request(ctx.server)
        .delete(`/api/projects/${projectId}/members/${people.newbie.id}`)
        .set('Cookie', cookies.admin)
        .send({ reason: 'prueba' })
        .expect(204);

      // El mismo enlace ya lo usó: no le devuelve el acceso por su cuenta.
      const denied = await accept('newbie', reusable.token).expect(400);
      expect((denied.body as Body).code).toBe('INVALID_TOKEN');
      expect((await membershipOf(people.newbie))!.status).toBe('REMOVED');

      // Una invitación nueva sí lo readmite.
      const fresh = await invite({ role: 'READER' });
      expect(((await accept('newbie', fresh.token).expect(200)).body as Body).outcome).toBe(
        'REACTIVATED',
      );
      expect((await membershipOf(people.newbie))!.status).toBe('ACTIVE');
    });

    it('no acepta enlaces deshabilitados, vencidos, de proyectos no activos ni de creadores no autorizados', async () => {
      const disabled = await invite();
      await request(ctx.server)
        .post(`/api/projects/${projectId}/invitations/${disabled.id}/disable`)
        .set('Cookie', cookies.admin)
        .expect(200);
      await accept('newbie', disabled.token).expect(400);

      const byAdmin = await invite({ by: 'admin' });
      await ctx.t.pool.query(
        'UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3',
        [await roleId('READER'), projectId, people.admin.id],
      );
      await accept('newbie', byAdmin.token).expect(400);

      const closedProject = await invite({ by: 'owner' });
      await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
      await accept('newbie', closedProject.token).expect(400);
      await ctx.t.pool.query("UPDATE projects SET status = 'ACTIVE' WHERE id = $1", [projectId]);

      const expiring = await invite({ by: 'owner', expiry: '24h' });
      ctx.clock.advanceSeconds(25 * 3600);
      const cookie = sessionCookie(await login(ctx.server, people.newbie.email).expect(200))!;
      await request(ctx.server)
        .post('/api/invitations/accept')
        .set('Cookie', cookie)
        .send({ token: expiring.token })
        .expect(400);

      expect(await membershipOf(people.newbie)).toBeUndefined();
      expect(await acceptances()).toHaveLength(0);
    });

    it('sin sesión responde 401 y con un token de formato inválido, 400', async () => {
      const { token } = await invite();
      await request(ctx.server).post('/api/invitations/accept').send({ token }).expect(401);
      await accept('newbie', 'no-es-un-token').expect(400);
      await accept('newbie', '').expect(400);
      await request(ctx.server)
        .post('/api/invitations/accept')
        .set('Cookie', cookies.newbie)
        .send({})
        .expect(400);
    });

    it('dos personas aceptando a la vez una invitación de un solo uso: solo una entra', async () => {
      const { token, id } = await invite({ singleUse: true });
      const results = await Promise.all([
        accept('newbie', token),
        accept('other', token),
        accept('third', token),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
      expect(await acceptances()).toHaveLength(1);
      expect((await invitationRow(id)).consumedBy).not.toBeNull();
      const active = await ctx.t.db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, 'ACTIVE')));
      expect(active).toHaveLength(4); // owner, admin, collab + 1 nueva
    });

    it('la misma persona aceptando dos veces a la vez: una membresía y una aceptación', async () => {
      const { token } = await invite({ singleUse: false });
      const results = await Promise.all([accept('newbie', token), accept('newbie', token)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(results.map((r) => (r.body as Body).outcome).sort()).toEqual([
        'ADDED',
        'ALREADY_MEMBER',
      ]);
      expect(await acceptances()).toHaveLength(1);
      const rows = await ctx.t.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, people.newbie.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe('restricción por correo (§105.7)', () => {
    it('acepta solo la cuenta con ese correo (sin distinguir mayúsculas)', async () => {
      const { token, id } = await invite({ restrictedEmail: 'NEWBIE@example.com' });
      const denied = await accept('other', token).expect(403);
      expect((denied.body as Body).code).toBe('FORBIDDEN');
      expect(await membershipOf(people.other)).toBeUndefined();
      // No se consumió: la persona correcta todavía puede usarla.
      expect((await invitationRow(id)).consumedAt).toBeNull();

      await accept('newbie', token).expect(200);
      expect(await membershipOf(people.newbie)).toBeDefined();
    });

    it('la restricción también se aplica a las cuentas que ya son miembros y al rechazar', async () => {
      const { token } = await invite({ restrictedEmail: 'newbie@example.com' });
      await accept('collab', token).expect(403);
      await reject('other', token).expect(403);
      expect(await countAudit('invitation.rejected')).toBe(0);
    });
  });

  describe('rechazar', () => {
    it('solo se audita: no consume ni deshabilita el enlace', async () => {
      const { token, id } = await invite({ singleUse: true });
      await reject('newbie', token).expect(204);

      expect(await countAudit('invitation.rejected')).toBe(1);
      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'invitation.rejected'));
      expect(log).toMatchObject({ actorUserId: people.newbie.id, projectId, entityId: id });

      const row = await invitationRow(id);
      expect(row).toMatchObject({ consumedAt: null, disabledAt: null });
      expect(await acceptances()).toHaveLength(0);
      expect(await membershipOf(people.newbie)).toBeUndefined();

      // El enlace sigue siendo válido: puede cambiar de opinión (o lo usa otra persona).
      await preview(token).expect(200);
      await accept('newbie', token).expect(200);
    });

    it('exige sesión y un enlace válido', async () => {
      const { token } = await invite();
      await request(ctx.server).post('/api/invitations/reject').send({ token }).expect(401);
      await reject('newbie', 'A'.repeat(43)).expect(400);
      await reject('newbie', 'x').expect(400);
      expect(await countAudit('invitation.rejected')).toBe(0);
    });
  });
});
