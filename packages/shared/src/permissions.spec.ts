import { describe, expect, it } from 'vitest';
import {
  isPermissionCode,
  isPermissionSubset,
  PERMISSION_CODES,
  PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  systemRoleDefinition,
  type PermissionCode,
  type SystemRoleKey,
} from './permissions.js';

const perms = (key: SystemRoleKey): PermissionCode[] => [...systemRoleDefinition(key)!.permissions];

describe('catálogo de permisos', () => {
  it('cada permiso tiene ámbito y descripción, y los códigos no se repiten', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const code of PERMISSION_CODES) {
      expect(PERMISSIONS[code].description.length).toBeGreaterThan(0);
      expect(['GLOBAL', 'PROJECT']).toContain(PERMISSIONS[code].scope);
    }
    expect(isPermissionCode('project.view')).toBe(true);
    expect(isPermissionCode('inventado.permiso')).toBe(false);
  });
});

describe('matriz de roles de sistema (§105.2)', () => {
  it('F1: crear proyectos NO es exclusivo del Administrador Global: lo tiene USER', () => {
    expect(perms('USER')).toContain('projects.create');
    expect(perms('GLOBAL_ADMIN')).toContain('projects.create');
    const withCreate = SYSTEM_ROLE_DEFINITIONS.filter((role) =>
      role.permissions.includes('projects.create'),
    ).map((role) => role.key);
    expect(withCreate.sort()).toEqual(['GLOBAL_ADMIN', 'USER']);
  });

  it('el Administrador Global tiene todos los permisos', () => {
    expect([...perms('GLOBAL_ADMIN')].sort()).toEqual([...PERMISSION_CODES].sort());
  });

  it('USER solo puede crear proyectos (no ve proyectos ajenos)', () => {
    expect(perms('USER')).toEqual(['projects.create']);
  });

  it('coincide con la tabla del §105.2 para los roles de proyecto', () => {
    expect([...perms('PROJECT_OWNER')].sort()).toEqual(
      ['project.reopen', 'project.restore', 'project.trash'].sort(),
    );
    expect([...perms('PROJECT_ADMIN')].sort()).toEqual(
      [
        'project.view',
        'project.update',
        'project.close',
        'members.view',
        'members.update_role',
        'members.remove',
        'invitations.view',
        'invitations.create',
        'invitations.disable',
      ].sort(),
    );
    expect([...perms('COLLABORATOR')].sort()).toEqual(['members.view', 'project.view']);
    expect([...perms('READER')].sort()).toEqual(['members.view', 'project.view']);
  });

  it('el Administrador de Proyecto no puede reabrir, enviar a papelera ni restaurar (§87)', () => {
    for (const permission of ['project.reopen', 'project.trash', 'project.restore'] as const) {
      expect(perms('PROJECT_ADMIN')).not.toContain(permission);
      expect(perms('PROJECT_OWNER')).toContain(permission);
    }
  });

  it('colaboradores y lectores no administran nada', () => {
    for (const role of ['COLLABORATOR', 'READER'] as const) {
      for (const permission of perms(role)) {
        expect(PERMISSIONS[permission].scope).toBe('PROJECT');
        expect(['project.view', 'members.view']).toContain(permission);
      }
    }
  });

  it('los roles de proyecto solo tienen permisos de proyecto y USER solo globales', () => {
    for (const role of SYSTEM_ROLE_DEFINITIONS.filter((r) => r.scope === 'PROJECT')) {
      for (const permission of role.permissions)
        expect(PERMISSIONS[permission].scope).toBe('PROJECT');
    }
    for (const permission of perms('USER')) expect(PERMISSIONS[permission].scope).toBe('GLOBAL');
  });

  it('solo los roles de proyecto no propietarios son asignables', () => {
    const assignable = SYSTEM_ROLE_DEFINITIONS.filter((role) => role.assignable).map(
      (role) => role.key,
    );
    expect(assignable.sort()).toEqual(['COLLABORATOR', 'PROJECT_ADMIN', 'READER']);
    expect(systemRoleDefinition('PROJECT_OWNER')!.assignable).toBe(false);
    expect(systemRoleDefinition('GLOBAL_ADMIN')!.assignable).toBe(false);
  });

  it('las claves de rol son únicas', () => {
    const keys = SYSTEM_ROLE_DEFINITIONS.map((role) => role.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('límite de asignación (§105.2)', () => {
  const held = (key: SystemRoleKey) => new Set(perms(key));

  it('un Administrador de Proyecto puede asignar los roles de proyecto asignables', () => {
    const admin = held('PROJECT_ADMIN');
    for (const role of ['PROJECT_ADMIN', 'COLLABORATOR', 'READER'] as const) {
      expect(isPermissionSubset(perms(role), admin)).toBe(true);
    }
  });

  it('nadie puede asignar un rol con permisos que no tiene', () => {
    expect(isPermissionSubset(perms('PROJECT_ADMIN'), held('COLLABORATOR'))).toBe(false);
    expect(isPermissionSubset(perms('PROJECT_OWNER'), held('PROJECT_ADMIN'))).toBe(false);
    expect(isPermissionSubset(perms('GLOBAL_ADMIN'), held('PROJECT_ADMIN'))).toBe(false);
  });

  it('el conjunto vacío siempre es subconjunto', () => {
    expect(isPermissionSubset([], new Set())).toBe(true);
  });
});
