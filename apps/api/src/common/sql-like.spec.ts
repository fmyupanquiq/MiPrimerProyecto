import { describe, expect, it } from 'vitest';
import { escapeLike } from './sql-like.js';

describe('escapeLike', () => {
  it('deja intacto el texto sin caracteres especiales', () => {
    expect(escapeLike('project.trashed')).toBe('project.trashed');
  });

  it('escapa % y _ para que sean texto literal', () => {
    expect(escapeLike('100%_listo')).toBe('100\\%\\_listo');
  });

  it('escapa también la propia barra invertida', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
});
