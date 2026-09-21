import { describe, expect, it } from 'vitest';
import { readBootstrapInput } from './bootstrap-input.js';

const complete = {
  BOOTSTRAP_ADMIN_EMAIL: ' admin@letfer.example ',
  BOOTSTRAP_ADMIN_PASSWORD: '  contraseña con espacios  ',
  BOOTSTRAP_ADMIN_FIRST_NAME: 'Fernando ',
  BOOTSTRAP_ADMIN_LAST_NAME: 'Yupanqui',
};

describe('readBootstrapInput', () => {
  it('lee las cuatro variables, recortando todo salvo la contraseña', () => {
    expect(readBootstrapInput(complete)).toEqual({
      ok: true,
      input: {
        email: 'admin@letfer.example',
        password: '  contraseña con espacios  ',
        firstName: 'Fernando',
        lastName: 'Yupanqui',
      },
    });
  });

  it('informa exactamente qué variables faltan (nunca sus valores)', () => {
    expect(readBootstrapInput({})).toEqual({
      ok: false,
      missing: [
        'BOOTSTRAP_ADMIN_EMAIL',
        'BOOTSTRAP_ADMIN_PASSWORD',
        'BOOTSTRAP_ADMIN_FIRST_NAME',
        'BOOTSTRAP_ADMIN_LAST_NAME',
      ],
    });
    expect(readBootstrapInput({ ...complete, BOOTSTRAP_ADMIN_LAST_NAME: '   ' })).toEqual({
      ok: false,
      missing: ['BOOTSTRAP_ADMIN_LAST_NAME'],
    });
  });
});
