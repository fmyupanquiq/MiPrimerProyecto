import { describe, expect, it } from 'vitest';
import { diffFields, REDACTED, redactSensitive } from './audit-values.js';

describe('diffFields', () => {
  it('incluye solo los campos que cambiaron, con valor anterior y nuevo', () => {
    const diff = diffFields(
      { firstName: 'Ana', lastName: 'Ruiz', email: 'a@x.com' },
      { firstName: 'Ana', lastName: 'Rojas', email: 'a@x.com' },
    );
    expect(diff).toEqual({ oldValues: { lastName: 'Ruiz' }, newValues: { lastName: 'Rojas' } });
  });

  it('devuelve null si no hay cambios', () => {
    expect(diffFields({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBeNull();
  });

  it('respeta la lista de campos a comparar', () => {
    const diff = diffFields({ a: 1, b: 1 }, { a: 2, b: 2 }, ['b']);
    expect(diff).toEqual({ oldValues: { b: 1 }, newValues: { b: 2 } });
  });

  it('trata campos ausentes como nulos y normaliza fechas a ISO 8601', () => {
    const diff = diffFields(
      { deletedAt: null },
      { deletedAt: new Date('2026-01-02T03:04:05.000Z'), avatar: 'x.png' },
    );
    expect(diff).toEqual({
      oldValues: { deletedAt: null, avatar: null },
      newValues: { deletedAt: '2026-01-02T03:04:05.000Z', avatar: 'x.png' },
    });
  });

  it('compara fechas iguales como iguales', () => {
    const at = '2026-01-02T03:04:05.000Z';
    expect(diffFields({ at: new Date(at) }, { at: new Date(at) })).toBeNull();
  });
});

describe('redactSensitive', () => {
  it('oculta claves sensibles a cualquier profundidad', () => {
    const result = redactSensitive({
      email: 'a@x.com',
      passwordHash: '$argon2id$...',
      nested: { sessionToken: 'abc', keep: 1, list: [{ secretKey: 'z' }] },
    });
    expect(result).toEqual({
      email: 'a@x.com',
      passwordHash: REDACTED,
      nested: { sessionToken: REDACTED, keep: 1, list: [{ secretKey: REDACTED }] },
    });
  });
});
