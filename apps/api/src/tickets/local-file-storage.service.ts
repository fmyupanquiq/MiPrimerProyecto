import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ensureSecureDir, secureFile } from '../common/fs-security.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { FileStorage, SavedFile } from './file-storage.js';

/**
 * `FileStorage` sobre el sistema de archivos local (D-T2, ADR 0017). Mismo endurecimiento de
 * permisos que los backups (0700/0600, H2 de la Fase 5.5): los tickets son fotos de apuestas
 * reales con datos personales y financieros, nunca públicos (§42).
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async save(key: string, data: Buffer): Promise<SavedFile> {
    const target = this.resolve(key);
    await ensureSecureDir(this.config.tickets.dir);
    await ensureSecureDir(dirname(target));
    const tmp = `${target}.tmp-${process.pid}`;
    await writeFile(tmp, data);
    await secureFile(tmp);
    await rename(tmp, target);
    await secureFile(target);
    return {
      sizeBytes: data.byteLength,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /**
   * Resuelve `key` bajo el directorio configurado, rechazando cualquier intento de escapar de
   * él (`..`, ruta absoluta): `key` la construye `TicketsService`, nunca llega directo de una
   * petición, pero se valida igual en profundidad (§41).
   */
  private resolve(key: string): string {
    const target = normalize(join(this.config.tickets.dir, key));
    const rel = relative(this.config.tickets.dir, target);
    if (rel.startsWith('..') || rel === '') {
      throw new Error(`Clave de almacenamiento inválida: "${key}"`);
    }
    return target;
  }
}
