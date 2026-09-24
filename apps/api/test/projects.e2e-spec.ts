import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { auditLogs, projectMembers, projects, roles } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

interface ProjectBody {
  id: string;
  name: string;
  description: string;
  status: string;
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  myRole: string | null;
  currency: string;
  timezone: string;
  dateFormat: string;
  version: number;
  myPermissions: string[];
  code?: string;
}

const asProject = (response: request.Response) => response.body as ProjectBody;
const asList = (response: request.Response) => response.body as ProjectBody[];

describe('proyectos: crear, listar, ver y editar (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const cookieOf = async (email: string) =>
    sessionCookie(await login(ctx.server, email).expect(200))!;

  const api = (cookie: string) => ({
    get: (path: string) => request(ctx.server).get(`/api${path}`).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      request(ctx.server).post(`/api${path}`).set('Cookie', cookie).send(body),
    patch: (path: string, body: object) =>
      request(ctx.server).patch(`/api${path}`).set('Cookie', cookie).send(body),
  });

  describe('creación (F1: cualquier usuario activo con rol USER)', () => {
    it('un usuario USER crea un proyecto y queda como propietario y Administrador de Proyecto', async () => {
      const user = await ctx.createUser({
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: 'Ríos',
      });
      const a = api(await cookieOf(user.email));

      const response = await a.post('/projects', { name: '  Mi grupo  ' }).expect(201);
      const body = asProject(response);

      expect(body).toMatchObject({
        name: 'Mi grupo',
        description: '',
        status: 'ACTIVE',
        ownerId: user.id,
        ownerName: 'Ana Ríos',
        isOwner: true,
        myRole: 'PROJECT_ADMIN',
        currency: 'PEN',
        timezone: 'America/Lima',
        dateFormat: 'DD/MM/YYYY',
        version: 1,
      });
      expect(body.myPermissions).toContain('project.reopen');
      expect(body.myPermissions).toContain('invitations.create');
      // Los permisos efectivos son la unión del rol global (projects.create) y el de proyecto.
      expect(body.myPermissions).toContain('projects.create');

      const members = await ctx.t.db
        .select({ userId: projectMembers.userId, status: projectMembers.status, role: roles.key })
        .from(projectMembers)
        .innerJoin(roles, eq(roles.id, projectMembers.roleId))
        .where(eq(projectMembers.projectId, body.id));
      expect(members).toEqual([{ userId: user.id, status: 'ACTIVE', role: 'PROJECT_ADMIN' }]);
    });

    it('acepta zona horaria y formato de fecha y rechaza valores no válidos', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const a = api(await cookieOf(user.email));

      const ok = await a
        .post('/projects', { name: 'X', timezone: 'America/Bogota', dateFormat: 'YYYY-MM-DD' })
        .expect(201);
      expect(asProject(ok)).toMatchObject({ timezone: 'America/Bogota', dateFormat: 'YYYY-MM-DD' });

      await a.post('/projects', { name: 'X', timezone: 'Marte/Olympus' }).expect(400);
      await a.post('/projects', { name: 'X', dateFormat: 'DD-MM-YY' }).expect(400);
      await a.post('/projects', { name: '   ' }).expect(400);
      await a.post('/projects', { name: 'a'.repeat(101) }).expect(400);
      await a.post('/projects', {}).expect(400);
      // La moneda no se elige: se ignora cualquier valor recibido.
      const currency = await a.post('/projects', { name: 'Y', currency: 'USD' }).expect(201);
      expect(asProject(currency).currency).toBe('PEN');
    });

    it('crea el proyecto, la membresía y la auditoría con project_id en una sola operación', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const a = api(await cookieOf(user.email));
      const { id } = asProject(await a.post('/projects', { name: 'Auditado' }).expect(201));

      const logs = await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.projectId, id));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'project.created',
        entityType: 'project',
        entityId: id,
        actorUserId: user.id,
      });
      expect(logs[0]!.newValues).toMatchObject({ name: 'Auditado', currency: 'PEN' });
    });

    it('si falla la auditoría no queda nada a medias (atomicidad)', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const a = api(await cookieOf(user.email));
      const spy = vi
        .spyOn(ctx.app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('fallo simulado de auditoría'));

      await a.post('/projects', { name: 'Fallido' }).expect(500);
      spy.mockRestore();

      expect(await ctx.t.db.select().from(projects)).toHaveLength(0);
      expect(await ctx.t.db.select().from(projectMembers)).toHaveLength(0);
      expect(
        await ctx.t.db.select().from(auditLogs).where(eq(auditLogs.entityType, 'project')),
      ).toEqual([]);
      // Y el usuario puede reintentar con normalidad.
      await a.post('/projects', { name: 'Fallido' }).expect(201);
    });

    it('rechaza caracteres de control en el nombre y la descripción (400, no 500)', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const a = api(await cookieOf(user.email));
      await a.post('/projects', { name: 'mal\u0000nombre' }).expect(400);
      await a.post('/projects', { name: 'ok', description: 'x\u0007y' }).expect(400);
      // Los saltos de línea sí son válidos en la descripción.
      await a.post('/projects', { name: 'ok', description: 'línea 1\nlínea 2' }).expect(201);
    });

    it('un usuario desactivado no puede crear proyectos y sin sesión responde 401', async () => {
      const user = await ctx.createUser({ email: 'ana@example.com' });
      const cookie = await cookieOf(user.email);
      await request(ctx.server).post('/api/projects').send({ name: 'X' }).expect(401);

      await ctx.t.pool.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [user.id]);
      await api(cookie).post('/projects', { name: 'X' }).expect(401);
      expect(await ctx.t.db.select().from(projects)).toHaveLength(0);
    });
  });

  describe('listado y aislamiento', () => {
    it('"Mis proyectos" solo muestra aquellos donde el usuario es miembro activo', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const luis = await ctx.createUser({ email: 'luis@example.com' });
      const ajeno = await ctx.createUser({ email: 'ajeno@example.com' });
      const propio = await insertProject(ctx.t.db, { owner: ana, name: 'De Ana' });
      const compartido = await insertProject(ctx.t.db, { owner: luis, name: 'De Luis' });
      await insertMember(ctx.t.db, {
        projectId: compartido.project.id,
        userId: ana.id,
        roleKey: 'COLLABORATOR',
      });
      await insertProject(ctx.t.db, { owner: luis, name: 'Privado de Luis' });
      const salido = await insertProject(ctx.t.db, { owner: luis, name: 'Ya no estoy' });
      await insertMember(ctx.t.db, {
        projectId: salido.project.id,
        userId: ana.id,
        roleKey: 'COLLABORATOR',
        status: 'LEFT',
      });
      void propio;

      const list = asList(
        await api(await cookieOf(ana.email))
          .get('/projects')
          .expect(200),
      );
      expect(list.map((p) => p.name).sort()).toEqual(['De Ana', 'De Luis']);
      const shared = list.find((p) => p.name === 'De Luis')!;
      expect(shared).toMatchObject({
        myRole: 'COLLABORATOR',
        isOwner: false,
        ownerName: expect.any(String) as string,
      });

      const none = asList(
        await api(await cookieOf(ajeno.email))
          .get('/projects')
          .expect(200),
      );
      expect(none).toEqual([]);
    });

    it('un usuario sin acceso recibe 404 (igual que un proyecto inexistente)', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const luis = await ctx.createUser({ email: 'luis@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: luis, name: 'Privado' });
      const a = api(await cookieOf(ana.email));

      const denied = await a.get(`/projects/${project.id}`).expect(404);
      const missing = await a.get('/projects/0198a1d2-0000-7000-8000-000000000000').expect(404);
      expect(denied.body).toEqual(missing.body);
      await a.patch(`/projects/${project.id}`, { name: 'Hack', version: 1 }).expect(404);
    });

    it('?scope=all solo lo puede usar el Administrador Global y lista todos los proyectos', async () => {
      const root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      await insertProject(ctx.t.db, { owner: ana, name: 'A' });
      await insertProject(ctx.t.db, { owner: ana, name: 'B' });

      await api(await cookieOf(ana.email))
        .get('/projects?scope=all')
        .expect(403);

      const rootApi = api(await cookieOf(root.email));
      expect(asList(await rootApi.get('/projects?scope=all').expect(200))).toHaveLength(2);
      // Sin `scope=all`, el Global solo ve aquellos en los que es miembro.
      expect(asList(await rootApi.get('/projects').expect(200))).toHaveLength(0);
      await rootApi.get('/projects?scope=todos').expect(400);
    });

    it('el Administrador Global ve y edita cualquier proyecto sin ser miembro', async () => {
      const root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'De Ana' });
      const r = api(await cookieOf(root.email));

      const detail = asProject(await r.get(`/projects/${project.id}`).expect(200));
      expect(detail).toMatchObject({ isOwner: false, myRole: null });
      expect(detail.myPermissions).toContain('project.update');

      const edited = await r
        .patch(`/projects/${project.id}`, { name: 'Renombrado', version: detail.version })
        .expect(200);
      expect(asProject(edited).name).toBe('Renombrado');
    });

    it('los proyectos de la papelera no aparecen en el listado ni en el detalle normal', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'Borrado' });
      await ctx.t.pool.query(
        `UPDATE projects SET status = 'TRASHED', previous_status = 'ACTIVE', deleted_at = now(),
           deleted_by = $2, purge_eligible_at = now() + interval '90 days' WHERE id = $1`,
        [project.id, ana.id],
      );
      const a = api(await cookieOf(ana.email));

      expect(asList(await a.get('/projects').expect(200))).toEqual([]);
      await a.get(`/projects/${project.id}`).expect(404);
      const trash = asList(await a.get('/projects/trash').expect(200));
      expect(trash.map((p) => p.name)).toEqual(['Borrado']);
    });

    it('la papelera propia no revela proyectos ajenos; el Global ve todas', async () => {
      const root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const luis = await ctx.createUser({ email: 'luis@example.com' });
      const pa = await insertProject(ctx.t.db, { owner: ana, name: 'De Ana' });
      const pl = await insertProject(ctx.t.db, { owner: luis, name: 'De Luis' });
      for (const p of [pa.project, pl.project]) {
        await ctx.t.pool.query(
          `UPDATE projects SET status = 'TRASHED', previous_status = 'ACTIVE', deleted_at = now(),
             deleted_by = owner_id, purge_eligible_at = now() + interval '90 days' WHERE id = $1`,
          [p.id],
        );
      }
      const own = asList(
        await api(await cookieOf(ana.email))
          .get('/projects/trash')
          .expect(200),
      );
      expect(own.map((p) => p.name)).toEqual(['De Ana']);
      const all = asList(
        await api(await cookieOf(root.email))
          .get('/projects/trash')
          .expect(200),
      );
      expect(all.map((p) => p.name).sort()).toEqual(['De Ana', 'De Luis']);
    });
  });

  describe('detalle y edición', () => {
    it('el detalle incluye los permisos efectivos según el rol', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const luis = await ctx.createUser({ email: 'luis@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'P' });
      await insertMember(ctx.t.db, { projectId: project.id, userId: luis.id, roleKey: 'READER' });

      const detail = asProject(
        await api(await cookieOf(luis.email))
          .get(`/projects/${project.id}`)
          .expect(200),
      );
      expect(detail).toMatchObject({ myRole: 'READER', isOwner: false });
      expect(detail.myPermissions).toEqual(
        [
          'bets.view',
          'houses.view',
          'integrity.view',
          'members.view',
          'movements.view',
          'project.view',
          'projects.create',
          'reconciliations.view',
          'stages.view',
          'tickets.view',
        ].sort(),
      );
    });

    it('edita nombre, descripción, zona horaria y formato, y audita el cambio campo a campo', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'Original' });
      const a = api(await cookieOf(ana.email));

      const response = await a
        .patch(`/projects/${project.id}`, {
          name: 'Nuevo nombre',
          description: 'Una descripción',
          timezone: 'America/Mexico_City',
          dateFormat: 'MM/DD/YYYY',
          version: project.version,
        })
        .expect(200);
      expect(asProject(response)).toMatchObject({
        name: 'Nuevo nombre',
        description: 'Una descripción',
        timezone: 'America/Mexico_City',
        dateFormat: 'MM/DD/YYYY',
        version: project.version + 1,
        currency: 'PEN',
      });

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, project.id), eq(auditLogs.action, 'project.updated')));
      expect(log).toBeDefined();
      expect(log!.actorUserId).toBe(ana.id);
      expect(log!.oldValues).toMatchObject({ name: 'Original', timezone: 'America/Lima' });
      expect(log!.newValues).toMatchObject({
        name: 'Nuevo nombre',
        timezone: 'America/Mexico_City',
      });
    });

    it('un cambio sin diferencias no genera auditoría', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'Igual' });
      await api(await cookieOf(ana.email))
        .patch(`/projects/${project.id}`, { name: 'Igual', version: project.version })
        .expect(200);
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, project.id), eq(auditLogs.action, 'project.updated')));
      expect(logs).toHaveLength(0);
    });

    it('rechaza una edición con versión obsoleta (409) sin modificar nada', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'V1' });
      const a = api(await cookieOf(ana.email));

      await a
        .patch(`/projects/${project.id}`, { name: 'V2', version: project.version })
        .expect(200);
      const stale = await a
        .patch(`/projects/${project.id}`, { name: 'V3', version: project.version })
        .expect(409);
      expect((stale.body as { code: string }).code).toBe('CONCURRENCY_CONFLICT');

      const [row] = await ctx.t.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row!.name).toBe('V2');
    });

    it('valida el cuerpo: exige versión, algún campo y no permite cambiar la moneda ni el propietario', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const luis = await ctx.createUser({ email: 'luis@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'P' });
      const a = api(await cookieOf(ana.email));

      await a.patch(`/projects/${project.id}`, { name: 'X' }).expect(400);
      await a.patch(`/projects/${project.id}`, { version: project.version }).expect(400);
      await a.patch(`/projects/${project.id}`, { name: '', version: project.version }).expect(400);
      await a
        .patch(`/projects/${project.id}`, { timezone: 'Nope/Nope', version: project.version })
        .expect(400);

      // Campos no permitidos: se ignoran (la moneda y el propietario no cambian).
      await a
        .patch(`/projects/${project.id}`, {
          name: 'Q',
          currency: 'USD',
          ownerId: luis.id,
          version: project.version,
        })
        .expect(200);
      const [row] = await ctx.t.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row).toMatchObject({ currency: 'PEN', ownerId: ana.id, name: 'Q' });
    });

    it('colaboradores y lectores no pueden editar (403); administradores de proyecto sí', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const admin = await ctx.createUser({ email: 'admin@example.com' });
      const colab = await ctx.createUser({ email: 'colab@example.com' });
      const lector = await ctx.createUser({ email: 'lector@example.com' });
      const { project } = await insertProject(ctx.t.db, { owner: ana, name: 'P' });
      for (const [user, roleKey] of [
        [admin, 'PROJECT_ADMIN'],
        [colab, 'COLLABORATOR'],
        [lector, 'READER'],
      ] as const) {
        await insertMember(ctx.t.db, { projectId: project.id, userId: user.id, roleKey });
      }

      const body = { name: 'Cambio', version: project.version };
      await api(await cookieOf(colab.email))
        .patch(`/projects/${project.id}`, body)
        .expect(403);
      await api(await cookieOf(lector.email))
        .patch(`/projects/${project.id}`, body)
        .expect(403);
      await api(await cookieOf(admin.email))
        .patch(`/projects/${project.id}`, body)
        .expect(200);
    });

    it('un identificador que no es UUID responde 404', async () => {
      const ana = await ctx.createUser({ email: 'ana@example.com' });
      const a = api(await cookieOf(ana.email));
      await a.get('/projects/no-es-un-uuid').expect(404);
    });
  });
});
