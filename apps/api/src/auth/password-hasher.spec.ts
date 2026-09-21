import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/app-config.js';
import { PasswordHasher } from './password-hasher.js';

const DATABASE_URL = 'postgresql://u:p@localhost:5432/db';

function hasher(env: Record<string, string> = {}): PasswordHasher {
  return new PasswordHasher(
    loadConfig({ DATABASE_URL, ARGON2_MEMORY_KIB: '1024', ARGON2_PASSES: '1', ...env }),
  );
}

describe('PasswordHasher (argon2id de node:crypto)', () => {
  it('genera un hash en formato PHC con los parámetros configurados', async () => {
    const hash = await hasher().hash('una contraseña larga');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(hash).not.toContain('una contraseña');
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const h = hasher();
    const hash = await h.hash('clave-correcta-123');
    await expect(h.verify('clave-correcta-123', hash)).resolves.toBe(true);
    await expect(h.verify('clave-correcta-124', hash)).resolves.toBe(false);
    await expect(h.verify('', hash)).resolves.toBe(false);
  });

  it('usa una sal distinta en cada hash', async () => {
    const h = hasher();
    const [a, b] = await Promise.all([h.hash('misma-clave-1234'), h.hash('misma-clave-1234')]);
    expect(a).not.toBe(b);
    await expect(h.verify('misma-clave-1234', a)).resolves.toBe(true);
    await expect(h.verify('misma-clave-1234', b)).resolves.toBe(true);
  });

  it('rechaza hashes manipulados o mal formados sin lanzar errores', async () => {
    const h = hasher();
    const hash = await h.hash('clave-correcta-123');
    const parts = hash.split('$');
    const tampered = [...parts.slice(0, -1), 'A'.repeat(parts.at(-1)!.length)].join('$');

    await expect(h.verify('clave-correcta-123', tampered)).resolves.toBe(false);
    await expect(h.verify('clave-correcta-123', 'no-es-un-hash')).resolves.toBe(false);
    await expect(h.verify('clave-correcta-123', '')).resolves.toBe(false);
    await expect(
      h.verify('clave-correcta-123', '$argon2id$v=19$m=99999999,t=1,p=1$c2FsdA$aGFzaA'),
    ).resolves.toBe(false);
  });

  it('trata igual una contraseña escrita con distinta composición Unicode (NFKC)', async () => {
    const h = hasher();
    const hash = await h.hash('contraseña-ﬁnal-1'); // ﬁ = ligadura U+FB01
    await expect(h.verify('contraseña-final-1', hash)).resolves.toBe(true);
  });

  it('admite contraseñas con caracteres no ASCII', async () => {
    const h = hasher();
    const hash = await h.hash('пароль-密码-🔐-ñandú');
    await expect(h.verify('пароль-密码-🔐-ñandú', hash)).resolves.toBe(true);
  });

  it('needsRehash detecta hashes con parámetros distintos a los actuales', async () => {
    const weak = await hasher({ ARGON2_MEMORY_KIB: '512' }).hash('clave-correcta-123');
    const current = hasher();
    const fresh = await current.hash('clave-correcta-123');

    expect(current.needsRehash(fresh)).toBe(false);
    expect(current.needsRehash(weak)).toBe(true);
    expect(current.needsRehash('formato-desconocido')).toBe(true);
    // Un hash con parámetros antiguos sigue verificándose con sus propios parámetros.
    await expect(current.verify('clave-correcta-123', weak)).resolves.toBe(true);
  });

  it('verifyDummy trabaja igual que una verificación y no lanza errores', async () => {
    const h = hasher();
    await expect(h.verifyDummy('cualquier-cosa')).resolves.toBeUndefined();
    await expect(h.verifyDummy('otra-distinta')).resolves.toBeUndefined();
  });
});
