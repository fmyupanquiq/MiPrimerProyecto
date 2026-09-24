import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupGeneration } from '@letfer/shared';
import { ensureSecureDir, PRIVATE_FILE_MODE, secureFile } from '../common/fs-security.js';

/**
 * Manifiesto de backups (D-B3, §109.3): vive como archivo junto a los propios volcados, fuera
 * de PostgreSQL, para que la lista de sus propios backups no se pierda si la base de datos se
 * pierde. Este módulo es el único que lo lee y lo escribe.
 *
 * H2 (revisión de arquitectura de la Fase 5.5): un volcado de `pg_dump` contiene la base de
 * datos completa —hashes de contraseña, hashes de token de sesión, todo el ledger financiero—,
 * así que el directorio y cada archivo se protegen a nivel de sistema de archivos
 * (`ensureSecureDir`/`secureFile`, `common/fs-security.ts`), no solo por la autorización de la
 * API.
 */
export { ensureSecureDir, secureFile } from '../common/fs-security.js';

export function manifestPath(dir: string): string {
  return join(dir, 'manifest.json');
}

export async function readManifest(dir: string): Promise<BackupGeneration[]> {
  try {
    const raw = await readFile(manifestPath(dir), 'utf-8');
    const parsed = JSON.parse(raw) as { generations?: BackupGeneration[] };
    return parsed.generations ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Escritura atómica (archivo temporal + renombrado) para no dejar un manifiesto a medias. */
export async function writeManifest(dir: string, generations: BackupGeneration[]): Promise<void> {
  await ensureSecureDir(dir);
  const target = manifestPath(dir);
  const tmp = `${target}.tmp-${process.pid}`;
  // `rename` conserva el modo del archivo de origen: basta con pasarlo aquí (H2).
  await writeFile(tmp, JSON.stringify({ generations }, null, 2), {
    encoding: 'utf-8',
    mode: PRIVATE_FILE_MODE,
  });
  await rename(tmp, target);
  await secureFile(target);
}

export async function deleteBackupFile(dir: string, fileName: string): Promise<void> {
  await unlink(join(dir, fileName)).catch(() => undefined);
}

export function backupFilePath(dir: string, fileName: string): string {
  return join(dir, fileName);
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

interface ConnectionParts {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/**
 * Descompone `DATABASE_URL` para pasarla a `pg_dump`/`pg_restore` mediante variables de entorno
 * libpq (`PGHOST`, `PGPASSWORD`, ...), nunca como argumento de línea de comandos: un argumento
 * queda visible para cualquiera que liste procesos en la máquina (`ps`), una variable de entorno
 * del hijo no.
 */
export function parseConnection(databaseUrl: string): ConnectionParts {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

export function connectionEnv(conn: ConnectionParts): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGUSER: conn.user,
    PGPASSWORD: conn.password,
    PGDATABASE: conn.database,
  };
}

export interface RunResult {
  code: number;
  stderr: string;
}

/**
 * Ejecuta `pg_dump`/`pg_restore` (D-B2). Si el binario no existe en el entorno (ADR 0016: no
 * está garantizado en todos los entornos todavía), el error se captura como un `RunResult` con
 * código -1 y el mensaje del sistema, nunca una excepción no controlada.
 */
export function run(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      resolve({ code: -1, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** ¿Está `pg_dump` disponible en este entorno? Usado para omitir pruebas reales sin él (ADR 0016). */
export async function isBinaryAvailable(binary: string): Promise<boolean> {
  const result = await run(binary, ['--version'], process.env);
  return result.code === 0;
}
