import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserRow } from '../src/database/schema/index.js';
import { bodyOf, createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'admin' | 'collab' | 'reader' | 'stranger';

interface TicketBody {
  id: string;
  projectId: string;
  betId: string | null;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { id: string; name: string };
  lastAnalysis: AnalysisBody | null;
}
interface AnalysisBody {
  id: string;
  ticketId: string;
  version: number;
  status: string;
  provider: string;
  model: string;
  extraction: Record<string, unknown>;
  confidenceByField: Record<string, number> | null;
  errorMessage: string | null;
}
interface BetBody {
  id: string;
  tickets?: TicketBody[];
}

// Solo hace falta que los primeros bytes coincidan con la firma real de cada formato (§97,
// mime-sniff.ts): el resto del contenido es arbitrario para las pruebas.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n%contenido de prueba');

describe('tickets e IA (e2e, PostgreSQL real, §28-§31, §110)', () => {
  let ctx: TestApp;
  let ticketsDir: string;
  let projectId: string;
  let otherProjectId: string;
  let stageId: string;
  let houseId: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    ticketsDir = `.data/test-tickets-${randomUUID()}`;
    ctx = await createTestApp({ env: { TICKETS_DIR: ticketsDir } });
  });
  afterAll(async () => {
    await ctx.close();
    await rm(ticketsDir, { recursive: true, force: true });
  });

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
    await request(ctx.server)
      .post(`/api/projects/${projectId}/setup`)
      .set('Cookie', cookies.owner)
      .send({ unitStake: '10.00', houses: [{ name: 'Betano', initialAmount: '500.00' }] })
      .expect(201);
    const houseList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/houses`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as { id: string }[];
    houseId = houseList[0]!.id;
    const stageList = (
      await request(ctx.server)
        .get(`/api/projects/${projectId}/stages`)
        .set('Cookie', cookies.owner)
        .expect(200)
    ).body as { id: string }[];
    stageId = stageList[0]!.id;

    const { project: other } = await insertProject(ctx.t.db, { owner: people.root, name: 'Otro' });
    otherProjectId = other.id;
    await request(ctx.server)
      .post(`/api/projects/${otherProjectId}/setup`)
      .set('Cookie', cookies.root)
      .send({ unitStake: '5.00', houses: [{ name: 'Casa2', initialAmount: '100.00' }] })
      .expect(201);
  });

  const upload = (actor: Actor, fileBytes: Buffer, fileName: string, projId = projectId) =>
    request(ctx.server)
      .post(`/api/projects/${projId}/tickets`)
      .set('Cookie', cookies[actor])
      .attach('file', fileBytes, fileName);
  const getFile = (actor: Actor, ticketId: string, projId = projectId) =>
    request(ctx.server)
      .get(`/api/projects/${projId}/tickets/${ticketId}/file`)
      .set('Cookie', cookies[actor]);
  const analyze = (actor: Actor, ticketId: string, projId = projectId) =>
    request(ctx.server)
      .post(`/api/projects/${projId}/tickets/${ticketId}/analyze`)
      .set('Cookie', cookies[actor]);
  const analyses = (actor: Actor, ticketId: string, projId = projectId) =>
    request(ctx.server)
      .get(`/api/projects/${projId}/tickets/${ticketId}/analyses`)
      .set('Cookie', cookies[actor]);
  const createBet = (actor: Actor, body: object, projId = projectId) =>
    request(ctx.server)
      .post(`/api/projects/${projId}/bets`)
      .set('Cookie', cookies[actor])
      .send(body);
  const simpleSelection = {
    eventGroup: 0,
    position: 0,
    event: 'Real Madrid vs. Barcelona',
    selection: 'Real Madrid gana',
    visibleOdds: '1.95',
  };

  describe('subida (§28, D-T3)', () => {
    it('acepta JPG/PNG/PDF y guarda tamaño y checksum', async () => {
      const res = await upload('collab', JPEG_BYTES, 'ticket.jpg').expect(201);
      const body = bodyOf(res) as unknown as TicketBody;
      expect(body.mimeType).toBe('image/jpeg');
      expect(body.sizeBytes).toBe(JPEG_BYTES.byteLength);
      expect(body.betId).toBeNull();
      expect(body.uploadedBy.id).toBe(people.collab.id);

      const png = await upload('collab', PNG_BYTES, 'ticket.png').expect(201);
      expect((bodyOf(png) as unknown as TicketBody).mimeType).toBe('image/png');
      const pdf = await upload('collab', PDF_BYTES, 'ticket.pdf').expect(201);
      expect((bodyOf(pdf) as unknown as TicketBody).mimeType).toBe('application/pdf');
    });

    it('rechaza una extensión no admitida', async () => {
      const res = await upload('collab', JPEG_BYTES, 'ticket.gif');
      expect(res.status).toBe(400);
    });

    it('rechaza un archivo cuyo contenido no coincide con su extensión (D-T3, §97)', async () => {
      // Se declara ".png" pero el contenido real son bytes de JPEG.
      const res = await upload('collab', JPEG_BYTES, 'disfrazado.png');
      expect(res.status).toBe(400);
    });

    it('sin archivo adjunto responde con un error de validación', async () => {
      const res = await request(ctx.server)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Cookie', cookies.collab);
      expect(res.status).toBe(400);
    });

    it('el Lector no puede subir tickets (tickets.upload, §110.6)', async () => {
      const res = await upload('reader', JPEG_BYTES, 'ticket.jpg');
      expect(res.status).toBe(403);
    });

    it('quien no tiene acceso al proyecto recibe 404, no 403', async () => {
      const res = await upload('stranger', JPEG_BYTES, 'ticket.jpg');
      expect(res.status).toBe(404);
    });
  });

  describe('servir el archivo (§42: nunca una URL pública)', () => {
    it('un miembro del proyecto puede descargarlo tal cual se subió', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      const res = await getFile('owner', uploaded.id).expect(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.compare(res.body as Buffer, JPEG_BYTES)).toBe(0);
    });

    it('el Lector puede verlo (tickets.view)', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      await getFile('reader', uploaded.id).expect(200);
    });

    it('un ticket de otro proyecto responde 404, aunque el id exista', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      const res = await getFile('root', uploaded.id, otherProjectId);
      expect(res.status).toBe(404);
    });
  });

  describe('análisis por IA (D-T4 a D-T6, §110.3, §110.4)', () => {
    it('devuelve la propuesta encolada, incluida la confianza por campo', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      ctx.ticketReader.enqueue({
        extraction: { house: 'Betano', officialAmount: '25.00' },
        confidenceByField: { house: 0.95, officialAmount: 0.4 },
      });
      const res = await analyze('collab', uploaded.id).expect(200);
      const body = bodyOf(res) as unknown as AnalysisBody;
      expect(body.status).toBe('COMPLETED');
      expect(body.version).toBe(1);
      expect(body.extraction).toEqual({ house: 'Betano', officialAmount: '25.00' });
      expect(body.confidenceByField).toEqual({ house: 0.95, officialAmount: 0.4 });
      expect(ctx.ticketReader.calls).toHaveLength(1);
    });

    it('un segundo análisis del mismo ticket queda como versión 2, y el histórico lista ambos', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      await analyze('collab', uploaded.id).expect(200);
      await analyze('collab', uploaded.id).expect(200);
      const history = bodyOf(
        await analyses('collab', uploaded.id).expect(200),
      ) as unknown as AnalysisBody[];
      expect(history.map((a) => a.version).sort()).toEqual([1, 2]);
    });

    it('un fallo del proveedor se registra como FAILED y responde con error', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      ctx.ticketReader.failNext('proveedor caído');
      const res = await analyze('collab', uploaded.id);
      expect(res.status).toBe(502);
      const history = bodyOf(
        await analyses('collab', uploaded.id).expect(200),
      ) as unknown as AnalysisBody[];
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe('FAILED');
      expect(history[0]!.errorMessage).toContain('proveedor caído');
    });

    it('el Lector no puede analizar (tickets.analyze, §110.6)', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      const res = await analyze('reader', uploaded.id);
      expect(res.status).toBe(403);
    });
  });

  describe('límite de análisis IA (§110.4)', () => {
    let limited: TestApp;
    let limitedTicketsDir: string;

    beforeAll(async () => {
      limitedTicketsDir = `.data/test-tickets-limit-${randomUUID()}`;
      limited = await createTestApp({
        env: {
          TICKETS_DIR: limitedTicketsDir,
          AI_MAX_ANALYSES_PER_TICKET: '2',
          AI_MAX_ANALYSES_PER_PROJECT_DAY: '3',
        },
      });
    });
    afterAll(async () => {
      await limited.close();
      await rm(limitedTicketsDir, { recursive: true, force: true });
    });

    it('rechaza el análisis número 3 de un mismo ticket con 429', async () => {
      await limited.reset();
      const owner = await limited.createUser({ email: 'owner@example.com' });
      const { project } = await insertProject(limited.t.db, { owner, name: 'Límite' });
      await request(limited.server)
        .post(`/api/projects/${project.id}/setup`)
        .set('Cookie', sessionCookie(await login(limited.server, owner.email).expect(200))!)
        .send({ unitStake: '10.00', houses: [{ name: 'Casa', initialAmount: '100.00' }] })
        .expect(201);
      const cookie = sessionCookie(await login(limited.server, owner.email).expect(200))!;
      const uploaded = bodyOf(
        await request(limited.server)
          .post(`/api/projects/${project.id}/tickets`)
          .set('Cookie', cookie)
          .attach('file', JPEG_BYTES, 'ticket.jpg')
          .expect(201),
      ) as unknown as TicketBody;

      const analyzeOnce = () =>
        request(limited.server)
          .post(`/api/projects/${project.id}/tickets/${uploaded.id}/analyze`)
          .set('Cookie', cookie);
      await analyzeOnce().expect(200);
      await analyzeOnce().expect(200);
      const third = await analyzeOnce();
      expect(third.status).toBe(429);
      expect((bodyOf(third) as unknown as { code: string }).code).toBe('RATE_LIMITED');
    });
  });

  describe('vinculación con una apuesta (§110.3, sin vía financiera paralela)', () => {
    it('crear una apuesta con ticketId la vincula dentro de la misma transacción', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      const res = await createBet('collab', {
        houseId,
        stageId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T10:00:00.000Z',
        selections: [simpleSelection],
        ticketId: uploaded.id,
      }).expect(201);
      const bet = bodyOf(res) as unknown as BetBody;
      expect(bet.tickets).toHaveLength(1);
      expect(bet.tickets![0]!.id).toBe(uploaded.id);
    });

    it('vincular un ticket ya vinculado a otra apuesta falla con 409', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      await createBet('collab', {
        houseId,
        stageId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T10:00:00.000Z',
        selections: [simpleSelection],
        ticketId: uploaded.id,
      }).expect(201);
      const res = await createBet('collab', {
        houseId,
        stageId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T10:00:00.000Z',
        selections: [simpleSelection],
        ticketId: uploaded.id,
      });
      expect(res.status).toBe(409);
    });

    it('vincular un ticket de otro proyecto falla con 404', async () => {
      const uploaded = bodyOf(
        await upload('root', JPEG_BYTES, 'ticket.jpg', otherProjectId),
      ) as unknown as TicketBody;
      const res = await createBet('collab', {
        houseId,
        stageId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T10:00:00.000Z',
        selections: [simpleSelection],
        ticketId: uploaded.id,
      });
      expect(res.status).toBe(404);
    });
  });
});
