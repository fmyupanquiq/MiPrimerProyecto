import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  bets,
  financialMovements,
  rolePermissions,
  roles,
  ticketAnalyses,
  type UserRow,
} from '../src/database/schema/index.js';
import { bodyOf, createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertMember, insertProject } from './support/factories.js';

const GENERIC_READ_ERROR = 'No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.';

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
      // El detalle real se conserva solo en la base de datos (auditoría); la API devuelve el genérico.
      expect(history[0]!.errorMessage).toBe(GENERIC_READ_ERROR);
      const [stored] = await ctx.t.db
        .select()
        .from(ticketAnalyses)
        .where(eq(ticketAnalyses.ticketId, uploaded.id));
      expect(stored!.errorMessage).toContain('proveedor caído');
    });

    describe('errorMessage nunca expone detalles técnicos a los miembros del proyecto', () => {
      // Texto que un error real del SDK/proveedor podría arrastrar: nada de esto debe salir de la API.
      const leaky = [
        '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CSECRET"}',
        'key=sk-ant-api03-CLAVE-SECRETA',
        'DATABASE_URL=postgres://letfer:clave-db@127.0.0.1:5432/letfer_prod',
        'prompt: Registra los datos leídos de la imagen o PDF de un ticket',
        'at AnthropicTicketReader.analyze (C:/app/dist/ai/anthropic-ticket-reader.service.js:176:9)',
      ].join(' | ');
      const forbidden = [
        'sk-ant-',
        'x-api-key',
        'authentication_error',
        'DATABASE_URL',
        'postgres://',
        'clave-db',
        'req_011CSECRET',
        'Registra los datos leídos',
        'AnthropicTicketReader',
        '.service.js',
      ];
      const expectNoLeak = (value: unknown) => {
        const text = JSON.stringify(value);
        for (const fragment of forbidden) expect(text).not.toContain(fragment);
      };

      it('ni el historial, ni la respuesta del análisis, ni el detalle de la apuesta', async () => {
        const uploaded = bodyOf(
          await upload('collab', JPEG_BYTES, 'ticket.jpg'),
        ) as unknown as TicketBody;
        ctx.ticketReader.failNext(leaky);
        const failed = await analyze('collab', uploaded.id);
        expect(failed.status).toBe(502);
        expectNoLeak(failed.body);

        // Lector y Colaborador (ambos con tickets.view) ven solo el mensaje genérico.
        for (const actor of ['collab', 'reader', 'owner'] as const) {
          const history = bodyOf(
            await analyses(actor, uploaded.id).expect(200),
          ) as unknown as AnalysisBody[];
          expect(history[0]!.status).toBe('FAILED');
          expect(history[0]!.errorMessage).toBe(GENERIC_READ_ERROR);
          expectNoLeak(history);
        }

        // También por el camino del detalle de apuesta (`ticketsForBets` → `lastAnalysis`).
        const bet = bodyOf(
          await createBet('collab', {
            houseId,
            stageId,
            stake: '1.00',
            visibleTotalOdds: '1.95',
            placedAt: '2026-06-01T10:00:00.000Z',
            selections: [simpleSelection],
            ticketId: uploaded.id,
          }).expect(201),
        ) as unknown as BetBody;
        const detail = await request(ctx.server)
          .get(`/api/projects/${projectId}/bets/${bet.id}`)
          .set('Cookie', cookies.reader)
          .expect(200);
        expectNoLeak(detail.body);
        expect(
          (detail.body as { tickets: TicketBody[] }).tickets[0]!.lastAnalysis!.errorMessage,
        ).toBe(GENERIC_READ_ERROR);

        // El detalle técnico no se pierde: queda en la base para auditoría.
        const [stored] = await ctx.t.db
          .select()
          .from(ticketAnalyses)
          .where(eq(ticketAnalyses.ticketId, uploaded.id));
        expect(stored!.errorMessage).toContain('sk-ant-api03-CLAVE-SECRETA');
      });

      it('un análisis exitoso sigue mostrando sus datos y no lleva errorMessage', async () => {
        const uploaded = bodyOf(
          await upload('collab', JPEG_BYTES, 'ticket.jpg'),
        ) as unknown as TicketBody;
        ctx.ticketReader.enqueue({
          extraction: { house: 'Betano', officialAmount: '25.00' },
          confidenceByField: { house: 0.95 },
        });
        await analyze('collab', uploaded.id).expect(200);
        const history = bodyOf(
          await analyses('reader', uploaded.id).expect(200),
        ) as unknown as AnalysisBody[];
        expect(history[0]!.status).toBe('COMPLETED');
        expect(history[0]!.errorMessage).toBeNull();
        expect(history[0]!.extraction).toEqual({ house: 'Betano', officialAmount: '25.00' });
        expect(history[0]!.confidenceByField).toEqual({ house: 0.95 });
      });
    });

    describe('validación de la respuesta de la IA (barrera antes de persistir)', () => {
      const secret = 'VALOR-DEL-TICKET-QUE-NO-DEBE-FILTRARSE';

      it.each([
        ['tipo incorrecto', { officialAmount: 25 }, 'officialAmount: WRONG_TYPE'],
        ['enum inválido', { betType: 'PARLAY' }, 'betType: INVALID_ENUM'],
        ['dinero imposible', { officialAmount: secret }, 'officialAmount: INVALID_MONEY'],
        ['fecha imposible', { placedDate: '2026-02-30' }, 'placedDate: INVALID_DATE'],
        [
          'datos incoherentes',
          {
            betType: 'SIMPLE',
            selections: [{ event: 'A vs B', selection: 'A', visibleOdds: '1.95' }],
            officialTotalOdds: '2.50',
          },
          'officialTotalOdds: ODDS_MISMATCH',
        ],
      ])(
        '%s: se registra como FAILED, sin extracción, apuesta ni movimientos',
        async (_n, bad, code) => {
          const uploaded = bodyOf(
            await upload('collab', JPEG_BYTES, 'ticket.jpg'),
          ) as unknown as TicketBody;
          const betsBefore = (await ctx.t.db.select().from(bets)).length;
          const movementsBefore = (await ctx.t.db.select().from(financialMovements)).length;

          ctx.ticketReader.enqueue({ extraction: bad as never, confidenceByField: null });
          const res = await analyze('collab', uploaded.id);

          expect(res.status).toBe(502);
          const text = JSON.stringify(res.body);
          // Respuesta genérica: ni códigos internos, ni el valor del ticket, ni detalles del proveedor.
          expect((res.body as { message: string }).message).toBe(
            'No pudimos leer el ticket. Revisa la imagen e inténtalo nuevamente.',
          );
          expect(text).not.toContain(secret);
          expect(text).not.toContain('INVALID_');

          const history = bodyOf(
            await analyses('collab', uploaded.id).expect(200),
          ) as unknown as AnalysisBody[];
          expect(history).toHaveLength(1);
          expect(history[0]!.status).toBe('FAILED');
          expect(history[0]!.extraction).toEqual({});
          expect(history[0]!.confidenceByField).toBeNull();
          // Al cliente, solo el genérico; el detalle (ruta: código, sin valores) queda en la base.
          expect(history[0]!.errorMessage).toBe(GENERIC_READ_ERROR);
          const [stored] = await ctx.t.db
            .select()
            .from(ticketAnalyses)
            .where(eq(ticketAnalyses.ticketId, uploaded.id));
          expect(stored!.errorMessage).toContain(code);
          expect(stored!.errorMessage).not.toContain(secret);

          expect((await ctx.t.db.select().from(bets)).length).toBe(betsBefore);
          expect((await ctx.t.db.select().from(financialMovements)).length).toBe(movementsBefore);
        },
      );

      it('una confianza inválida invalida también la respuesta', async () => {
        const uploaded = bodyOf(
          await upload('collab', JPEG_BYTES, 'ticket.jpg'),
        ) as unknown as TicketBody;
        ctx.ticketReader.enqueue({
          extraction: { house: 'Betano' },
          confidenceByField: { house: 7 },
        });
        await analyze('collab', uploaded.id).expect(502);
        const history = bodyOf(
          await analyses('collab', uploaded.id).expect(200),
        ) as unknown as AnalysisBody[];
        expect(history[0]!.status).toBe('FAILED');
      });

      it('tras una respuesta inválida, un reintento válido queda como versión 2 (el fallo cuenta)', async () => {
        const uploaded = bodyOf(
          await upload('collab', JPEG_BYTES, 'ticket.jpg'),
        ) as unknown as TicketBody;
        ctx.ticketReader.enqueue({ extraction: { betType: 'X' } });
        await analyze('collab', uploaded.id).expect(502);
        // Un reintento posterior con una respuesta válida sigue funcionando (versión 2).
        ctx.ticketReader.enqueue({ extraction: { house: 'Betano' } });
        const ok = bodyOf(
          await analyze('collab', uploaded.id).expect(200),
        ) as unknown as AnalysisBody;
        expect(ok.status).toBe('COMPLETED');
        expect(ok.version).toBe(2);
      });

      it('los campos extra no se persisten, pero la respuesta válida se acepta', async () => {
        const uploaded = bodyOf(
          await upload('collab', JPEG_BYTES, 'ticket.jpg'),
        ) as unknown as TicketBody;
        ctx.ticketReader.enqueue({
          extraction: { house: 'Betano', registrarApuesta: true } as never,
        });
        const body = bodyOf(
          await analyze('collab', uploaded.id).expect(200),
        ) as unknown as AnalysisBody;
        expect(body.extraction).toEqual({ house: 'Betano' });
      });
    });

    it('con la IA desactivada o sin clave responde de forma controlada, sin registrar intento', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      ctx.ticketReader.unavailableNext();
      const res = await analyze('collab', uploaded.id);
      expect(res.status).toBe(409);
      const { message } = res.body as { message: string };
      expect(message).toContain('no está disponible');
      expect(message).not.toContain('ANTHROPIC_API_KEY');
      const history = bodyOf(
        await analyses('collab', uploaded.id).expect(200),
      ) as unknown as AnalysisBody[];
      expect(history).toHaveLength(0);
    });

    // §9, §28, §29: el detalle técnico del proveedor (SDK de Anthropic, red) nunca llega al
    // cliente; solo queda en `ticket_analyses.errorMessage` (arriba) y en el log del servidor.
    it('el error que ve el cliente es genérico, sin el detalle técnico del proveedor', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      ctx.ticketReader.failNext(
        '401 {"type":"authentication_error","message":"invalid x-api-key"}',
      );
      const res = await analyze('collab', uploaded.id);
      expect(res.status).toBe(502);
      const { message } = res.body as { message: string };
      expect(message).not.toContain('x-api-key');
      expect(message).not.toContain('authentication_error');
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

    it('la lista de apuestas indica cuántos tickets tiene cada una, sin cargar el detalle', async () => {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'ticket.jpg'),
      ) as unknown as TicketBody;
      const base = {
        houseId,
        stageId,
        stake: '1.00',
        visibleTotalOdds: '1.95',
        placedAt: '2026-06-01T10:00:00.000Z',
        selections: [simpleSelection],
      };
      const withTicket = bodyOf(
        await createBet('collab', { ...base, ticketId: uploaded.id }).expect(201),
      ) as unknown as BetBody;
      const withoutTicket = bodyOf(
        await createBet('collab', base).expect(201),
      ) as unknown as BetBody;
      const list = (
        await request(ctx.server)
          .get(`/api/projects/${projectId}/bets`)
          .set('Cookie', cookies.collab)
          .expect(200)
      ).body as { id: string; ticketCount: number }[];
      expect(list.find((b) => b.id === withTicket.id)!.ticketCount).toBe(1);
      expect(list.find((b) => b.id === withoutTicket.id)!.ticketCount).toBe(0);
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
  describe('el detalle de apuesta respeta tickets.view en el backend', () => {
    async function betWithTicket(): Promise<{ betId: string; ticketId: string }> {
      const uploaded = bodyOf(
        await upload('collab', JPEG_BYTES, 'mi-ticket-secreto.jpg').expect(201),
      ) as unknown as TicketBody;
      const bet = bodyOf(
        await createBet('collab', {
          houseId,
          stageId,
          stake: '1.00',
          visibleTotalOdds: '1.95',
          placedAt: '2026-06-01T10:00:00.000Z',
          selections: [simpleSelection],
          ticketId: uploaded.id,
        }).expect(201),
      ) as unknown as BetBody;
      return { betId: bet.id, ticketId: uploaded.id };
    }
    const detailAs = (actor: Actor, betId: string) =>
      request(ctx.server)
        .get(`/api/projects/${projectId}/bets/${betId}`)
        .set('Cookie', cookies[actor]);

    it('con tickets.view el detalle incluye el ticket; sin él, ni imagen, ni nombre de archivo, ni análisis', async () => {
      const { betId, ticketId } = await betWithTicket();
      expect(((await detailAs('reader', betId).expect(200)).body as BetBody).tickets).toHaveLength(
        1,
      );

      // Un rol con bets.view pero sin tickets.view (p. ej. uno personalizado).
      const [reader] = await ctx.t.db.select().from(roles).where(eq(roles.key, 'READER'));
      await ctx.t.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, reader!.id),
            eq(rolePermissions.permissionCode, 'tickets.view'),
          ),
        );

      const hidden = await detailAs('reader', betId).expect(200);
      expect((hidden.body as BetBody).tickets).toEqual([]);
      const text = JSON.stringify(hidden.body);
      expect(text).not.toContain('mi-ticket-secreto');
      expect(text).not.toContain(ticketId);
      // La imagen tampoco se sirve por el endpoint de tickets.
      await getFile('reader', ticketId).expect(403);
      // Quien sí tiene el permiso sigue viéndolo, y la apuesta en sí no cambió.
      expect(((await detailAs('collab', betId).expect(200)).body as BetBody).tickets).toHaveLength(
        1,
      );
    });

    it('las respuestas de crear y editar tampoco filtran tickets a quien no tiene tickets.view', async () => {
      const [reader] = await ctx.t.db.select().from(roles).where(eq(roles.key, 'READER'));
      await ctx.t.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, reader!.id),
            eq(rolePermissions.permissionCode, 'tickets.view'),
          ),
        );
      const { betId } = await betWithTicket();
      // El Colaborador conserva tickets.view y ve el ticket en su propia respuesta.
      expect(((await detailAs('collab', betId).expect(200)).body as BetBody).tickets).toHaveLength(
        1,
      );
      expect(((await detailAs('reader', betId).expect(200)).body as BetBody).tickets).toEqual([]);
    });
  });
});
