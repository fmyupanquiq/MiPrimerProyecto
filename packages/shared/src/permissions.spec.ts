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
        'project.setup',
        'stages.view',
        'stages.create',
        'stages.correct_unit',
        'stages.trash',
        'stages.restore',
        'houses.view',
        'houses.create',
        'houses.deactivate',
        'movements.view',
        'movements.deposit',
        'movements.transfer',
        'movements.extraordinary',
        'withdrawals.request',
        'withdrawals.approve',
        'bets.view',
        'bets.create',
        'bets.update_own',
        'bets.update_any',
        'bets.settle',
        'bets.trash_own',
        'bets.trash_any',
        'bets.restore',
        'bets.move_stage',
        'bets.confirm_return',
        'bets.correct',
        'reconciliations.view',
        'reconciliations.confirm',
        'integrity.view',
        'integrity.run',
        'tickets.view',
        'tickets.upload',
        'tickets.analyze',
        'audit.view',
      ].sort(),
    );
    const readOnlyFinance = [
      'members.view',
      'project.view',
      'stages.view',
      'houses.view',
      'movements.view',
      'reconciliations.view',
      'integrity.view',
    ];
    // El Colaborador (§4.3, §88, Fase 4): solo consulta de etapas/casas/movimientos, pero
    // puede crear apuestas y editar/eliminar únicamente las propias (D-B5); Fase 7 (§110.6):
    // mismo nivel para tickets.
    expect([...perms('COLLABORATOR')].sort()).toEqual(
      [
        ...readOnlyFinance,
        'bets.view',
        'bets.create',
        'bets.update_own',
        'bets.trash_own',
        'tickets.view',
        'tickets.upload',
        'tickets.analyze',
      ].sort(),
    );
    expect([...perms('READER')].sort()).toEqual(
      [...readOnlyFinance, 'bets.view', 'tickets.view'].sort(),
    );
  });

  it('confirmar retornos y corregir liquidadas es del Administrador de Proyecto: nunca del Colaborador ni del Lector (D-A8)', () => {
    for (const permission of ['bets.confirm_return', 'bets.correct'] as const) {
      expect(perms('PROJECT_ADMIN')).toContain(permission);
      expect(perms('PROJECT_OWNER')).not.toContain(permission); // el propietario la tiene por su membresía
      for (const role of ['COLLABORATOR', 'READER'] as const) {
        expect(perms(role)).not.toContain(permission);
      }
    }
  });

  it('el Administrador de Proyecto no puede reabrir, enviar a papelera ni restaurar (§87)', () => {
    for (const permission of ['project.reopen', 'project.trash', 'project.restore'] as const) {
      expect(perms('PROJECT_ADMIN')).not.toContain(permission);
      expect(perms('PROJECT_OWNER')).toContain(permission);
    }
  });

  it('el Lector solo consulta: nada de crear, cambiar ni aprobar', () => {
    for (const permission of perms('READER')) {
      expect(PERMISSIONS[permission].scope).toBe('PROJECT');
      expect(permission.endsWith('.view')).toBe(true);
    }
  });

  it('el Colaborador solo opera sobre sus propias apuestas, nada más (§4.3, §88, D-B5)', () => {
    const nonView = perms('COLLABORATOR').filter((permission) => !permission.endsWith('.view'));
    expect(nonView.sort()).toEqual(
      [
        'bets.create',
        'bets.trash_own',
        'bets.update_own',
        'tickets.upload',
        'tickets.analyze',
      ].sort(),
    );
    for (const forbidden of [
      'bets.update_any',
      'bets.settle',
      'bets.trash_any',
      'bets.restore',
      'bets.move_stage',
      'withdrawals.approve',
    ] as const) {
      expect(perms('COLLABORATOR')).not.toContain(forbidden);
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

  it('Fase 3 (§88): solo el Administrador de Proyecto administra etapas, casas y movimientos', () => {
    const finance: PermissionCode[] = [
      'project.setup',
      'stages.create',
      'stages.correct_unit',
      'stages.trash',
      'stages.restore',
      'houses.create',
      'houses.deactivate',
      'movements.deposit',
      'movements.transfer',
      'movements.extraordinary',
      'withdrawals.request',
      'withdrawals.approve',
    ];
    for (const permission of finance) {
      const holders = SYSTEM_ROLE_DEFINITIONS.filter((role) =>
        role.permissions.includes(permission),
      ).map((role) => role.key);
      // El Administrador Global tiene todos los permisos (incluidos estos); el único rol de
      // proyecto que los otorga es el Administrador de Proyecto.
      expect(holders.sort(), permission).toEqual(['GLOBAL_ADMIN', 'PROJECT_ADMIN']);
    }
  });

  it('Fase 3: colaboradores y lectores ven la etapa activa, las casas y el historial', () => {
    for (const role of ['COLLABORATOR', 'READER'] as const) {
      expect(perms(role)).toEqual(
        expect.arrayContaining(['stages.view', 'houses.view', 'movements.view']),
      );
    }
  });

  it('Fase 5.5 (§109.5): todo rol de proyecto ve conciliaciones e integridad; solo el Administrador de Proyecto las ejecuta', () => {
    for (const role of ['COLLABORATOR', 'READER', 'PROJECT_ADMIN'] as const) {
      expect(perms(role)).toEqual(
        expect.arrayContaining(['reconciliations.view', 'integrity.view']),
      );
    }
    for (const role of ['COLLABORATOR', 'READER'] as const) {
      expect(perms(role)).not.toContain('reconciliations.confirm');
      expect(perms(role)).not.toContain('integrity.run');
    }
  });

  it('Fase 7 (§110.6): todo rol de proyecto ve tickets; solo Administrador y Colaborador suben/analizan', () => {
    for (const role of ['COLLABORATOR', 'READER', 'PROJECT_ADMIN'] as const) {
      expect(perms(role)).toContain('tickets.view');
    }
    for (const role of ['COLLABORATOR', 'PROJECT_ADMIN'] as const) {
      expect(perms(role)).toEqual(expect.arrayContaining(['tickets.upload', 'tickets.analyze']));
    }
    expect(perms('READER')).not.toContain('tickets.upload');
    expect(perms('READER')).not.toContain('tickets.analyze');
  });

  it('Fase 8 (§111.7): la auditoría de proyecto es solo del Administrador de Proyecto', () => {
    expect(PERMISSIONS['audit.view'].scope).toBe('PROJECT');
    expect(perms('PROJECT_ADMIN')).toContain('audit.view');
    for (const role of ['COLLABORATOR', 'READER', 'PROJECT_OWNER'] as const) {
      expect(perms(role)).not.toContain('audit.view');
    }
  });

  it('Fase 8 (§111.7): los permisos globales de administración existen y son de sistema', () => {
    for (const code of [
      'system.audit.view',
      'system.users.view',
      'system.users.manage',
      'system.account_deletions.decide',
      'system.maintenance.run',
    ] as const) {
      expect(PERMISSIONS[code].scope).toBe('GLOBAL');
      expect(perms('USER')).not.toContain(code);
      expect(perms('GLOBAL_ADMIN')).toContain(code);
    }
  });

  it('Fase 5.5: los permisos system.* son globales y solo los tiene el Administrador Global', () => {
    const systemPermissions = PERMISSION_CODES.filter((code) => code.startsWith('system.'));
    expect(systemPermissions.length).toBeGreaterThan(0);
    for (const permission of systemPermissions) {
      expect(PERMISSIONS[permission].scope).toBe('GLOBAL');
      const holders = SYSTEM_ROLE_DEFINITIONS.filter((role) =>
        role.permissions.includes(permission),
      ).map((role) => role.key);
      expect(holders).toEqual(['GLOBAL_ADMIN']);
    }
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
