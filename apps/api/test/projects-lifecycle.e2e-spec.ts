import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, projects, type UserRow } from '../src/database/schema/index.js';
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
type Action = 'close' | 'reopen' | 'trash' | 'restore';

describe('ciclo de vida del proyecto (e2e, PostgreSQL real)', () => {
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
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
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

  const act = (actor: Actor, action: Action, body: object = {}) =>
    request(ctx.server)
      .post(`/api/projects/${projectId}/${action}`)
      .set('Cookie', cookies[actor])
      .send(body);

  const statusOf = async () => {
    const [row] = await ctx.t.db.select().from(projects).where(eq(projects.id, projectId));
    return row!;
  };

  /** Deja el proyecto en el estado pedido sin pasar por la API. */
  const setStatus = async (status: 'ACTIVE' | 'CLOSED' | 'TRASHED') => {
    if (status === 'TRASHED') {
      await ctx.t.pool.query(
        `UPDATE projects SET status = 'TRASHED', previous_status = 'ACTIVE', deleted_at = now(),
           deleted_by = owner_id, purge_eligible_at = now() + interval '90 days' WHERE id = $1`,
        [projectId],
      );
    } else {
      await ctx.t.pool.query(
        `UPDATE projects SET status = $2, previous_status = NULL, deleted_at = NULL, deleted_by = NULL,
           deletion_reason = NULL, purge_eligible_at = NULL WHERE id = $1`,
        [projectId, status],
      );
    }
  };

  describe('matriz de roles (F3)', () => {
    it('cerrar: propietario, Administrador de Proyecto y Global; no colaboradores ni lectores', async () => {
      for (const actor of ['collab', 'reader'] as const) {
        expect((await act(actor, 'close').expect(403)).body).toMatchObject({ code: 'FORBIDDEN' });
      }
      await act('stranger', 'close').expect(404);
      expect((await statusOf()).status).toBe('ACTIVE');

      for (const actor of ['owner', 'admin', 'root'] as const) {
        await setStatus('ACTIVE');
        await act(actor, 'close').expect(200);
        expect((await statusOf()).status, `cerrado por ${actor}`).toBe('CLOSED');
      }
    });

    it('reabrir: solo propietario y Global; el Administrador de Proyecto no', async () => {
      await setStatus('CLOSED');
      for (const actor of ['admin', 'collab', 'reader'] as const)
        await act(actor, 'reopen').expect(403);
      await act('stranger', 'reopen').expect(404);
      expect((await statusOf()).status).toBe('CLOSED');

      for (const actor of ['owner', 'root'] as const) {
        await setStatus('CLOSED');
        await act(actor, 'reopen').expect(200);
        expect((await statusOf()).status, `reabierto por ${actor}`).toBe('ACTIVE');
      }
    });

    it('papelera: solo propietario y Global; el Administrador de Proyecto no', async () => {
      for (const actor of ['admin', 'collab', 'reader'] as const)
        await act(actor, 'trash').expect(403);
      await act('stranger', 'trash').expect(404);
      expect((await statusOf()).status).toBe('ACTIVE');

      for (const actor of ['owner', 'root'] as const) {
        await setStatus('ACTIVE');
        await ctx.t.pool.query(
          `UPDATE projects SET previous_status = NULL, deleted_at = NULL, deleted_by = NULL, purge_eligible_at = NULL WHERE id = $1`,
          [projectId],
        );
        await act(actor, 'trash').expect(200);
        expect((await statusOf()).status, `enviado por ${actor}`).toBe('TRASHED');
      }
    });

    it('restaurar: solo propietario y Global; el Administrador de Proyecto no', async () => {
      await setStatus('TRASHED');
      for (const actor of ['admin', 'collab', 'reader'] as const) {
        // Un miembro no propietario ve el proyecto en papelera como inexistente.
        const response = await act(actor, 'restore');
        expect([403, 404], `${actor} restaurando`).toContain(response.status);
      }
      await act('stranger', 'restore').expect(404);
      expect((await statusOf()).status).toBe('TRASHED');

      for (const actor of ['owner', 'root'] as const) {
        await setStatus('TRASHED');
        await act(actor, 'restore').expect(200);
        expect((await statusOf()).status, `restaurado por ${actor}`).toBe('ACTIVE');
      }
    });

    it('un Administrador de Proyecto con permiso explícito de papelera (rol personalizado) sí puede', async () => {
      // Rol personalizado: proyecto (project_id) con los permisos de Administrador + project.trash.
      const { rows } = await ctx.t.pool.query<{ id: string }>(
        `INSERT INTO roles (id, key, name, description, scope, project_id, is_system)
         VALUES (gen_random_uuid(), NULL, 'Admin con papelera', '', 'PROJECT', $1, false)
         RETURNING id`,
        [projectId],
      );
      const roleId = rows[0]!.id;
      await ctx.t.pool.query(
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'project.view'), ($1, 'project.trash')`,
        [roleId],
      );
      await ctx.t.pool.query(
        `UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3`,
        [roleId, projectId, people.collab.id],
      );
      await act('collab', 'trash').expect(200);
      expect((await statusOf()).status).toBe('TRASHED');
    });
  });

  describe('reautenticación (§39)', () => {
    it.each(['close', 'reopen', 'trash', 'restore'] as const)(
      '%s exige contraseña confirmada hace menos de 5 minutos',
      async (action) => {
        await setStatus(
          action === 'reopen' ? 'CLOSED' : action === 'restore' ? 'TRASHED' : 'ACTIVE',
        );
        ctx.clock.advanceSeconds(6 * 60);

        const denied = await act('owner', action).expect(403);
        expect(bodyOf(denied).code).toBe('REAUTH_REQUIRED');
        const before = await statusOf();

        await request(ctx.server)
          .post('/api/auth/reauth')
          .set('Cookie', cookies.owner)
          .send({ password: TEST_PASSWORD })
          .expect(200);
        await act('owner', action).expect(200);
        expect((await statusOf()).status).not.toBe(before.status);
      },
    );

    it('sin permiso o sin acceso no se revela nada aunque falte la reautenticación', async () => {
      ctx.clock.advanceSeconds(6 * 60);
      // Sin acceso → 404; sin permiso → 403 FORBIDDEN (no REAUTH_REQUIRED).
      await act('stranger', 'close').expect(404);
      const denied = await act('reader', 'close').expect(403);
      expect(bodyOf(denied).code).toBe('FORBIDDEN');
    });

    it('sin sesión responde 401', async () => {
      await request(ctx.server).post(`/api/projects/${projectId}/close`).send({}).expect(401);
    });
  });

  describe('transiciones', () => {
    it('cerrar y reabrir devuelven el proyecto con su nuevo estado y aumentan la versión', async () => {
      const closed = await act('owner', 'close').expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOSED', version: 2 });
      const reopened = await act('owner', 'reopen').expect(200);
      expect(reopened.body).toMatchObject({ status: 'ACTIVE', version: 3 });
    });

    it('las transiciones inválidas responden 409 INVALID_STATE y no cambian nada', async () => {
      // ACTIVE: no se puede reabrir ni restaurar.
      for (const action of ['reopen', 'restore'] as const) {
        const response = await act('owner', action).expect(409);
        expect(bodyOf(response).code).toBe('INVALID_STATE');
      }
      // CLOSED: no se puede cerrar de nuevo.
      await setStatus('CLOSED');
      expect(bodyOf(await act('owner', 'close').expect(409)).code).toBe('INVALID_STATE');
      // TRASHED: no se puede cerrar, reabrir ni enviar de nuevo a la papelera.
      await setStatus('TRASHED');
      for (const action of ['close', 'reopen', 'trash'] as const) {
        // El propietario sigue accediendo a la papelera solo en las rutas que la admiten.
        const response = await act('root', action);
        expect([404, 409], `${action} en papelera`).toContain(response.status);
      }
      expect((await statusOf()).status).toBe('TRASHED');
    });

    it('la papelera guarda estado anterior, fecha, quién, motivo y 90 días de retención', async () => {
      await setStatus('CLOSED');
      await act('owner', 'trash', { reason: '  Ya no lo usamos  ' }).expect(200);

      const row = await statusOf();
      expect(row).toMatchObject({
        status: 'TRASHED',
        previousStatus: 'CLOSED',
        deletedBy: people.owner.id,
        deletionReason: 'Ya no lo usamos',
      });
      expect(row.deletedAt!.toISOString()).toBe('2026-06-01T12:00:00.000Z');
      expect(row.purgeEligibleAt!.toISOString()).toBe('2026-08-30T12:00:00.000Z');
    });

    it('enviar a la papelera sin cuerpo también funciona y el motivo es opcional', async () => {
      await request(ctx.server)
        .post(`/api/projects/${projectId}/trash`)
        .set('Cookie', cookies.owner)
        .expect(200);
      expect((await statusOf()).deletionReason).toBeNull();
    });

    it('rechaza un motivo demasiado largo', async () => {
      await act('owner', 'trash', { reason: 'x'.repeat(501) }).expect(400);
      expect((await statusOf()).status).toBe('ACTIVE');
    });

    it('restaurar devuelve al estado anterior (ACTIVE o CLOSED) y limpia los datos de papelera', async () => {
      for (const previous of ['ACTIVE', 'CLOSED'] as const) {
        await setStatus(previous);
        await act('owner', 'trash', { reason: 'prueba' }).expect(200);
        const restored = await act('owner', 'restore').expect(200);
        expect(restored.body).toMatchObject({ status: previous });
        expect(await statusOf()).toMatchObject({
          status: previous,
          previousStatus: null,
          deletedAt: null,
          deletedBy: null,
          deletionReason: null,
          purgeEligibleAt: null,
        });
      }
    });

    it('un proyecto en la papelera desaparece de "Mis proyectos" y aparece en la papelera del propietario', async () => {
      await act('owner', 'trash').expect(200);
      const mine = await request(ctx.server).get('/api/projects').set('Cookie', cookies.owner);
      expect(mine.body).toEqual([]);
      const trash = await request(ctx.server)
        .get('/api/projects/trash')
        .set('Cookie', cookies.owner)
        .expect(200);
      expect((trash.body as { id: string }[]).map((p) => p.id)).toEqual([projectId]);

      // Los demás miembros ya no lo ven ni por detalle ni por listado.
      await request(ctx.server)
        .get(`/api/projects/${projectId}`)
        .set('Cookie', cookies.collab)
        .expect(404);
      const others = await request(ctx.server)
        .get('/api/projects/trash')
        .set('Cookie', cookies.collab)
        .expect(200);
      expect(others.body).toEqual([]);
    });

    it('un proyecto cerrado sigue siendo visible para sus miembros', async () => {
      await act('admin', 'close').expect(200);
      for (const actor of ['owner', 'admin', 'collab', 'reader'] as const) {
        const response = await request(ctx.server)
          .get(`/api/projects/${projectId}`)
          .set('Cookie', cookies[actor])
          .expect(200);
        expect(response.body).toMatchObject({ status: 'CLOSED' });
      }
    });

    it('dos cierres simultáneos: uno gana y el otro recibe 409', async () => {
      const results = await Promise.all([act('owner', 'close'), act('admin', 'close')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await statusOf()).status).toBe('CLOSED');
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'project.closed')));
      expect(logs).toHaveLength(1);
    });
  });

  describe('auditoría', () => {
    it('cada transición queda auditada con actor, estado anterior y nuevo', async () => {
      await act('admin', 'close').expect(200);
      await act('owner', 'reopen').expect(200);
      await act('owner', 'trash', { reason: 'limpieza' }).expect(200);
      await act('root', 'restore').expect(200);

      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.projectId, projectId))
        .orderBy(auditLogs.occurredAt, auditLogs.id);
      const lifecycle = logs.filter((l) => l.action.startsWith('project.'));
      expect(lifecycle.map((l) => [l.action, l.actorUserId])).toEqual([
        ['project.closed', people.admin.id],
        ['project.reopened', people.owner.id],
        ['project.trashed', people.owner.id],
        ['project.restored', people.root.id],
      ]);
      expect(lifecycle[0]).toMatchObject({
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'CLOSED' },
      });
      expect(lifecycle[2]!.metadata).toMatchObject({ reason: 'limpieza' });
      expect(lifecycle[3]).toMatchObject({
        oldValues: { status: 'TRASHED' },
        newValues: { status: 'ACTIVE' },
      });
    });

    it('una transición rechazada no deja auditoría', async () => {
      await act('owner', 'reopen').expect(409);
      const logs = await ctx.t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'project.reopened')));
      expect(logs).toHaveLength(0);
    });
  });
});
