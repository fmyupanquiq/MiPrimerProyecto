import type { TrashItem } from '@letfer/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bets, stages, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import {
  insertBet,
  insertHouse,
  insertMember,
  insertProject,
  insertStage,
} from './support/factories.js';
import { eq } from 'drizzle-orm';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'other' | 'stranger';

describe('papelera del proyecto (e2e, PostgreSQL real, §36, §111.2)', () => {
  let ctx: TestApp;
  let projectId: string;
  let otherProjectId: string;
  let houseId: string;
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
    people.admin = await ctx.createUser({ email: 'admin@example.com' });
    people.collab = await ctx.createUser({ email: 'collab@example.com' });
    people.reader = await ctx.createUser({ email: 'reader@example.com' });
    people.other = await ctx.createUser({ email: 'other@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });

    projectId = (await insertProject(ctx.t.db, { owner: people.owner, name: 'A' })).project.id;
    otherProjectId = (await insertProject(ctx.t.db, { owner: people.other, name: 'B' })).project.id;
    await insertMember(ctx.t.db, { projectId, userId: people.admin.id, roleKey: 'PROJECT_ADMIN' });
    await insertMember(ctx.t.db, { projectId, userId: people.collab.id, roleKey: 'COLLABORATOR' });
    await insertMember(ctx.t.db, { projectId, userId: people.reader.id, roleKey: 'READER' });
    houseId = (await insertHouse(ctx.t.db, { projectId, name: 'Casa Uno' })).id;

    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const trash = (actor: Actor, project = projectId) =>
    request(ctx.server).get(`/api/projects/${project}/trash`).set('Cookie', cookies[actor]);
  const itemsOf = (response: request.Response) => response.body as TrashItem[];

  /** Una apuesta y una etapa enviadas a la papelera (directo en la base de datos). */
  async function seedTrash() {
    const stageId = (await insertStage(ctx.t.db, { projectId })).id;
    const deletedAt = new Date('2026-04-01T00:00:00.000Z');
    const { bet } = await insertBet(ctx.t.db, {
      projectId,
      stageId,
      houseId,
      createdBy: people.collab.id,
      selections: [{ event: 'Real vs. Barça', selection: 'Real gana', visibleOdds: '2.10' }],
    });
    await ctx.t.db
      .update(bets)
      .set({
        deletedAt,
        deletedBy: people.owner.id,
        deletionReason: 'Duplicada',
        purgeEligibleAt: new Date('2026-05-30T00:00:00.000Z'),
      })
      .where(eq(bets.id, bet.id));
    const trashed = await insertStage(ctx.t.db, {
      projectId,
      name: 'Etapa vieja',
      status: 'TRASHED',
      deletedAt: new Date('2026-05-25T00:00:00.000Z'),
      deletedBy: people.admin.id,
      purgeEligibleAt: new Date('2026-08-23T00:00:00.000Z'),
    });
    return { bet, stage: trashed };
  }

  it('lista apuestas y etapas eliminadas, con quién, cuándo, motivo y elegibilidad', async () => {
    const { bet, stage } = await seedTrash();
    const items = itemsOf(await trash('owner').expect(200));

    expect(items.map((item) => item.kind)).toEqual(['STAGE', 'BET']); // la más reciente primero
    const [stageItem, betItem] = items;
    expect(stageItem).toMatchObject({
      id: stage.id,
      label: 'Etapa vieja',
      deletedBy: { id: people.admin.id },
      purgeEligible: false, // el reloj de pruebas marca 2026-06-01; vence el 2026-08-23
    });
    expect(betItem).toMatchObject({
      id: bet.id,
      label: 'Real vs. Barça — Real gana',
      detail: 'Casa Uno · stake 1.0000',
      deletionReason: 'Duplicada',
      deletedBy: { id: people.owner.id, name: 'Olga Pérez' },
      purgeEligible: true, // venció el 2026-05-30, antes del reloj de pruebas (2026-06-01)
    });
  });

  it('marca como elegible para purga solo lo que ya cumplió la retención (según el reloj)', async () => {
    await seedTrash();
    const items = itemsOf(await trash('owner').expect(200));
    expect(Object.fromEntries(items.map((item) => [item.kind, item.purgeEligible]))).toEqual({
      STAGE: false,
      BET: true,
    });
    // Al avanzar el reloj más allá del 2026-08-23 también la etapa cumple la retención.
    ctx.clock.set('2026-09-01T00:00:00.000Z');
    cookies.owner = sessionCookie(await login(ctx.server, people.owner.email).expect(200))!;
    expect(itemsOf(await trash('owner').expect(200)).every((item) => item.purgeEligible)).toBe(
      true,
    );
  });

  it('no incluye nada eliminado en otro proyecto ni lo que no está en la papelera', async () => {
    await seedTrash();
    const stageId = (await insertStage(ctx.t.db, { projectId: otherProjectId })).id;
    const otherHouse = (await insertHouse(ctx.t.db, { projectId: otherProjectId })).id;
    const { bet } = await insertBet(ctx.t.db, {
      projectId: otherProjectId,
      stageId,
      houseId: otherHouse,
      createdBy: people.other.id,
    });
    await ctx.t.db
      .update(bets)
      .set({ deletedAt: new Date(), purgeEligibleAt: new Date() })
      .where(eq(bets.id, bet.id));
    // Una apuesta viva del proyecto A tampoco aparece.
    await insertBet(ctx.t.db, {
      projectId,
      stageId: (await insertStage(ctx.t.db, { projectId, name: 'Viva', status: 'CLOSED' })).id,
      houseId,
      createdBy: people.collab.id,
    });

    const items = itemsOf(await trash('owner').expect(200));
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).not.toContain(bet.id);
  });

  it('el Administrador de Proyecto y el Administrador Global acceden; el resto no', async () => {
    await seedTrash();
    await trash('admin').expect(200);
    await trash('root').expect(200);
    await trash('collab').expect(403);
    await trash('reader').expect(403);
    await trash('stranger').expect(404);
    await trash('admin', otherProjectId).expect(404);
    await request(ctx.server).get(`/api/projects/${projectId}/trash`).expect(401);
  });

  it('una papelera vacía devuelve una lista vacía', async () => {
    expect(itemsOf(await trash('owner').expect(200))).toEqual([]);
  });

  it('no modifica nada: consultar la papelera no restaura ni purga', async () => {
    const { stage } = await seedTrash();
    await trash('owner').expect(200);
    const [row] = await ctx.t.db.select().from(stages).where(eq(stages.id, stage.id));
    expect(row!.status).toBe('TRASHED');
    expect(row!.deletedAt).not.toBeNull();
  });
});
