import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Puerto de envío de correo (§84): la aplicación depende de esta abstracción y no de un
 * proveedor concreto, que se elegirá al desplegar (Fase 11).
 */
export abstract class MailService {
  abstract send(message: MailMessage): Promise<void>;
}

/** Raíz del monorepo: el primer ancestro cuyo package.json declara `workspaces`. */
function findRepoRoot(start: string): string {
  let directory = start;
  for (;;) {
    const manifest = resolve(directory, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
        if (parsed.workspaces) return directory;
      } catch {
        // package.json ilegible: se sigue subiendo.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return start;
    directory = parent;
  }
}

/**
 * Adaptador de DESARROLLO: no envía nada, escribe cada mensaje como un archivo JSON en la
 * carpeta `outbox` (por defecto `.data/outbox` en la raíz del repositorio, ignorada por Git).
 * Así se puede abrir el correo de recuperación y copiar su enlace sin un proveedor real.
 */
@Injectable()
export class FileOutboxMailService extends MailService {
  private readonly logger = new Logger('Mail');
  private readonly directory: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    const configured = config.mail.outboxDir;
    this.directory = isAbsolute(configured)
      ? configured
      : resolve(findRepoRoot(process.cwd()), configured);
  }

  override async send(message: MailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = resolve(this.directory, `${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await writeFile(file, JSON.stringify(message, null, 2), 'utf8');
    // El cuerpo puede contener enlaces con tokens: solo se registra el destinatario y el asunto.
    this.logger.log(`Correo de desarrollo guardado (${message.subject}) → ${file}`);
  }
}
