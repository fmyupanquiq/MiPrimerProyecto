import { Controller, Get, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthorizationService,
  type ProjectAccess,
} from '../src/authorization/authorization.service.js';
import {
  CurrentProject,
  ProjectRoute,
  RequireGlobalPermission,
} from '../src/authorization/decorators.js';
import { RequireRecentAuth } from '../src/auth/recent-auth.guard.js';
import {
  projectMembers,
  projects,
  rolePermissions,
  roles,
  users,
  type UserRow,
} from '../src/database/schema/index.js';
import { bodyOf, createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

@Controller('probe')
class ProbeController {
  @Get('create')
  @RequireGlobalPermission('projects.create')
  create() {
    return { ok: true };
  }

  @Get('list-all')
  @RequireGlobalPermission('projects.list_all')
  listAll() {
    return { ok: true };
  }

  @Get('projects/:projectId/view')
  @ProjectRoute('project.view')
  view(@CurrentProject() access: ProjectAccess) {
    return {
      roleKey: access.roleKey,
      isOwner: access.isOwner,
      permissions: [...access.permissions].sort(),
    };
  }

  @Get('projects/:projectId/update')
  @ProjectRoute('project.update')
  update() {
    return { ok: true };
  }

  @Get('projects/:projectId/reopen')
  @ProjectRoute('project.reopen')
  reopen() {
    return { ok: true };
  }

  @Get('projects/:projectId/restore')
  @ProjectRoute('project.restore', { allowTrashed: true })
  restore() {
    return { ok: true };
  }

  @Post('projects/:projectId/sensitive')
  @ProjectRoute('project.close')
  @RequireRecentAuth()
  sensitive() {
    return { ok: true };
  }
}

type Actor =
  | 'globalAdmin'
  | 'owner'
  | 'projectAdmin'
  | 'collaborator'
  | 'reader'
  | 'stranger'
  | 'removed'
  | 'left';

describe('autorización: matriz de roles y aislamiento (e2e, PostgreSQL real)', () => {
  let ctx: TestApp;
  let projectId: string;
  const users_: Partial<Record<Actor, UserRow>> = {};
  const cookies: Partial<Record<Actor, string>> = {};

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [ProbeController] });
  });
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
    const globalAdmin = await ctx.createUser({
      email: 'root@example.com',
      globalRole: 'GLOBAL_ADMIN',
    });
    const owner = await ctx.createUser({ email: 'owner@example.com' });
    const { project } = await insertProject(ctx.t.db, { owner, name: 'P' });
    projectId = project.id;

    const make = async (actor: Actor, roleKey: string, status?: 'ACTIVE' | 'LEFT' | 'REMOVED') => {
      const user = await ctx.createUser({ email: `${actor.toLowerCase()}@example.com` });
      await insertMember(ctx.t.db, { projectId, userId: user.id, roleKey, status });
      users_[actor] = user;
    };
    await make('projectAdmin', 'PROJECT_ADMIN');
    await make('collaborator', 'COLLABORATOR');
    await make('reader', 'READER');
    await make('removed', 'COLLABORATOR', 'REMOVED');
    await make('left', 'COLLABORATOR', 'LEFT');
    users_.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    users_.owner = owner;
    users_.globalAdmin = globalAdmin;

    for (const [actor, user] of Object.entries(users_)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const get = (actor: Actor | null, path: string) => {
    const req = request(ctx.server).get(`/api/probe${path}`);
    return actor ? req.set('Cookie', cookies[actor]!) : req;
  };

  describe('permisos globales', () => {
    it('F1: cualquier usuario con rol USER puede crear proyectos (projects.create)', async () => {
      for (const actor of [
        'owner',
        'projectAdmin',
        'collaborator',
        'reader',
        'stranger',
        'globalAdmin',
      ] as const) {
        await get(actor, '/create').expect(200);
      }
    });

    it('solo el Administrador Global puede listar todos los proyectos (projects.list_all)', async () => {
      await get('globalAdmin', '/list-all').expect(200);
      for (const actor of ['owner', 'projectAdmin', 'stranger'] as const) {
        const response = await get(actor, '/list-all').expect(403);
        expect(bodyOf(response).code).toBe('FORBIDDEN');
      }
    });

    it('sin sesión todo responde 401', async () => {
      await get(null, '/create').expect(401);
      await get(null, `/projects/${projectId}/view`).expect(401);
    });
  });

  describe('matriz rol × ruta de proyecto (§105.2)', () => {
    const matrix: Record<string, Partial<Record<Actor, number>>> = {
      view: {
        globalAdmin: 200,
        owner: 200,
        projectAdmin: 200,
        collaborator: 200,
        reader: 200,
        stranger: 404,
        removed: 404,
        left: 404,
      },
      update: {
        globalAdmin: 200,
        owner: 200,
        projectAdmin: 200,
        collaborator: 403,
        reader: 403,
        stranger: 404,
        removed: 404,
        left: 404,
      },
      reopen: {
        globalAdmin: 200,
        owner: 200,
        projectAdmin: 403,
        collaborator: 403,
        reader: 403,
        stranger: 404,
        removed: 404,
        left: 404,
      },
    };

    for (const [route, expectations] of Object.entries(matrix)) {
      it(`/${route}`, async () => {
        for (const [actor, status] of Object.entries(expectations)) {
          const response = await get(actor as Actor, `/projects/${projectId}/${route}`);
          expect(response.status, `${actor} en /${route}`).toBe(status);
        }
      });
    }
  });

  describe('aislamiento (§105.3)', () => {
    it('un no miembro recibe exactamente la misma respuesta que ante un proyecto inexistente', async () => {
      const stranger = await get('stranger', `/projects/${projectId}/view`);
      const missing = await get('stranger', '/projects/0195f7c0-0000-7000-8000-00000000dead/view');
      const notUuid = await get('stranger', '/projects/no-es-un-uuid/view');

      expect(stranger.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(notUuid.status).toBe(404);
      expect(stranger.body).toEqual(missing.body);
      expect(stranger.body).toEqual(notUuid.body);
      expect(bodyOf(stranger).code).toBe('NOT_FOUND');
    });

    it('expulsados y quienes abandonaron pierden el acceso (404)', async () => {
      await get('removed', `/projects/${projectId}/view`).expect(404);
      await get('left', `/projects/${projectId}/view`).expect(404);
    });

    it('un usuario no ve los proyectos de otros aunque tenga rol en el suyo', async () => {
      const other = await insertProject(ctx.t.db, { owner: users_.stranger!, name: 'Ajeno' });
      // El colaborador de P no tiene acceso al proyecto del extraño.
      await get('collaborator', `/projects/${other.project.id}/view`).expect(404);
      // Cada uno ve el suyo.
      await get('stranger', `/projects/${other.project.id}/view`).expect(200);
    });

    it('el Administrador Global accede a proyectos de los que no es miembro', async () => {
      const response = await get('globalAdmin', `/projects/${projectId}/view`).expect(200);
      expect(bodyOf(response) as unknown).toMatchObject({ roleKey: null, isOwner: false });
    });
  });

  describe('permisos efectivos', () => {
    it('el propietario suma los permisos de propietario a los de Administrador de Proyecto', async () => {
      const body = (await get('owner', `/projects/${projectId}/view`).expect(200)).body as {
        roleKey: string;
        isOwner: boolean;
        permissions: string[];
      };
      expect(body.isOwner).toBe(true);
      expect(body.roleKey).toBe('PROJECT_ADMIN');
      expect(body.permissions).toEqual(
        expect.arrayContaining([
          'project.reopen',
          'project.trash',
          'project.restore',
          'project.update',
        ]),
      );
    });

    it('el Administrador de Proyecto no tiene reabrir, papelera ni restaurar (§87)', async () => {
      const body = (await get('projectAdmin', `/projects/${projectId}/view`).expect(200)).body as {
        permissions: string[];
      };
      for (const denied of ['project.reopen', 'project.trash', 'project.restore']) {
        expect(body.permissions).not.toContain(denied);
      }
      expect(body.permissions).toContain('members.update_role');
    });
  });

  describe('proyecto en papelera', () => {
    beforeEach(async () => {
      await ctx.t.db
        .update(projects)
        .set({
          status: 'TRASHED',
          previousStatus: 'ACTIVE',
          deletedAt: new Date(),
          purgeEligibleAt: new Date(Date.now() + 90 * 86400_000),
        })
        .where(eq(projects.id, projectId));
    });

    it('las rutas normales responden 404 para todos, incluidos el propietario y el Global', async () => {
      for (const actor of ['globalAdmin', 'owner', 'projectAdmin', 'collaborator'] as const) {
        await get(actor, `/projects/${projectId}/view`).expect(404);
      }
    });

    it('las rutas que admiten la papelera solo dejan pasar a quien puede restaurar', async () => {
      await get('owner', `/projects/${projectId}/restore`).expect(200);
      await get('globalAdmin', `/projects/${projectId}/restore`).expect(200);
      for (const actor of ['projectAdmin', 'collaborator', 'reader', 'stranger'] as const) {
        await get(actor, `/projects/${projectId}/restore`).expect(404);
      }
    });
  });

  describe('roles personalizados (arquitectura, §4.5)', () => {
    it('un rol global personalizado con project.view permite ver cualquier proyecto sin poder editarlo', async () => {
      const [auditor] = await ctx.t.db
        .insert(roles)
        .values({ scope: 'GLOBAL', name: 'Auditor' })
        .returning();
      await ctx.t.db.insert(rolePermissions).values([
        { roleId: auditor!.id, permissionCode: 'project.view' },
        { roleId: auditor!.id, permissionCode: 'projects.list_all' },
      ]);
      await ctx.t.db
        .update(users)
        .set({ globalRoleId: auditor!.id })
        .where(eq(users.id, users_.stranger!.id));

      await get('stranger', `/projects/${projectId}/view`).expect(200);
      await get('stranger', '/list-all').expect(200);
      await get('stranger', `/projects/${projectId}/update`).expect(403);
      // Al perder projects.create por su rol personalizado, tampoco puede crear.
      await get('stranger', '/create').expect(403);
    });

    it('un rol personalizado de proyecto otorga solo lo que declara', async () => {
      const [analyst] = await ctx.t.db
        .insert(roles)
        .values({ scope: 'PROJECT', name: 'Analista', projectId })
        .returning();
      await ctx.t.db.insert(rolePermissions).values([
        { roleId: analyst!.id, permissionCode: 'project.view' },
        { roleId: analyst!.id, permissionCode: 'project.update' },
      ]);
      const user = await ctx.createUser({ email: 'analyst@example.com' });
      await ctx.t.db.insert(projectMembers).values({
        projectId,
        userId: user.id,
        roleId: analyst!.id,
        joinedAt: new Date(),
      });
      const cookie = sessionCookie(await login(ctx.server, user.email).expect(200))!;

      await request(ctx.server)
        .get(`/api/probe/projects/${projectId}/update`)
        .set('Cookie', cookie)
        .expect(200);
      await request(ctx.server)
        .get(`/api/probe/projects/${projectId}/reopen`)
        .set('Cookie', cookie)
        .expect(403);
    });
  });

  describe('reautenticación tras el acceso (§39)', () => {
    it('un no miembro recibe 404 (no REAUTH_REQUIRED) aunque su contraseña esté sin confirmar', async () => {
      ctx.clock.advanceSeconds(3600);
      // Vuelve a entrar y espera a que caduque la confirmación.
      const cookie = sessionCookie(
        await login(ctx.server, users_.stranger!.email, undefined, true).expect(200),
      )!;
      ctx.clock.advanceSeconds(3600);
      const response = await request(ctx.server)
        .post(`/api/probe/projects/${projectId}/sensitive`)
        .set('Cookie', cookie)
        .expect(404);
      expect(bodyOf(response).code).toBe('NOT_FOUND');
    });

    it('un miembro con permiso pero sin confirmación reciente recibe REAUTH_REQUIRED', async () => {
      const cookie = sessionCookie(
        await login(ctx.server, users_.projectAdmin!.email, undefined, true).expect(200),
      )!;
      ctx.clock.advanceSeconds(600);
      const response = await request(ctx.server)
        .post(`/api/probe/projects/${projectId}/sensitive`)
        .set('Cookie', cookie)
        .expect(403);
      expect(bodyOf(response).code).toBe('REAUTH_REQUIRED');
    });
  });

  describe('límite de asignación de roles (§84, §98)', () => {
    const assignable = async (actor: Actor) => {
      const access = await ctx.app
        .get(AuthorizationService)
        .projectAccess(users_[actor]!, projectId);
      return (await ctx.app.get(AuthorizationService).assignableRoles(access!))
        .map((role) => role.key)
        .sort();
    };

    it('un Administrador de Proyecto puede asignar los tres roles de proyecto, nunca el propietario ni los globales', async () => {
      expect(await assignable('projectAdmin')).toEqual(['COLLABORATOR', 'PROJECT_ADMIN', 'READER']);
      expect(await assignable('owner')).toEqual(['COLLABORATOR', 'PROJECT_ADMIN', 'READER']);
      expect(await assignable('globalAdmin')).toEqual(['COLLABORATOR', 'PROJECT_ADMIN', 'READER']);
    });

    it('un rol personalizado con un permiso que el actor no tiene no es asignable', async () => {
      const [powerful] = await ctx.t.db
        .insert(roles)
        .values({ scope: 'PROJECT', name: 'Poderoso', projectId })
        .returning();
      await ctx.t.db.insert(rolePermissions).values([
        { roleId: powerful!.id, permissionCode: 'project.view' },
        { roleId: powerful!.id, permissionCode: 'project.trash' },
      ]);
      // El Administrador de Proyecto no tiene project.trash: no puede asignarlo.
      expect(await assignable('projectAdmin')).not.toContain('Poderoso');
      // El propietario sí tiene project.trash.
      expect(await assignable('owner')).toContain('Poderoso');
    });

    it('un rol personalizado de OTRO proyecto no es asignable aquí', async () => {
      const other = await insertProject(ctx.t.db, { owner: users_.stranger!, name: 'Otro' });
      const [foreign] = await ctx.t.db
        .insert(roles)
        .values({ scope: 'PROJECT', name: 'Ajeno', projectId: other.project.id })
        .returning();
      await ctx.t.db
        .insert(rolePermissions)
        .values({ roleId: foreign!.id, permissionCode: 'project.view' });
      expect(await assignable('owner')).not.toContain('Ajeno');
    });
  });
});
