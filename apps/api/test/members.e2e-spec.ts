import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MembersService } from '../src/projects/members.service.js';
import {
  auditLogs,
  projectMembers,
  roles,
  type ProjectMemberRow,
  type UserRow,
} from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface MemberBody {
  userId: string;
  firstName: string;
  email: string | null;
  roleId: string;
  roleKey: string | null;
  roleName: string;
  isOwner: boolean;
  status: string;
  version: number;
  code?: string;
}

describe('miembros del proyecto (e2e, PostgreSQL real)', () => {
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
    people.reader = await ctx.createUser({ email: 'reader@example.com', firstName: 'Rosa' });
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

  const get = (actor: Actor, path: string) =>
    request(ctx.server).get(`/api/projects/${projectId}${path}`).set('Cookie', cookies[actor]);
  const patchMember = (actor: Actor, userId: string, body: object) =>
    request(ctx.server)
      .patch(`/api/projects/${projectId}/members/${userId}`)
      .set('Cookie', cookies[actor])
      .send(body);
  const removeMember = (actor: Actor, userId: string, body: object = {}) =>
    request(ctx.server)
      .delete(`/api/projects/${projectId}/members/${userId}`)
      .set('Cookie', cookies[actor])
      .send(body);
  const leave = (actor: Actor) =>
    request(ctx.server).post(`/api/projects/${projectId}/leave`).set('Cookie', cookies[actor]);

  const roleId = async (key: string) => {
    const [row] = await ctx.t.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    return row!.id;
  };
  const membershipOf = async (user: UserRow): Promise<ProjectMemberRow> => {
    const [row] = await ctx.t.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
    return row!;
  };
  const members = async (actor: Actor, status = 'ACTIVE') =>
    (await get(actor, `/members?status=${status}`).expect(200)).body as MemberBody[];

  /** Rol personalizado del proyecto con los permisos indicados. */
  const customRole = async (name: string, permissions: string[]) => {
    const { rows } = await ctx.t.pool.query<{ id: string }>(
      `INSERT INTO roles (id, name, description, scope, project_id, is_system)
       VALUES (gen_random_uuid(), $2, '', 'PROJECT', $1, false) RETURNING id`,
      [projectId, name],
    );
    const id = rows[0]!.id;
    for (const code of permissions) {
      await ctx.t.pool.query(
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)`,
        [id, code],
      );
    }
    return id;
  };

  describe('listado', () => {
    it('todos los miembros activos lo ven; el propietario aparece primero', async () => {
      for (const actor of ['owner', 'admin', 'collab', 'reader', 'root'] as const) {
        const list = await members(actor);
        expect(list.map((m) => m.firstName)).toEqual(['Olga', 'Adela', 'Carlos', 'Rosa']);
        expect(list[0]).toMatchObject({ isOwner: true, roleKey: 'PROJECT_ADMIN' });
        expect(list.filter((m) => m.isOwner)).toHaveLength(1);
      }
      await get('stranger', '/members').expect(404);
    });

    it('los correos solo se ven con permiso para gestionar roles (§105.4)', async () => {
      for (const actor of ['owner', 'admin', 'root'] as const) {
        expect(
          (await members(actor)).every((m) => m.email !== null),
          actor,
        ).toBe(true);
      }
      for (const actor of ['collab', 'reader'] as const) {
        expect(
          (await members(actor)).every((m) => m.email === null),
          actor,
        ).toBe(true);
      }
    });

    it('quienes salieron o fueron expulsados solo los ve quien gestiona roles', async () => {
      await insertMember(ctx.t.db, {
        projectId,
        userId: (await ctx.createUser({ email: 'ex1@example.com' })).id,
        status: 'LEFT',
      });
      await insertMember(ctx.t.db, {
        projectId,
        userId: (await ctx.createUser({ email: 'ex2@example.com' })).id,
        status: 'REMOVED',
      });

      expect(await members('admin', 'LEFT')).toHaveLength(1);
      expect(await members('admin', 'REMOVED')).toHaveLength(1);
      expect(await members('admin', 'ALL')).toHaveLength(6);
      expect(await members('admin')).toHaveLength(4);
      for (const status of ['LEFT', 'REMOVED', 'ALL']) {
        await get('collab', `/members?status=${status}`).expect(403);
      }
      await get('admin', '/members?status=CUALQUIERA').expect(400);
    });

    it('un usuario de otro proyecto no ve estos miembros (aislamiento)', async () => {
      const other = await insertProject(ctx.t.db, { owner: people.stranger, name: 'Otro' });
      const response = await request(ctx.server)
        .get(`/api/projects/${other.project.id}/members`)
        .set('Cookie', cookies.stranger)
        .expect(200);
      expect((response.body as MemberBody[]).map((m) => m.userId)).toEqual([people.stranger.id]);
      await request(ctx.server)
        .get(`/api/projects/${other.project.id}/members`)
        .set('Cookie', cookies.owner)
        .expect(404);
    });
  });

  describe('roles asignables', () => {
    it('el Administrador de Proyecto puede asignar Administrador, Colaborador y Lector', async () => {
      const response = await get('admin', '/assignable-roles').expect(200);
      const keys = (response.body as { key: string | null }[]).map((r) => r.key).sort();
      expect(keys).toEqual(['COLLABORATOR', 'PROJECT_ADMIN', 'READER']);
    });

    it('nunca se ofrece el propietario ni los roles globales; incluye los personalizados del proyecto', async () => {
      const custom = await customRole('Solo lectura ampliada', ['project.view', 'members.view']);
      const response = await get('root', '/assignable-roles').expect(200);
      const list = response.body as { id: string; key: string | null; name: string }[];
      expect(list.map((r) => r.key)).not.toContain('PROJECT_OWNER');
      expect(list.map((r) => r.key)).not.toContain('GLOBAL_ADMIN');
      expect(list.map((r) => r.key)).not.toContain('USER');
      expect(list.find((r) => r.id === custom)).toMatchObject({ key: null });
    });

    it('colaboradores, lectores y ajenos no acceden', async () => {
      await get('collab', '/assignable-roles').expect(403);
      await get('reader', '/assignable-roles').expect(403);
      await get('stranger', '/assignable-roles').expect(404);
    });

    it('un rol personalizado con menos permisos solo puede asignar roles dentro de los suyos', async () => {
      const manager = await customRole('Gestor de miembros', [
        'project.view',
        'members.view',
        'members.update_role',
      ]);
      const reader = await customRole('Lector con nota', ['project.view']);
      await ctx.t.pool.query(
        `UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3`,
        [manager, projectId, people.collab.id],
      );
      const response = await get('collab', '/assignable-roles').expect(200);
      const ids = (response.body as { id: string; key: string | null }[]).map((r) => r.id);
      expect(ids).toContain(reader);
      expect(ids).toContain(manager);
      expect(ids).toContain(await roleId('READER'));
      expect(ids).toContain(await roleId('COLLABORATOR'));
      expect(ids).not.toContain(await roleId('PROJECT_ADMIN'));
    });
  });

  describe('cambio de rol', () => {
    it('el Administrador de Proyecto cambia el rol de un colaborador y queda auditado', async () => {
      const before = await membershipOf(people.collab);
      const response = await patchMember('admin', people.collab.id, {
        roleId: await roleId('READER'),
        version: before.version,
      }).expect(200);
      expect(response.body).toMatchObject({
        userId: people.collab.id,
        roleKey: 'READER',
        version: before.version + 1,
      });

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'member.role_changed')),
        );
      expect(log).toMatchObject({
        actorUserId: people.admin.id,
        entityType: 'project_member',
        entityId: before.id,
        oldValues: { role: 'COLLABORATOR' },
        newValues: { role: 'READER' },
        metadata: { memberUserId: people.collab.id },
      });
    });

    it('propietario y Administrador Global también pueden; se puede promover a Administrador', async () => {
      for (const actor of ['owner', 'root'] as const) {
        const m = await membershipOf(people.reader);
        const key = actor === 'owner' ? 'PROJECT_ADMIN' : 'READER';
        const response = await patchMember(actor, people.reader.id, {
          roleId: await roleId(key),
          version: m.version,
        }).expect(200);
        expect((response.body as MemberBody).roleKey).toBe(key);
      }
    });

    it('sin cambios de rol reales no se audita', async () => {
      const m = await membershipOf(people.collab);
      await patchMember('admin', people.collab.id, {
        roleId: await roleId('COLLABORATOR'),
        version: m.version,
      }).expect(200);
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'member.role_changed'));
      expect(logs).toHaveLength(0);
    });

    it('rechaza una versión obsoleta con 409', async () => {
      const m = await membershipOf(people.collab);
      await patchMember('admin', people.collab.id, {
        roleId: await roleId('READER'),
        version: m.version,
      }).expect(200);
      const stale = await patchMember('admin', people.collab.id, {
        roleId: await roleId('PROJECT_ADMIN'),
        version: m.version,
      }).expect(409);
      expect((stale.body as { code: string }).code).toBe('CONCURRENCY_CONFLICT');
      expect((await membershipOf(people.collab)).roleId).toBe(await roleId('READER'));
    });

    it('el propietario está protegido: nadie cambia su rol (ni el Global)', async () => {
      const m = await membershipOf(people.owner);
      for (const actor of ['admin', 'root', 'owner'] as const) {
        const response = await patchMember(actor, people.owner.id, {
          roleId: await roleId('READER'),
          version: m.version,
        }).expect(409);
        expect((response.body as { code: string }).code).toBe('OWNER_PROTECTED');
      }
      expect((await membershipOf(people.owner)).roleId).toBe(await roleId('PROJECT_ADMIN'));
    });

    it('límite de asignación: no se asignan roles del propietario, globales ni inexistentes', async () => {
      const m = await membershipOf(people.collab);
      for (const key of ['PROJECT_OWNER', 'GLOBAL_ADMIN', 'USER']) {
        await patchMember('root', people.collab.id, {
          roleId: await roleId(key),
          version: m.version,
        }).expect(403);
      }
      await patchMember('root', people.collab.id, {
        roleId: '0198a1d2-0000-7000-8000-000000000000',
        version: m.version,
      }).expect(403);
      expect((await membershipOf(people.collab)).roleId).toBe(await roleId('COLLABORATOR'));
    });

    it('no se asigna un rol personalizado de otro proyecto', async () => {
      const otherOwner = await ctx.createUser({ email: 'otro@example.com' });
      const other = await insertProject(ctx.t.db, { owner: otherOwner, name: 'Otro' });
      const { rows } = await ctx.t.pool.query<{ id: string }>(
        `INSERT INTO roles (id, name, description, scope, project_id, is_system)
         VALUES (gen_random_uuid(), 'Ajeno', '', 'PROJECT', $1, false) RETURNING id`,
        [other.project.id],
      );
      const m = await membershipOf(people.collab);
      await patchMember('admin', people.collab.id, {
        roleId: rows[0]!.id,
        version: m.version,
      }).expect(403);
    });

    it('un gestor con rol personalizado no puede ascender ni degradar por encima de sus permisos', async () => {
      const manager = await customRole('Gestor', [
        'project.view',
        'members.view',
        'members.update_role',
      ]);
      await ctx.t.pool.query(
        `UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3`,
        [manager, projectId, people.collab.id],
      );
      const reader = await membershipOf(people.reader);
      // No puede ascender a Administrador (excede sus permisos)…
      await patchMember('collab', people.reader.id, {
        roleId: await roleId('PROJECT_ADMIN'),
        version: reader.version,
      }).expect(403);
      // …ni tocar a un Administrador de Proyecto existente.
      const admin = await membershipOf(people.admin);
      await patchMember('collab', people.admin.id, {
        roleId: await roleId('READER'),
        version: admin.version,
      }).expect(403);
      // Sí puede mover a un lector a Colaborador.
      await patchMember('collab', people.reader.id, {
        roleId: await roleId('COLLABORATOR'),
        version: reader.version,
      }).expect(200);
    });

    it('colaboradores y lectores no pueden (403); ajenos reciben 404', async () => {
      const m = await membershipOf(people.reader);
      const body = { roleId: await roleId('COLLABORATOR'), version: m.version };
      await patchMember('collab', people.reader.id, body).expect(403);
      await patchMember('reader', people.reader.id, body).expect(403);
      await patchMember('stranger', people.reader.id, body).expect(404);
    });

    it('un miembro que ya no está activo o de otro proyecto responde 404; el cuerpo se valida', async () => {
      const ex = await ctx.createUser({ email: 'ex@example.com' });
      const left = await insertMember(ctx.t.db, { projectId, userId: ex.id, status: 'LEFT' });
      const body = { roleId: await roleId('READER'), version: left.version };
      await patchMember('admin', ex.id, body).expect(404);
      await patchMember('admin', people.stranger.id, body).expect(404);
      await patchMember('admin', 'no-es-uuid', body).expect(404);

      const m = await membershipOf(people.collab);
      await patchMember('admin', people.collab.id, { version: m.version }).expect(400);
      await patchMember('admin', people.collab.id, { roleId: 'x', version: m.version }).expect(400);
      await patchMember('admin', people.collab.id, { roleId: body.roleId }).expect(400);
    });
  });

  describe('expulsión', () => {
    it('el Administrador de Proyecto expulsa a un miembro: queda REMOVED, pierde el acceso y se audita', async () => {
      await removeMember('admin', people.collab.id, { reason: '  Incumplió acuerdos ' }).expect(
        204,
      );

      const row = await membershipOf(people.collab);
      expect(row).toMatchObject({
        status: 'REMOVED',
        removedBy: people.admin.id,
        removalReason: 'Incumplió acuerdos',
        leftAt: null,
      });
      expect(row.removedAt!.toISOString()).toBe('2026-06-01T12:00:00.000Z');

      // Pierde el acceso al instante y no ve el proyecto en su listado.
      await get('collab', '').expect(404);
      const mine = await request(ctx.server).get('/api/projects').set('Cookie', cookies.collab);
      expect(mine.body).toEqual([]);
      // Queda en el historial de expulsados.
      expect((await members('admin', 'REMOVED')).map((m) => m.userId)).toEqual([people.collab.id]);

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'member.removed'));
      expect(log).toMatchObject({
        actorUserId: people.admin.id,
        projectId,
        metadata: { memberUserId: people.collab.id, reason: 'Incumplió acuerdos' },
      });
    });

    it('propietario y Administrador Global también expulsan; el motivo es opcional', async () => {
      await request(ctx.server)
        .delete(`/api/projects/${projectId}/members/${people.reader.id}`)
        .set('Cookie', cookies.owner)
        .expect(204);
      await removeMember('root', people.collab.id).expect(204);
      expect((await membershipOf(people.reader)).removalReason).toBeNull();
    });

    it('el propietario no se puede expulsar y nadie se expulsa a sí mismo', async () => {
      for (const actor of ['admin', 'root'] as const) {
        const response = await removeMember(actor, people.owner.id).expect(409);
        expect((response.body as { code: string }).code).toBe('OWNER_PROTECTED');
      }
      const self = await removeMember('admin', people.admin.id).expect(409);
      expect((self.body as { code: string }).code).toBe('INVALID_STATE');
      expect((await membershipOf(people.owner)).status).toBe('ACTIVE');
      expect((await membershipOf(people.admin)).status).toBe('ACTIVE');
    });

    it('colaboradores y lectores no expulsan (403); ajenos, 404; expulsar dos veces, 404', async () => {
      await removeMember('collab', people.reader.id).expect(403);
      await removeMember('reader', people.collab.id).expect(403);
      await removeMember('stranger', people.collab.id).expect(404);

      await removeMember('admin', people.collab.id).expect(204);
      await removeMember('admin', people.collab.id).expect(404);
      await removeMember('admin', 'no-es-uuid').expect(404);
    });

    it('un gestor con rol inferior no puede expulsar a un Administrador de Proyecto', async () => {
      const manager = await customRole('Gestor', [
        'project.view',
        'members.view',
        'members.remove',
      ]);
      await ctx.t.pool.query(
        `UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3`,
        [manager, projectId, people.collab.id],
      );
      await removeMember('collab', people.admin.id).expect(403);
      await removeMember('collab', people.reader.id).expect(204);
    });

    it('dos expulsiones simultáneas: una tiene éxito y la otra recibe 404', async () => {
      const results = await Promise.all([
        removeMember('admin', people.collab.id),
        removeMember('owner', people.collab.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'member.removed'));
      expect(logs).toHaveLength(1);
    });
  });

  describe('salir del proyecto', () => {
    it('un miembro sale: queda LEFT, pierde el acceso y se audita', async () => {
      await leave('collab').expect(204);
      const row = await membershipOf(people.collab);
      expect(row).toMatchObject({ status: 'LEFT', removedAt: null });
      expect(row.leftAt!.toISOString()).toBe('2026-06-01T12:00:00.000Z');
      await get('collab', '').expect(404);

      const [log] = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'member.left'));
      expect(log).toMatchObject({ actorUserId: people.collab.id, projectId });
      expect((await members('admin', 'LEFT')).map((m) => m.userId)).toEqual([people.collab.id]);
    });

    it('también pueden salir el Administrador de Proyecto y el lector', async () => {
      await leave('admin').expect(204);
      await leave('reader').expect(204);
    });

    it('el propietario no puede salir (debe transferir antes)', async () => {
      const response = await leave('owner').expect(409);
      expect((response.body as { code: string }).code).toBe('OWNER_PROTECTED');
      expect((await membershipOf(people.owner)).status).toBe('ACTIVE');
    });

    it('un ajeno o un Administrador Global no miembro reciben 404; salir dos veces, 404', async () => {
      await leave('stranger').expect(404);
      await leave('root').expect(404);
      await leave('collab').expect(204);
      await leave('collab').expect(404);
    });
  });

  describe('reincorporación (addOrReactivate)', () => {
    const add = async (userId: string, key: string) =>
      ctx.t.db.transaction(async (tx) =>
        ctx.app.get(MembersService).addOrReactivate(tx, {
          projectId,
          userId,
          roleId: await roleId(key),
        }),
      );

    it('un usuario nuevo se añade con el rol indicado', async () => {
      const { membership, outcome } = await add(people.stranger.id, 'READER');
      expect(outcome).toBe('ADDED');
      expect(membership).toMatchObject({ status: 'ACTIVE', roleId: await roleId('READER') });
      expect((await members('admin')).map((m) => m.userId)).toContain(people.stranger.id);
    });

    it('quien salió o fue expulsado reutiliza su misma fila con el nuevo rol y datos limpios', async () => {
      for (const how of ['left', 'removed'] as const) {
        const before = await membershipOf(people.collab);
        if (how === 'left') await leave('collab').expect(204);
        else {
          await ctx.t.pool.query(
            "UPDATE project_members SET status = 'ACTIVE', left_at = NULL WHERE id = $1",
            [before.id],
          );
          await removeMember('admin', people.collab.id, { reason: 'motivo' }).expect(204);
        }
        ctx.clock.advanceSeconds(60);

        const { membership, outcome } = await add(people.collab.id, 'READER');
        expect(outcome, how).toBe('REACTIVATED');
        expect(membership).toMatchObject({
          id: before.id,
          status: 'ACTIVE',
          roleId: await roleId('READER'),
          leftAt: null,
          removedAt: null,
          removedBy: null,
          removalReason: null,
        });
        expect(membership.joinedAt.toISOString()).toBe(ctx.clock.now().toISOString());
        expect(membership.version).toBeGreaterThan(before.version);

        // Vuelve a tener acceso y sigue habiendo una única fila (historial ligado a su identidad).
        await get('collab', '').expect(200);
        const rows = await ctx.t.db
          .select()
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, people.collab.id),
            ),
          );
        expect(rows).toHaveLength(1);
        // Restablece el rol para la siguiente vuelta.
        await ctx.t.pool.query('UPDATE project_members SET role_id = $2 WHERE id = $1', [
          before.id,
          await roleId('COLLABORATOR'),
        ]);
      }
    });

    it('si ya es miembro activo no cambia nada (idempotente) y no baja ni sube su rol', async () => {
      const before = await membershipOf(people.admin);
      const { membership, outcome } = await add(people.admin.id, 'READER');
      expect(outcome).toBe('ALREADY_MEMBER');
      expect(membership.roleId).toBe(before.roleId);
      expect(await membershipOf(people.admin)).toMatchObject({ version: before.version });
    });

    it('el propietario sigue protegido por la base de datos aunque se intente degradar', async () => {
      await expect(add(people.owner.id, 'READER')).resolves.toMatchObject({
        outcome: 'ALREADY_MEMBER',
      });
      await expect(
        ctx.t.pool.query(
          'UPDATE project_members SET role_id = $2 WHERE project_id = $1 AND user_id = $3',
          [projectId, await roleId('READER'), people.owner.id],
        ),
      ).rejects.toThrow(/propietario/);
    });
  });
});
