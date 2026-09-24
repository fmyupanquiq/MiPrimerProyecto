import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBinaryAvailable } from './backup-files.js';
import { archiveTickets, restoreTickets } from './ticket-archive.js';

/**
 * Empaquetado/restauración de `TICKETS_DIR` con `tar` (§110.1, ADR 0017), probado de forma
 * independiente de `pg_dump`/`pg_restore`: a diferencia de esos binarios (ADR 0016, no
 * garantizados en todos los entornos), `tar` viene preinstalado en Linux, macOS y Windows 10+,
 * así que este round-trip real sí puede probarse aquí incluso cuando el de PostgreSQL se omite.
 */
describe.runIf(await isBinaryAvailable('tar'))(
  'archiveTickets/restoreTickets (§110.1, requiere tar en PATH)',
  () => {
    it('empaqueta el contenido de un directorio y lo restaura con los mismos archivos', async () => {
      const ticketsDir = `.data/test-tickets-${randomUUID()}`;
      const backupDir = `.data/test-tickets-backup-${randomUUID()}`;
      try {
        await mkdir(join(ticketsDir, 'proj-1'), { recursive: true });
        await writeFile(join(ticketsDir, 'proj-1', 'a.jpg'), 'contenido-a');
        await writeFile(join(ticketsDir, 'proj-1', 'b.pdf'), 'contenido-b');
        await mkdir(backupDir, { recursive: true });

        const tarPath = join(backupDir, 'tickets.tar.gz');
        const archiveResult = await archiveTickets(tarPath, ticketsDir, 'tar');
        expect(archiveResult.code).toBe(0);

        // Simula que, desde el backup, se subió un ticket nuevo y se perdió el directorio.
        await writeFile(join(ticketsDir, 'proj-1', 'c-posterior.jpg'), 'no debe sobrevivir');
        await rm(join(ticketsDir, 'proj-1', 'a.jpg'));

        const restoreResult = await restoreTickets(tarPath, ticketsDir, 'tar');
        expect(restoreResult.code).toBe(0);

        const a = await readFile(join(ticketsDir, 'proj-1', 'a.jpg'), 'utf-8');
        const b = await readFile(join(ticketsDir, 'proj-1', 'b.pdf'), 'utf-8');
        expect(a).toBe('contenido-a');
        expect(b).toBe('contenido-b');
        // La restauración reemplaza el contenido (mismo espíritu que `pg_restore --clean`,
        // §110.1): lo subido después del backup no sobrevive.
        await expect(readFile(join(ticketsDir, 'proj-1', 'c-posterior.jpg'))).rejects.toThrow();
      } finally {
        await rm(ticketsDir, { recursive: true, force: true });
        await rm(backupDir, { recursive: true, force: true });
      }
    });

    it('empaqueta un directorio de tickets vacío sin fallar (proyecto sin tickets aún)', async () => {
      const ticketsDir = `.data/test-tickets-empty-${randomUUID()}`;
      const backupDir = `.data/test-tickets-empty-backup-${randomUUID()}`;
      try {
        const tarPath = join(backupDir, 'tickets.tar.gz');
        await mkdir(backupDir, { recursive: true });
        const result = await archiveTickets(tarPath, ticketsDir, 'tar');
        expect(result.code).toBe(0);
      } finally {
        await rm(ticketsDir, { recursive: true, force: true });
        await rm(backupDir, { recursive: true, force: true });
      }
    });
  },
);
