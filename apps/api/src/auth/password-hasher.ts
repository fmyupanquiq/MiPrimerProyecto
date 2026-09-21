import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

interface Argon2Params {
  memoryKib: number;
  passes: number;
  parallelism: number;
}

const ALGORITHM = 'argon2id';
const VERSION = 19;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

/** Límites de cordura al leer un hash almacenado (protegen ante datos corruptos). */
const MAX_MEMORY_KIB = 1024 * 1024;
const MAX_PASSES = 20;
const MAX_PARALLELISM = 16;

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ParsedHash extends Argon2Params {
  salt: Buffer;
  tag: Buffer;
}

const encode = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

function parse(hash: string): ParsedHash | null {
  const match = PHC_PATTERN.exec(hash);
  if (!match) return null;
  const memoryKib = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  if (
    memoryKib < 8 * parallelism ||
    memoryKib > MAX_MEMORY_KIB ||
    passes < 1 ||
    passes > MAX_PASSES ||
    parallelism < 1 ||
    parallelism > MAX_PARALLELISM
  ) {
    return null;
  }
  return {
    memoryKib,
    passes,
    parallelism,
    salt: Buffer.from(match[4]!, 'base64'),
    tag: Buffer.from(match[5]!, 'base64'),
  };
}

function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      ALGORITHM,
      {
        // NFKC: la misma contraseña escrita con distinta composición Unicode da el mismo hash.
        message: Buffer.from(password.normalize('NFKC'), 'utf8'),
        nonce: salt,
        memory: params.memoryKib,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength,
      },
      (error, derived) => (error ? reject(error) : resolve(Buffer.from(derived))),
    );
  });
}

/**
 * Hash de contraseñas con argon2id de `node:crypto` (ADR 0007). El resultado usa el formato
 * PHC (`$argon2id$v=19$m=…,t=…,p=…$sal$hash`), que incluye sus propios parámetros: así se pueden
 * endurecer más adelante y detectar hashes antiguos con `needsRehash`.
 */
@Injectable()
export class PasswordHasher {
  private readonly params: Argon2Params;
  private dummyHash: Promise<string> | undefined;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.params = config.argon2;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await derive(password, salt, this.params, TAG_BYTES);
    const { memoryKib, passes, parallelism } = this.params;
    return `$${ALGORITHM}$v=${VERSION}$m=${memoryKib},t=${passes},p=${parallelism}$${encode(salt)}$${encode(tag)}`;
  }

  /** Comprueba una contraseña en tiempo constante. Devuelve `false` ante un hash mal formado. */
  async verify(password: string, hash: string): Promise<boolean> {
    const parsed = parse(hash);
    if (!parsed) return false;
    const candidate = await derive(password, parsed.salt, parsed, parsed.tag.length);
    return candidate.length === parsed.tag.length && timingSafeEqual(candidate, parsed.tag);
  }

  /**
   * Realiza el mismo trabajo que una verificación real contra un hash ficticio. Se usa cuando el
   * correo no existe para que la respuesta no revele, por su duración, si la cuenta existe.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(16).toString('hex'));
    await this.verify(password, await this.dummyHash);
  }

  /** `true` si el hash almacenado usa parámetros distintos (más débiles) de los actuales. */
  needsRehash(hash: string): boolean {
    const parsed = parse(hash);
    if (!parsed) return true;
    return (
      parsed.memoryKib !== this.params.memoryKib ||
      parsed.passes !== this.params.passes ||
      parsed.parallelism !== this.params.parallelism
    );
  }
}
