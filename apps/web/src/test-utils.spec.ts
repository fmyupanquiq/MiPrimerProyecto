import { SYSTEM_ROLE_DEFINITIONS } from '@letfer/shared';
import { describe, expect, it } from 'vitest';
import { OWNER_PERMISSIONS } from './test-utils.js';

describe('permisos de los fixtures de la web', () => {
  it('OWNER_PERMISSIONS incluye todos los permisos del Administrador de Proyecto y del propietario', () => {
    // Evita que las pruebas de la web queden desfasadas de la matriz real (p. ej. bets.correct).
    const roles = SYSTEM_ROLE_DEFINITIONS.filter(
      (role) => role.key === 'PROJECT_ADMIN' || role.key === 'PROJECT_OWNER',
    );
    const expected = new Set(roles.flatMap((role) => [...role.permissions]));
    const missing = [...expected].filter((permission) => !OWNER_PERMISSIONS.includes(permission));
    expect(missing).toEqual([]);
  });
});
