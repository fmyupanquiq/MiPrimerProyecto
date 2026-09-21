import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  invitationAcceptances,
  invitations,
  projectMembers,
  roles,
  users,
  type UserRow,
} from '../src/database/schema/index.js';
import {
  createTestApp,
  login,
  sessionCookie,
  sessionSetCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

interface AuthBody {
  user: { id: string; email: string; firstName: string; globalRole: string; status: string };
  session: { persistent: boolean };
  permissions: string[];
  code: string;
  details: { path: string; message: string }[];
  outcome: string;
  token: string;
  id: string;
}

describe('registro por invitación (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;
  let projectId: string;
  let admin: UserRow;
  let adminCookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    const owner = await ctx.createUser({ email: 'owner@example.com' });
    admin = await ctx.createUser({ email: 'admin@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner, name: 'Grupo Norte' });
    projectId = project.id;
    await insertMember(ctx.t.db, { projectId, userId: admin.id, roleKey: 'PROJECT_ADMIN' });
    adminCookie = sessionCookie(await login(ctx.server, admin.email).expect(200))!;
  });

  const invite = async (options: { singleUse?: boolean; restrictedEmail?: string } = {}) => {
    const [reader] = await ctx.t.db.select().from(roles).where(eq(roles.key, 'READER'));
    const response = await request(ctx.server)
      .post(`/api/projects/${projectId}/invitations`)
      .set('Cookie', adminCookie)
      .send({
        roleId: reader!.id,
        singleUse: options.singleUse ?? true,
        ...(options.restrictedEmail ? { restrictedEmail: options.restrictedEmail } : {}),
      })
      .expect(201);
    const body = response.body as AuthBody;
    return { token: body.token, id: body.id };
  };

  const valid = (token: string, overrides: object = {}) => ({
    token,
    firstName: 'Nora',
    lastName: 'Quispe',
    email: 'nora@example.com',
    password: 'contraseña-larga-2026',
    ...overrides,
  });
  const register = (body: object) => request(ctx.server).post('/api/auth/register').send(body);
  const userCount = async () => (await ctx.t.db.select().from(users)).length;

  it('crea la cuenta con rol global USER, abre sesión y NO acepta la invitación', async () => {
    const { token, id } = await invite();
    const usersBefore = await userCount();

    const response = await register(valid(token, { email: 'Nora@Example.COM' })).expect(201);
    const body = response.body as AuthBody;
    expect(body.user).toMatchObject({
      firstName: 'Nora',
      email: 'nora@example.com',
      globalRole: 'USER',
      status: 'ACTIVE',
    });
    expect(body.permissions).toEqual(['projects.create']);
    expect(JSON.stringify(body)).not.toContain('password');
    expect(await userCount()).toBe(usersBefore + 1);

    // Sesión abierta: cookie HttpOnly y /auth/me funciona con ella.
    expect(sessionSetCookie(response)).toMatch(/HttpOnly/i);
    const cookie = sessionCookie(response)!;
    const me = await request(ctx.server).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect((me.body as AuthBody).user.id).toBe(body.user.id);

    // No es miembro todavía y la invitación sigue intacta.
    const memberships = await ctx.t.db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, body.user.id));
    expect(memberships).toHaveLength(0);
    expect(await ctx.t.db.select().from(invitationAcceptances)).toHaveLength(0);
    const [row] = await ctx.t.db.select().from(invitations).where(eq(invitations.id, id));
    expect(row).toMatchObject({ consumedAt: null, disabledAt: null });
    const mine = await request(ctx.server).get('/api/projects').set('Cookie', cookie).expect(200);
    expect(mine.body).toEqual([]);

    // Puede iniciar sesión con su contraseña y después aceptar la invitación.
    await login(ctx.server, 'nora@example.com', 'contraseña-larga-2026').expect(200);
    const accepted = await request(ctx.server)
      .post('/api/invitations/accept')
      .set('Cookie', cookie)
      .send({ token })
      .expect(200);
    expect((accepted.body as AuthBody).outcome).toBe('ADDED');
  });

  it('audita el registro con el proyecto y la invitación, sin contraseña', async () => {
    const { token, id } = await invite();
    const body = (await register(valid(token)).expect(201)).body as AuthBody;

    const [log] = await ctx.t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.registered'));
    expect(log).toMatchObject({
      actorUserId: body.user.id,
      entityId: body.user.id,
      projectId,
      metadata: { invitationId: id },
    });
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain('contraseña-larga-2026');
    expect(serialized).not.toContain(token);
  });

  it('la contraseña se guarda con hash argon2id, nunca en claro', async () => {
    const { token } = await invite();
    await register(valid(token)).expect(201);
    const [row] = await ctx.t.db.select().from(users).where(eq(users.email, 'nora@example.com'));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row!.passwordHash).not.toContain('contraseña-larga-2026');
  });

  it('no se puede elegir el rol global ni otros campos por el cuerpo (asignación masiva)', async () => {
    const { token } = await invite();
    const response = await register(
      valid(token, { globalRole: 'GLOBAL_ADMIN', status: 'DISABLED', id: 'x' }),
    ).expect(201);
    expect((response.body as AuthBody).user).toMatchObject({
      globalRole: 'USER',
      status: 'ACTIVE',
    });
  });

  it('exige un enlace válido; todos los inválidos responden exactamente igual', async () => {
    const disabled = await invite();
    await request(ctx.server)
      .post(`/api/projects/${projectId}/invitations/${disabled.id}/disable`)
      .set('Cookie', adminCookie)
      .expect(200);

    const usersBefore = await userCount();
    const responses = [
      await register(valid(disabled.token)),
      await register(valid('A'.repeat(43))),
      await register(valid('corto')),
      await register(valid('')),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(responses[0]!.body);
    }
    expect((responses[0]!.body as AuthBody).code).toBe('INVALID_TOKEN');
    expect(await userCount()).toBe(usersBefore);
  });

  it('con una contraseña que incumple la política y un enlace inválido no se crea nada', async () => {
    const usersBefore = await userCount();
    const response = await register(valid('A'.repeat(43), { password: 'corta' }));
    expect(response.status).toBe(400);
    expect(await userCount()).toBe(usersBefore);

    // Con una contraseña que cumple el formato pero un enlace inválido, gana el error del enlace.
    const invalid = await register(valid('A'.repeat(43), { password: 'nora-y-mas-cosas-2026' }));
    expect((invalid.body as AuthBody).code).toBe('INVALID_TOKEN');
  });

  it('no permite registrarse con enlaces vencidos ni de proyectos no activos', async () => {
    const { token } = await invite();
    await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
    await register(valid(token)).expect(400);
    await ctx.t.pool.query("UPDATE projects SET status = 'ACTIVE' WHERE id = $1", [projectId]);
    await register(valid(token)).expect(201);

    const [reader] = await ctx.t.db.select().from(roles).where(eq(roles.key, 'READER'));
    const short = (
      await request(ctx.server)
        .post(`/api/projects/${projectId}/invitations`)
        .set('Cookie', adminCookie)
        .send({ roleId: reader!.id, expiry: '24h' })
        .expect(201)
    ).body as AuthBody;
    ctx.clock.advanceSeconds(25 * 3600);
    await register(valid(short.token, { email: 'otra@example.com' })).expect(400);
    expect(await ctx.t.db.select().from(users).where(eq(users.email, 'otra@example.com'))).toEqual(
      [],
    );
  });

  describe('política de contraseña y validación', () => {
    it('rechaza contraseñas cortas o que contienen la parte local del correo, sin crear la cuenta', async () => {
      const { token } = await invite();
      const usersBefore = await userCount();

      const short = await register(valid(token, { password: 'corta' })).expect(400);
      expect((short.body as AuthBody).details.some((d) => d.path === 'password')).toBe(true);

      const local = await register(valid(token, { password: 'nora-y-mas-cosas-2026' })).expect(400);
      expect((local.body as AuthBody).code).toBe('VALIDATION_FAILED');

      expect(await userCount()).toBe(usersBefore);
      // La invitación sigue disponible.
      await register(valid(token)).expect(201);
    });

    it('valida nombre, apellido, correo y contraseña obligatorios', async () => {
      const { token } = await invite();
      await register(valid(token, { firstName: '  ' })).expect(400);
      await register(valid(token, { lastName: '' })).expect(400);
      await register(valid(token, { email: 'no-es-correo' })).expect(400);
      await register({ token }).expect(400);
      await register({}).expect(400);
      await register(valid(token, { password: 'x'.repeat(200) })).expect(400);
    });
  });

  it('un correo ya registrado responde 409 EMAIL_IN_USE sin crear nada', async () => {
    const { token } = await invite();
    const usersBefore = await userCount();
    const response = await register(valid(token, { email: 'ADMIN@example.com' })).expect(409);
    expect((response.body as AuthBody).code).toBe('EMAIL_IN_USE');
    expect(await userCount()).toBe(usersBefore);
  });

  describe('restricción por correo', () => {
    it('solo se puede registrar el correo indicado (sin distinguir mayúsculas)', async () => {
      const { token } = await invite({ restrictedEmail: 'Nora@example.com' });
      const usersBefore = await userCount();

      const denied = await register(valid(token, { email: 'intrusa@example.com' })).expect(403);
      expect((denied.body as AuthBody).code).toBe('FORBIDDEN');
      expect(await userCount()).toBe(usersBefore);

      await register(valid(token, { email: 'NORA@example.com' })).expect(201);
    });
  });

  describe('uso de la invitación', () => {
    it('registrarse no consume una invitación de un solo uso: la consume quien la acepta', async () => {
      const { token } = await invite({ singleUse: true });
      const first = await register(valid(token, { email: 'uno@example.com' })).expect(201);
      // Otra persona aún puede registrarse con el mismo enlace: nadie lo ha aceptado.
      const second = await register(valid(token, { email: 'dos@example.com' })).expect(201);

      await request(ctx.server)
        .post('/api/invitations/accept')
        .set('Cookie', sessionCookie(first)!)
        .send({ token })
        .expect(200);
      // Ya aceptada: el enlace de un solo uso deja de servir, también para registrarse y aceptar.
      await register(valid(token, { email: 'tres@example.com' })).expect(400);
      await request(ctx.server)
        .post('/api/invitations/accept')
        .set('Cookie', sessionCookie(second)!)
        .send({ token })
        .expect(400);
    });

    it('con un enlace reutilizable se registran y entran varias personas', async () => {
      const { token } = await invite({ singleUse: false });
      for (const name of ['uno', 'dos', 'tres']) {
        const response = await register(valid(token, { email: `${name}@example.com` })).expect(201);
        await request(ctx.server)
          .post('/api/invitations/accept')
          .set('Cookie', sessionCookie(response)!)
          .send({ token })
          .expect(200);
      }
      const active = await ctx.t.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId));
      expect(active).toHaveLength(2 + 3); // propietario, administrador y tres nuevos
    });
  });

  it('dos registros simultáneos con el mismo correo: uno se crea y el otro recibe 409', async () => {
    const { token } = await invite({ singleUse: false });
    const results = await Promise.all([register(valid(token)), register(valid(token))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await ctx.t.db.select().from(users).where(eq(users.email, 'nora@example.com')),
    ).toHaveLength(1);
  });

  it('la cuenta registrada no tiene privilegios: no lista todos los proyectos ni ve proyectos ajenos', async () => {
    const { token } = await invite();
    const response = await register(valid(token)).expect(201);
    const cookie = sessionCookie(response)!;
    await request(ctx.server).get('/api/projects?scope=all').set('Cookie', cookie).expect(403);
    await request(ctx.server).get(`/api/projects/${projectId}`).set('Cookie', cookie).expect(404);
    // Puede crear proyectos propios (F1).
    await request(ctx.server)
      .post('/api/projects')
      .set('Cookie', cookie)
      .send({ name: 'Mío' })
      .expect(201);
  });

  it('el correo del propio registro y su contraseña permiten iniciar sesión luego', async () => {
    const { token } = await invite();
    await register(valid(token, { password: TEST_PASSWORD + '-x' })).expect(201);
    await login(ctx.server, 'nora@example.com', TEST_PASSWORD + '-x').expect(200);
    await login(ctx.server, 'nora@example.com', 'incorrecta').expect(401);
  });
});
