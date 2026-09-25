import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import {
  auditLogs,
  projectMembers,
  projects,
  roles,
  type UserRow,
} from '../src/database/schema/index.js';
import {
  bodyOf,
  createTestApp,
  login,
  sessionCookie,
  TEST_PASSWORD,
  type TestApp,
} from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface ProjectBody {
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  myRole: string | null;
  version: number;
  code: string;
}

describe('transferencia de la propiedad del proyecto (e2e, PostgreSQL real)', () => {
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
    people.admin = await ctx.createUser({ email: 'admin@example.com', firstName: 'Adela' });
    people.collab = await ctx.createUser({ email: 'collab@example.com', firstName: 'Carlos' });
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

  const transfer = (actor: Actor, newOwnerId: string | object) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/transfer-ownership`)
      .set('Cookie', cookies[actor])
      .send(typeof newOwnerId === 'string' ? { newOwnerId } : newOwnerId);
  const post = (actor: Actor, path: string, body: object = {}) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}${path}`)
      .set('Cookie', cookies[actor])
      .send(body);

  const roleKeyOf = async (user: UserRow) => {
    const [row] = await ctx.t.db
      .select({ key: roles.key, status: projectMembers.status })
      .from(projectMembers)
      .innerJoin(roles, eq(roles.id, projectMembers.roleId))
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
    return row ? `${row.key}/${row.status}` : null;
  };
  const projectRow = async () => {
    const [row] = await ctx.t.db.select().from(projects).where(eq(projects.id, projectId));
    return row!;
  };
  const audits = (action: string) =>
    ctx.t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, action)));

  describe('quién puede (F4)', () => {
    it('solo el Administrador Global; ni el propietario ni el Administrador de Proyecto', async () => {
      for (const actor of ['owner', 'admin', 'collab', 'reader'] as const) {
        const response = await transfer(actor, people.collab.id).expect(403);
        expect(bodyOf(response).code).toBe('FORBIDDEN');
      }
      await transfer('stranger', people.collab.id).expect(404);
      await request(ctx.server)
        .post(`/api/projects/${projectId}/transfer-ownership`)
        .send({ newOwnerId: people.collab.id })
        .expect(401);
      expect((await projectRow()).ownerId).toBe(people.owner.id);

      await transfer('root', people.collab.id).expect(200);
      expect((await projectRow()).ownerId).toBe(people.collab.id);
    });

    it('exige reautenticación reciente', async () => {
      ctx.clock.advanceSeconds(6 * 60);
      const denied = await transfer('root', people.collab.id).expect(403);
      expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');
      expect((await projectRow()).ownerId).toBe(people.owner.id);

      await request(ctx.server)
        .post('/api/auth/reauth')
        .set('Cookie', cookies.root)
        .send({ password: TEST_PASSWORD })
        .expect(200);
      await transfer('root', people.collab.id).expect(200);
    });
  });

  describe('efectos', () => {
    it('el nuevo propietario pasa a Administrador de Proyecto y el anterior conserva su membresía', async () => {
      const response = await transfer('root', people.collab.id).expect(200);
      const body = response.body as ProjectBody;
      expect(body).toMatchObject({ ownerId: people.collab.id, ownerName: 'Carlos Pérez' });
      expect(body.version).toBe(2);

      expect((await projectRow()).ownerId).toBe(people.collab.id);
      expect(await roleKeyOf(people.collab)).toBe('PROJECT_ADMIN/ACTIVE');
      // Propietario anterior: sigue siendo Administrador de Proyecto activo.
      expect(await roleKeyOf(people.owner)).toBe('PROJECT_ADMIN/ACTIVE');
    });

    it('si el nuevo propietario ya era Administrador de Proyecto no cambia su rol ni audita un cambio de rol', async () => {
      await transfer('root', people.admin.id).expect(200);
      expect((await projectRow()).ownerId).toBe(people.admin.id);
      expect(await audits('member.role_changed')).toHaveLength(0);
      expect(await audits('project.ownership_transferred')).toHaveLength(1);
    });

    it('audita la transferencia y el ascenso con el actor, el propietario anterior y el nuevo', async () => {
      await transfer('root', people.reader.id).expect(200);

      const [log] = await audits('project.ownership_transferred');
      expect(log).toMatchObject({
        actorUserId: people.root.id,
        entityType: 'project',
        entityId: projectId,
        oldValues: { ownerId: people.owner.id },
        newValues: { ownerId: people.reader.id },
        metadata: { newOwnerPreviousRole: 'READER' },
      });
      const [promotion] = await audits('member.role_changed');
      expect(promotion).toMatchObject({
        actorUserId: people.root.id,
        oldValues: { role: 'READER' },
        newValues: { role: 'PROJECT_ADMIN' },
        metadata: { memberUserId: people.reader.id, reason: 'ownership_transfer' },
      });
    });

    it('los permisos cambian: el anterior pierde los de propietario y el nuevo los gana', async () => {
      await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
      await transfer('root', people.collab.id).expect(200);

      // Reabrir es de propietario/Global: el anterior (ahora solo Administrador) ya no puede.
      const denied = await post('owner', '/reopen').expect(403);
      expect(bodyOf(denied).code).toBe('FORBIDDEN');
      // El nuevo propietario sí (con su sesión anterior: los permisos se evalúan en cada petición).
      await post('collab', '/reopen').expect(200);
      // Y verlo como propietario.
      const detail = await request(ctx.server)
        .get(`/api/projects/${projectId}`)
        .set('Cookie', cookies.collab)
        .expect(200);
      expect(detail.body).toMatchObject({ isOwner: true, myRole: 'PROJECT_ADMIN' });
      const former = await request(ctx.server)
        .get(`/api/projects/${projectId}`)
        .set('Cookie', cookies.owner)
        .expect(200);
      expect(former.body).toMatchObject({ isOwner: false, myRole: 'PROJECT_ADMIN' });
    });

    it('el propietario anterior ahora puede salir; el nuevo queda protegido', async () => {
      await request(ctx.server)
        .post(`/api/projects/${projectId}/leave`)
        .set('Cookie', cookies.owner)
        .expect(409); // aún es el propietario

      await transfer('root', people.collab.id).expect(200);
      await request(ctx.server)
        .post(`/api/projects/${projectId}/leave`)
        .set('Cookie', cookies.owner)
        .expect(204);
      expect(await roleKeyOf(people.owner)).toBe('PROJECT_ADMIN/LEFT');

      const leave = await request(ctx.server)
        .post(`/api/projects/${projectId}/leave`)
        .set('Cookie', cookies.collab)
        .expect(409);
      expect(bodyOf(leave).code).toBe('OWNER_PROTECTED');
      const expel = await request(ctx.server)
        .delete(`/api/projects/${projectId}/members/${people.collab.id}`)
        .set('Cookie', cookies.admin)
        .send({})
        .expect(409);
      expect(bodyOf(expel).code).toBe('OWNER_PROTECTED');
    });

    it('funciona en un proyecto cerrado y devuelve el estado sin cambiarlo', async () => {
      await ctx.t.pool.query("UPDATE projects SET status = 'CLOSED' WHERE id = $1", [projectId]);
      await transfer('root', people.admin.id).expect(200);
      expect((await projectRow()).status).toBe('CLOSED');
    });

    it('un proyecto en la papelera solo lo transfiere quien puede restaurarlo (Fase 8, §111.3)', async () => {
      // Antes (Fase 2) respondía 404 para todos. Desde la Fase 8 el Administrador Global sí puede,
      // porque si no, la protección de D8-6 dejaría atrapada la cuenta de quien posee un proyecto
      // en la papelera. Quien no puede restaurarlo sigue recibiendo 404.
      await ctx.t.pool.query(
        `UPDATE projects SET status = 'TRASHED', previous_status = 'ACTIVE', deleted_at = now(),
           deleted_by = owner_id, purge_eligible_at = now() + interval '90 days' WHERE id = $1`,
        [projectId],
      );
      await transfer('admin', people.admin.id).expect(404);
      await transfer('collab', people.admin.id).expect(404);
      await transfer('stranger', people.admin.id).expect(404);
      expect((await projectRow()).ownerId).toBe(people.owner.id);

      const response = await transfer('root', people.admin.id).expect(200);
      expect(response.body).toMatchObject({ ownerId: people.admin.id, status: 'TRASHED' });
      expect((await projectRow()).status).toBe('TRASHED'); // la papelera no se altera
    });
  });

  describe('destinatarios no válidos', () => {
    it('debe ser miembro activo: ajenos, los que salieron y los expulsados dan 409', async () => {
      const left = await ctx.createUser({ email: 'left@example.com' });
      const removed = await ctx.createUser({ email: 'removed@example.com' });
      await insertMember(ctx.t.db, { projectId, userId: left.id, status: 'LEFT' });
      await insertMember(ctx.t.db, { projectId, userId: removed.id, status: 'REMOVED' });

      for (const target of [people.stranger.id, left.id, removed.id, people.root.id]) {
        const response = await transfer('root', target).expect(409);
        expect(bodyOf(response).code).toBe('INVALID_STATE');
      }
      expect(
        (await transfer('root', '0198a1d2-0000-7000-8000-000000000000').expect(409)).body,
      ).toMatchObject({ code: 'INVALID_STATE' });
      expect((await projectRow()).ownerId).toBe(people.owner.id);
    });

    it('no se transfiere a quien ya es propietario ni a una cuenta desactivada', async () => {
      const same = await transfer('root', people.owner.id).expect(409);
      expect(bodyOf(same).code).toBe('INVALID_STATE');

      await ctx.t.pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [
        people.collab.id,
      ]);
      await transfer('root', people.collab.id).expect(409);
      expect((await projectRow()).ownerId).toBe(people.owner.id);
      expect(await audits('project.ownership_transferred')).toHaveLength(0);
    });

    it('valida el cuerpo', async () => {
      await transfer('root', {}).expect(400);
      await transfer('root', { newOwnerId: 'no-uuid' }).expect(400);
      await transfer('root', { newOwnerId: 5 }).expect(400);
    });
  });

  describe('integridad', () => {
    it('es atómica: si falla la auditoría no cambia el propietario ni el rol', async () => {
      const spy = vi
        .spyOn(ctx.app.get(AuditService), 'record')
        .mockRejectedValue(new Error('fallo simulado de auditoría'));
      await transfer('root', people.reader.id).expect(500);
      spy.mockRestore();

      expect((await projectRow()).ownerId).toBe(people.owner.id);
      expect(await roleKeyOf(people.reader)).toBe('READER/ACTIVE');
      expect((await projectRow()).version).toBe(1);
    });

    it('dos transferencias simultáneas al mismo destinatario: una se aplica y la otra recibe 409', async () => {
      const results = await Promise.all([
        transfer('root', people.collab.id),
        transfer('root', people.collab.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await audits('project.ownership_transferred')).toHaveLength(1);
    });

    it('transferencias simultáneas a personas distintas dejan un único propietario válido', async () => {
      const results = await Promise.all([
        transfer('root', people.collab.id),
        transfer('root', people.admin.id),
      ]);
      expect(results.every((r) => r.status === 200)).toBe(true);

      const project = await projectRow();
      expect([people.collab.id, people.admin.id]).toContain(project.ownerId);
      // Invariante: el propietario es siempre un Administrador de Proyecto activo.
      const owner = Object.values(people).find((u) => u.id === project.ownerId)!;
      expect(await roleKeyOf(owner)).toBe('PROJECT_ADMIN/ACTIVE');
    });

    it('cadena de transferencias: cada propietario conserva su membresía activa como administrador', async () => {
      await transfer('root', people.collab.id).expect(200);
      await transfer('root', people.reader.id).expect(200);
      await transfer('root', people.owner.id).expect(200);

      expect((await projectRow()).ownerId).toBe(people.owner.id);
      for (const user of [people.owner, people.collab, people.reader]) {
        expect(await roleKeyOf(user)).toBe('PROJECT_ADMIN/ACTIVE');
      }
      expect(await audits('project.ownership_transferred')).toHaveLength(3);
    });
  });
});
