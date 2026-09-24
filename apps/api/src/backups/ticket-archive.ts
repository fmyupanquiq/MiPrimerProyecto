import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureSecureDir, secureFile } from '../common/fs-security.js';
import { run, type RunResult } from './backup-files.js';

/**
 * Empaqueta/restaura `TICKETS_DIR` con `tar` (§110.1, ADR 0017): segundo binario externo
 * requerido, igual que `pg_dump`/`pg_restore` (D-B2), pero mucho más disponible por defecto
 * (Linux, macOS y Windows 10+ lo traen preinstalado).
 */

/** Empaqueta el contenido de `ticketsDir` (no la carpeta en sí) en `tarPath`, comprimido. */
export async function archiveTickets(
  tarPath: string,
  ticketsDir: string,
  tarBinary: string,
): Promise<RunResult> {
  await ensureSecureDir(ticketsDir);
  const result = await run(tarBinary, ['-czf', tarPath, '-C', ticketsDir, '.'], process.env);
  if (result.code === 0) await secureFile(tarPath);
  return result;
}

/**
 * Reemplaza el contenido de `ticketsDir` por el de `tarPath` (mismo espíritu que `--clean` en
 * `pg_restore`, §110.1): borra lo que hubiera antes de extraer, para que los archivos en disco
 * queden consistentes con la fotografía que se está restaurando, no mezclados con lo subido
 * después del backup.
 */
export async function restoreTickets(
  tarPath: string,
  ticketsDir: string,
  tarBinary: string,
): Promise<RunResult> {
  await ensureSecureDir(ticketsDir);
  const entries = await readdir(ticketsDir).catch(() => []);
  for (const entry of entries) {
    await rm(join(ticketsDir, entry), { recursive: true, force: true });
  }
  return run(tarBinary, ['-xzf', tarPath, '-C', ticketsDir], process.env);
}

export function ticketsArchivePath(dir: string, fileName: string): string {
  return join(dir, fileName);
}
