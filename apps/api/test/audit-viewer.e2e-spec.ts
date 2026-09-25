import type { AuditLogPage } from '@letfer/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, projects, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'other' | 'stranger';

describe('visor de auditoría (e2e, PostgreSQL real, §111.1, D8-2)', () => {
  let ctx: TestApp;
  let projectA: string;
  let projectB: string;
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
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.other = await ctx.createUser({ email: 'other@example.com', firstName: 'Omar' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });

    projectA = (await insertProject(ctx.t.db, { owner: people.owner, name: 'A' })).project.id;
    projectB = (await insertProject(ctx.t.db, { owner: people.other, name: 'B' })).project.id;
    await insertMember(ctx.t.db, {
      projectId: projectA,
      userId: people.admin.id,
      roleKey: 'PROJECT_ADMIN',
    });
    await insertMember(ctx.t.db, {
      projectId: projectA,
      userId: people.collab.id,
      roleKey: 'COLLABORATOR',
    });
    await insertMember(ctx.t.db, {
      projectId: projectA,
      userId: people.reader.id,
      roleKey: 'READER',
    });

    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  interface SeedEntry {
    action?: string;
    projectId?: string | null;
    actorUserId?: string | null;
    entityType?: string;
    entityId?: string | null;
    occurredAt?: Date;
    newValues?: Record<string, unknown>;
  }
  const seed = async (entries: SeedEntry[]) => {
    await ctx.t.db.insert(auditLogs).values(
      entries.map((entry) => ({
        action: 'test.something.happened',
        entityType: 'thing',
        occurredAt: new Date('2026-05-01T10:00:00.000Z'),
        projectId: null,
        ...entry,
      })),
    );
  };

  const projectAudit = (actor: Actor, query = '', project = projectA) =>
    request(ctx.server)
      .get(`/api/projects/${project}/audit-logs${query}`)
      .set('Cookie', cookies[actor]);
  const globalAudit = (actor: Actor, query = '') =>
    request(ctx.server).get(`/api/admin/audit-logs${query}`).set('Cookie', cookies[actor]);
  const pageOf = (response: request.Response) => response.body as AuditLogPage;

  describe('permisos y aislamiento por proyecto', () => {
    beforeEach(async () => {
      await seed([
        { action: 'test.a.one', projectId: projectA },
        { action: 'test.a.two', projectId: projectA },
        { action: 'test.b.one', projectId: projectB },
        { action: 'test.system.one', projectId: null },
      ]);
    });

    it('el Administrador de Proyecto ve solo la auditoría de su proyecto', async () => {
      for (const actor of ['owner', 'admin'] as const) {
        const response = await projectAudit(actor, '?action=test.').expect(200);
        const actions = pageOf(response).items.map((item) => item.action);
        expect(actions.sort()).toEqual(['test.a.one', 'test.a.two']);
        expect(pageOf(response).items.every((item) => item.projectId === projectA)).toBe(true);
      }
    });

    it('Colaborador y Lector reciben 403; un ajeno recibe 404; sin sesión, 401', async () => {
      await projectAudit('collab').expect(403);
      await projectAudit('reader').expect(403);
      await projectAudit('stranger').expect(404);
      await request(ctx.server).get(`/api/projects/${projectA}/audit-logs`).expect(401);
    });

    it('un Administrador de Proyecto no ve la auditoría de otro proyecto (404)', async () => {
      await projectAudit('admin', '', projectB).expect(404);
    });

    it('un projectId enviado por el cliente no amplía el alcance', async () => {
      const response = await projectAudit('admin', `?action=test.&projectId=${projectB}`).expect(
        200,
      );
      expect(pageOf(response).items.map((item) => item.projectId)).not.toContain(projectB);
    });

    it('el Administrador de Proyecto no accede a la auditoría global', async () => {
      await globalAudit('admin').expect(403);
      await globalAudit('owner').expect(403);
      await globalAudit('collab').expect(403);
      await request(ctx.server).get('/api/admin/audit-logs').expect(401);
    });

    it('el Administrador Global ve todo, puede filtrar por proyecto y por "sin proyecto"', async () => {
      const all = pageOf(await globalAudit('root', '?action=test.').expect(200));
      expect(all.items.map((item) => item.action).sort()).toEqual([
        'test.a.one',
        'test.a.two',
        'test.b.one',
        'test.system.one',
      ]);

      const onlyB = pageOf(
        await globalAudit('root', `?action=test.&projectId=${projectB}`).expect(200),
      );
      expect(onlyB.items.map((item) => item.action)).toEqual(['test.b.one']);

      const system = pageOf(await globalAudit('root', '?action=test.&system=true').expect(200));
      expect(system.items.map((item) => item.action)).toEqual(['test.system.one']);

      await globalAudit('root', `?projectId=${projectB}&system=true`).expect(400);
    });

    it('la auditoría de un proyecto en papelera solo la ve quien puede restaurarlo', async () => {
      await ctx.t.db
        .update(projects)
        .set({
          status: 'TRASHED',
          previousStatus: 'ACTIVE',
          deletedAt: new Date('2026-05-02T00:00:00.000Z'),
          purgeEligibleAt: new Date('2026-08-01T00:00:00.000Z'),
        })
        .where(eq(projects.id, projectA));
      await projectAudit('owner', '?action=test.').expect(200);
      await projectAudit('root', '?action=test.').expect(200);
      await projectAudit('admin').expect(404);
    });
  });

  describe('paginación por cursor', () => {
    it('recorre todas las páginas sin repetir ni omitir filas con el mismo instante', async () => {
      const sameInstant = new Date('2026-05-01T10:00:00.000Z');
      await seed(
        Array.from({ length: 7 }, (_, index) => ({
          action: `test.page.${index}`,
          projectId: projectA,
          occurredAt: sameInstant,
        })),
      );
      await seed([
        {
          action: 'test.page.older',
          projectId: projectA,
          occurredAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          action: 'test.page.newer',
          projectId: projectA,
          occurredAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ]);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?action=test.page.&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        const page = pageOf(await projectAudit('admin', query).expect(200));
        expect(page.items.length).toBeLessThanOrEqual(3);
        seen.push(...page.items.map((item) => item.action));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(9);
      expect(new Set(seen).size).toBe(9);
      expect(seen[0]).toBe('test.page.newer');
      expect(seen.at(-1)).toBe('test.page.older');
    });

    it('la última página no devuelve cursor', async () => {
      await seed([{ action: 'test.one', projectId: projectA }]);
      const page = pageOf(await projectAudit('admin', '?action=test.&limit=5').expect(200));
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('rechaza un cursor manipulado', async () => {
      await projectAudit('admin', '?cursor=esto-no-es-un-cursor').expect(400);
      const forged = Buffer.from("2026-01-01'; DROP TABLE audit_logs;--|x", 'utf8').toString(
        'base64url',
      );
      await projectAudit('admin', `?cursor=${forged}`).expect(400);
    });
  });

  describe('filtros', () => {
    it('filtra por acción (prefijo literal), actor, entidad y rango de fechas', async () => {
      const entityId = '0195f0c0-0000-7000-8000-0000000000aa';
      await seed([
        {
          action: 'bet.created',
          projectId: projectA,
          actorUserId: people.collab.id,
          entityType: 'bet',
          entityId,
          occurredAt: new Date('2026-05-10T00:00:00.000Z'),
        },
        {
          action: 'bet.settled',
          projectId: projectA,
          actorUserId: people.admin.id,
          entityType: 'bet',
          occurredAt: new Date('2026-05-20T00:00:00.000Z'),
        },
        {
          action: 'member.removed',
          projectId: projectA,
          actorUserId: people.admin.id,
          entityType: 'project_member',
          occurredAt: new Date('2026-05-25T00:00:00.000Z'),
        },
      ]);
      const actions = async (query: string) =>
        pageOf(await projectAudit('admin', query).expect(200)).items.map((item) => item.action);

      expect((await actions('?action=bet.')).sort()).toEqual(['bet.created', 'bet.settled']);
      expect(await actions('?action=bet.created')).toEqual(['bet.created']);
      expect(await actions(`?actorUserId=${people.collab.id}`)).toEqual(['bet.created']);
      expect(await actions(`?entityId=${entityId}`)).toEqual(['bet.created']);
      expect(await actions('?entityType=project_member')).toEqual(['member.removed']);
      expect(await actions('?from=2026-05-15T00:00:00Z&to=2026-05-22T00:00:00Z')).toEqual([
        'bet.settled',
      ]);
      // `%` y `_` son texto, no comodines: no coinciden con nada...
      expect(await actions('?action=%25')).toEqual([]);
      expect(await actions('?action=bet_')).toEqual([]);
      // ...pero sí encuentran una acción que los contiene de forma literal.
      await seed([{ action: 'promo.100%_off', projectId: projectA }]);
      expect(await actions('?action=promo.100%25')).toEqual(['promo.100%_off']);
      expect(await actions('?action=promo.100%25_o')).toEqual(['promo.100%_off']);
      expect(await actions('?action=promo.1%2500')).toEqual([]);
    });

    it('rechaza un rango invertido y un tamaño de página excesivo', async () => {
      await projectAudit('admin', '?from=2026-06-02T00:00:00Z&to=2026-06-01T00:00:00Z').expect(400);
      await projectAudit('admin', '?limit=101').expect(400);
      await projectAudit('admin', '?actorUserId=no-es-uuid').expect(400);
    });
  });

  describe('contenido de cada entrada', () => {
    it('incluye actor, valores anterior y nuevo, y contexto de la petición', async () => {
      await seed([
        {
          action: 'test.detail',
          projectId: projectA,
          actorUserId: people.admin.id,
          newValues: { name: 'Nuevo' },
        },
      ]);
      const [entry] = pageOf(await projectAudit('admin', '?action=test.detail').expect(200)).items;
      expect(entry).toMatchObject({
        action: 'test.detail',
        actor: { id: people.admin.id, name: 'Adela Pérez' },
        newValues: { name: 'Nuevo' },
        oldValues: null,
      });
    });

    it('vuelve a redactar los valores sensibles al leer', async () => {
      await seed([
        {
          action: 'test.leaky',
          projectId: projectA,
          newValues: {
            passwordHash: 'argon2id$secreto',
            nested: { apiToken: 'abc' },
            ok: 'visible',
          },
        },
      ]);
      const [entry] = pageOf(await projectAudit('admin', '?action=test.leaky').expect(200)).items;
      const text = JSON.stringify(entry);
      expect(text).not.toContain('argon2id$secreto');
      expect(text).not.toContain('abc');
      expect(entry!.newValues).toMatchObject({ passwordHash: '[REDACTED]', ok: 'visible' });
    });

    it('una entrada sin actor (sistema) se devuelve con actor nulo', async () => {
      await seed([{ action: 'test.system', projectId: projectA, actorUserId: null }]);
      const [entry] = pageOf(await projectAudit('admin', '?action=test.system').expect(200)).items;
      expect(entry!.actor).toBeNull();
    });
  });

  it('consultar la auditoría no deja rastro nuevo en ella (solo lectura)', async () => {
    const before = await ctx.t.db.select().from(auditLogs);
    await projectAudit('admin').expect(200);
    await globalAudit('root').expect(200);
    const after = await ctx.t.db.select().from(auditLogs);
    expect(after).toHaveLength(before.length);
  });
});
