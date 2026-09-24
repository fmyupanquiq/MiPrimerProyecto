import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBinaryAvailable, readManifest, writeManifest } from '../src/backups/backup-files.js';
import { BackupsService } from '../src/backups/backups.service.js';
import { MaintenanceModeService } from '../src/backups/maintenance-mode.service.js';
import { AppError } from '../src/common/app-error.js';
import { projects, type UserRow } from '../src/database/schema/index.js';
import { createTestApp, login, sessionCookie, type TestApp } from './support/create-app.js';
import { insertProject } from './support/factories.js';

type Actor = 'root' | 'owner' | 'stranger';

interface GenerationBody {
  id: string;
  status: 'COMPLETED' | 'FAILED';
  triggeredBy: 'SCHEDULED' | 'MANUAL';
  errorMessage: string | null;
}

/**
 * `pg_dump`/`pg_restore` deben estar en el `PATH` (D-B2, ADR 0016): en un entorno sin ellos, un
 * backup manual falla con status FAILED — lo cual sigue siendo un comportamiento probado y
 * correcto (nunca lanza una excepción sin manejar) — pero el volcado/restauración real de punta a
 * punta solo puede probarse donde esos binarios existen (describe separado al final del archivo).
 */
describe('backups y recuperación (e2e, PostgreSQL real, §37, §82, §109.3-4)', () => {
  let ctx: TestApp;
  let backups: BackupsService;
  let backupDir: string;
  const people = {} as Record<Actor, UserRow>;
  const cookies = {} as Record<Actor, string>;

  beforeAll(async () => {
    backupDir = `.data/test-backups-${randomUUID()}`;
    ctx = await createTestApp({ env: { BACKUP_DIR: backupDir } });
    backups = ctx.app.get(BackupsService);
  });
  afterAll(async () => {
    await ctx.close();
    await rm(backupDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await ctx.reset();
    await writeManifest(backupDir, []);
    ctx.clock.set('2026-06-01T12:00:00.000Z');
    people.root = await ctx.createUser({ email: 'root@example.com', globalRole: 'GLOBAL_ADMIN' });
    people.owner = await ctx.createUser({ email: 'owner@example.com' });
    people.stranger = await ctx.createUser({ email: 'stranger@example.com' });
    for (const [actor, user] of Object.entries(people)) {
      cookies[actor as Actor] = sessionCookie(await login(ctx.server, user.email).expect(200))!;
    }
  });

  const list = (actor: Actor) =>
    request(ctx.server).get('/api/admin/backups').set('Cookie', cookies[actor]);
  const create = (actor: Actor) =>
    request(ctx.server).post('/api/admin/backups').set('Cookie', cookies[actor]).send({});
  const restore = (actor: Actor, body: object) =>
    request(ctx.server).post('/api/admin/backups/restore').set('Cookie', cookies[actor]).send(body);

  describe('permisos (§37: solo el Administrador Global)', () => {
    it('list/create/restore responden 403 a quien no es Administrador Global', async () => {
      await list('owner').expect(403);
      await create('owner').expect(403);
      await restore('owner', { generationId: randomUUID(), confirmation: 'x' }).expect(403);
    });

    it('el Administrador Global puede listar y crear un backup manual', async () => {
      await list('root').expect(200);
      const created = (await create('root').expect(201)).body as GenerationBody;
      expect(created.triggeredBy).toBe('MANUAL');
    });
  });

  describe('manifiesto y estado (D-B3)', () => {
    it('un backup queda registrado en el manifiesto, complete o falle (nunca lanza sin manejar)', async () => {
      const created = (await create('root').expect(201)).body as GenerationBody;
      expect(['COMPLETED', 'FAILED']).toContain(created.status);
      if (created.status === 'FAILED') expect(created.errorMessage).toBeTruthy();

      const listed = (await list('root').expect(200)).body as GenerationBody[];
      expect(listed[0]!.id).toBe(created.id);
    });

    it('la restauración exige reautenticación (D-R1)', async () => {
      ctx.clock.advanceSeconds(6 * 60); // fuera del margen de reautenticación (5 min)
      const res = await restore('root', { generationId: randomUUID(), confirmation: 'x' });
      expect(res.status).toBe(403);
    });

    it('rechaza una generación inexistente', async () => {
      const res = await restore('root', { generationId: randomUUID(), confirmation: 'x' });
      expect(res.status).toBe(404);
    });

    it('exige que la confirmación coincida exactamente con la generación (D-R1)', async () => {
      const seedId = randomUUID();
      await writeManifest(backupDir, [
        {
          id: seedId,
          takenAt: '2026-06-01T12:00:00.000Z',
          triggeredBy: 'MANUAL',
          fileName: 'seed-1.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      const res = await restore('root', { generationId: seedId, confirmation: 'no-coincide' });
      expect(res.status).toBe(409);
    });
  });

  describe('rotación de generaciones (D-B4)', () => {
    it('conserva como mucho BACKUP_RETENTION_COUNT generaciones, borrando las más antiguas', async () => {
      const smallDir = `.data/test-backups-rotation-${randomUUID()}`;
      const small = await createTestApp({
        env: { BACKUP_DIR: smallDir, BACKUP_RETENTION_COUNT: '3' },
      });
      try {
        const smallBackups = small.app.get(BackupsService);
        for (let i = 0; i < 5; i++) {
          await smallBackups.createBackup('MANUAL');
        }
        const manifest = await readManifest(smallDir);
        expect(manifest).toHaveLength(3); // 5 creadas, retención de 3
      } finally {
        await small.close();
        await rm(smallDir, { recursive: true, force: true });
      }
    });
  });

  describe('maybeRunScheduledBackup (D-B1)', () => {
    it('no dispara antes de la hora configurada (por defecto, 03:00 UTC)', async () => {
      ctx.clock.set('2026-06-01T01:00:00.000Z');
      const result = await backups.maybeRunScheduledBackup();
      expect(result).toBeNull();
    });

    it('no dispara dos veces el mismo día calendario si ya hubo una COMPLETED', async () => {
      await writeManifest(backupDir, [
        {
          id: 'seed-today',
          takenAt: '2026-06-01T03:00:00.000Z',
          triggeredBy: 'SCHEDULED',
          fileName: 'seed-today.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      ctx.clock.set('2026-06-01T10:00:00.000Z');
      const result = await backups.maybeRunScheduledBackup();
      expect(result).toBeNull();
      expect(await readManifest(backupDir)).toHaveLength(1); // nada nuevo
    });

    it('dispara si ya pasó la hora configurada y no hay una COMPLETED ese día', async () => {
      ctx.clock.set('2026-06-02T04:00:00.000Z');
      const result = await backups.maybeRunScheduledBackup();
      expect(result).not.toBeNull();
      expect(result!.triggeredBy).toBe('SCHEDULED');
    });
  });

  describe('M2 (revisión de arquitectura): concurrencia en restore()', () => {
    // Llamadas directas al servicio (no HTTP): el `@RequireRecentAuth()` de la ruta pasa por su
    // propia consulta asíncrona antes de llegar al controlador, y con ella dos peticiones HTTP
    // casi simultáneas ya no garantizan solaparse justo en la sección crítica. Llamando al
    // servicio directamente, ambas promesas comparten el mismo primer `await` (leer el
    // manifiesto) y llegan a la comprobación de `restoreInProgress` de forma determinista.
    it('una segunda restauración simultánea se rechaza; no compiten dos pg_restore', async () => {
      const seedId = randomUUID();
      await writeManifest(backupDir, [
        {
          id: seedId,
          takenAt: '2026-06-01T12:00:00.000Z',
          triggeredBy: 'MANUAL',
          fileName: 'seed-1.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      const results = await Promise.allSettled([
        backups.restore(people.root, seedId, seedId),
        backups.restore(people.root, seedId, seedId),
      ]);
      const messages = results.map((r) =>
        r.status === 'rejected' && r.reason instanceof AppError
          ? (r.reason.getResponse() as { message: string }).message
          : undefined,
      );
      expect(messages).toContain('Ya hay una restauración en curso.');
    });

    it('el backup programado no compite con una restauración en curso', async () => {
      const seedId = randomUUID();
      await writeManifest(backupDir, [
        {
          id: seedId,
          takenAt: '2026-06-01T12:00:00.000Z',
          triggeredBy: 'MANUAL',
          fileName: 'seed-1.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      ctx.clock.set('2026-06-02T04:00:00.000Z'); // pasada la hora del backup programado
      // `restore()` toma el respaldo preventivo llamando a `createBackup` antes de restaurar.
      // Sin `pg_dump` en este entorno, esa llamada (y por tanto toda la restauración) termina en
      // milisegundos, así que un respiro con `setTimeout` no alcanza a "atrapar" con fiabilidad
      // la ventana en la que `restoreInProgress` sigue en `true`. Se intercepta esa llamada para
      // mantenerla en vilo el tiempo que haga falta, sin acoplar la prueba a más detalles internos.
      let releasePreventiveBackup!: () => void;
      const gate = new Promise<void>((resolve) => {
        releasePreventiveBackup = resolve;
      });
      const originalCreateBackup = backups.createBackup.bind(backups);
      const createBackupSpy = vi
        .spyOn(backups, 'createBackup')
        .mockImplementationOnce(async (triggeredBy) => {
          await gate;
          return originalCreateBackup(triggeredBy);
        });
      try {
        const restorePromise = backups.restore(people.root, seedId, seedId).catch(() => undefined);
        // Deja que `restore()` corra hasta quedar bloqueada dentro del respaldo preventivo
        // interceptado, con `restoreInProgress` ya en `true`. Al estar la interceptación
        // bloqueada indefinidamente (hasta `releasePreventiveBackup()`), no hay carrera: solo
        // hace falta un respiro real para dejar pasar la lectura del manifiesto (E/S real).
        await new Promise((resolve) => setTimeout(resolve, 20));
        const scheduled = await backups.maybeRunScheduledBackup();
        // Mientras la restauración estuvo en curso, el programado no debió disparar nada.
        expect(scheduled).toBeNull();
        releasePreventiveBackup();
        await restorePromise;
      } finally {
        createBackupSpy.mockRestore();
      }
    });
  });

  describe('M3 (revisión de arquitectura): modo mantenimiento durante una restauración', () => {
    it('activo, rechaza otras peticiones con 503, salvo /health; siempre se desactiva al terminar', async () => {
      const maintenanceMode = ctx.app.get(MaintenanceModeService);
      expect(maintenanceMode.isActive()).toBe(false);

      maintenanceMode.activate();
      try {
        const blocked = await list('root');
        expect(blocked.status).toBe(503);
        expect((blocked.body as { code?: string }).code).toBe('SERVICE_UNAVAILABLE');

        const health = await request(ctx.server).get('/api/health');
        expect(health.status).not.toBe(503);
      } finally {
        maintenanceMode.deactivate();
      }
      expect((await list('root')).status).toBe(200); // vuelve a la normalidad

      // La propia restore() lo desactiva siempre, incluso si pg_restore falla (sin pg_dump aquí).
      const seedId = randomUUID();
      await writeManifest(backupDir, [
        {
          id: seedId,
          takenAt: '2026-06-01T12:00:00.000Z',
          triggeredBy: 'MANUAL',
          fileName: 'seed-1.dump',
          sizeBytes: 10,
          checksum: 'abc',
          ticketsFileName: null,
          ticketsSizeBytes: null,
          ticketsChecksum: null,
          status: 'COMPLETED',
          errorMessage: null,
        },
      ]);
      await backups.restore(people.root, seedId, seedId).catch(() => undefined);
      expect(maintenanceMode.isActive()).toBe(false);
    });
  });
});

describe.runIf(await isBinaryAvailable('pg_dump'))(
  'backups: volcado y restauración reales (requiere pg_dump/pg_restore en PATH)',
  () => {
    let ctx: TestApp;
    let backups: BackupsService;
    let backupDir: string;
    let ticketsDir: string;
    let cookie: string;

    beforeAll(async () => {
      backupDir = `.data/test-backups-real-${randomUUID()}`;
      ticketsDir = `.data/test-tickets-real-${randomUUID()}`;
      ctx = await createTestApp({ env: { BACKUP_DIR: backupDir, TICKETS_DIR: ticketsDir } });
      backups = ctx.app.get(BackupsService);
    });
    afterAll(async () => {
      await ctx.close();
      await rm(backupDir, { recursive: true, force: true });
      await rm(ticketsDir, { recursive: true, force: true });
    });
    // `ctx.reset()` trunca toda la base (incluidos usuarios y sesiones): la persona
    // administradora se crea aquí, no en `beforeAll`, o quedaría borrada en el primer reset.
    beforeEach(async () => {
      await ctx.reset();
      await writeManifest(backupDir, []);
      const admin = await ctx.createUser({
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
      });
      cookie = sessionCookie(await login(ctx.server, admin.email).expect(200))!;
    });

    it('crea un volcado completo, restaurable, con checksum y tamaño correctos', async () => {
      const generation = await backups.createBackup('MANUAL');
      expect(generation.status).toBe('COMPLETED');
      expect(generation.sizeBytes).toBeGreaterThan(0);
      expect(generation.checksum).toMatch(/^[0-9a-f]{64}$/);
      // §110.1: ninguna generación queda completa sin su archivo de tickets (requiere también
      // `tar`, disponible en este entorno de pruebas — a diferencia de `pg_dump`/`pg_restore`).
      expect(generation.ticketsFileName).not.toBeNull();
      expect(generation.ticketsChecksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('round-trip completo: respalda, cambia datos, restaura y confirma que vuelven', async () => {
      const owner = await ctx.createUser({ email: 'owner-rt@example.com' });
      await insertProject(ctx.t.db, { owner, name: 'Antes de restaurar' });
      // §110.1: un archivo de ticket presente antes del backup debe sobrevivir a la
      // restauración; uno creado después no.
      await mkdir(join(ticketsDir, 'proj-1'), { recursive: true });
      await writeFile(join(ticketsDir, 'proj-1', 'antes.jpg'), 'antes-del-backup');

      const generation = await backups.createBackup('MANUAL');
      expect(generation.status).toBe('COMPLETED');

      // Cambia el estado tras el backup.
      await insertProject(ctx.t.db, { owner, name: 'Creado después del backup' });
      await writeFile(join(ticketsDir, 'proj-1', 'despues.jpg'), 'despues-del-backup');

      const restored = await request(ctx.server)
        .post('/api/admin/backups/restore')
        .set('Cookie', cookie)
        .send({ generationId: generation.id, confirmation: generation.id })
        .expect(200);
      expect((restored.body as GenerationBody).id).toBe(generation.id);

      const projectRows = await ctx.t.db.select({ name: projects.name }).from(projects);
      const projectNames = projectRows.map((p) => p.name);
      expect(projectNames).toContain('Antes de restaurar');
      expect(projectNames).not.toContain('Creado después del backup');

      const antes = await readFile(join(ticketsDir, 'proj-1', 'antes.jpg'), 'utf-8');
      expect(antes).toBe('antes-del-backup');
      await expect(readFile(join(ticketsDir, 'proj-1', 'despues.jpg'))).rejects.toThrow();
    });
  },
);
