/**
 * Catálogo de permisos y roles de sistema (spec §4.5, §105.2). Es la ÚNICA fuente de la matriz:
 * la API la siembra en las tablas `permissions`, `roles` y `role_permissions`, y la web la usa
 * para mostrar u ocultar controles (la autorización real siempre se valida en el backend, §39).
 */

export const PERMISSION_SCOPES = ['GLOBAL', 'PROJECT'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

interface PermissionDefinition {
  scope: PermissionScope;
  description: string;
}

export const PERMISSIONS = {
  // --- Globales: no dependen de un proyecto concreto ---
  'projects.create': { scope: 'GLOBAL', description: 'Crear proyectos propios' },
  'projects.list_all': { scope: 'GLOBAL', description: 'Listar todos los proyectos del sistema' },
  'projects.transfer_ownership': {
    scope: 'GLOBAL',
    description: 'Transferir la propiedad de un proyecto',
  },

  // --- De proyecto: se evalúan dentro de un proyecto ---
  'project.view': { scope: 'PROJECT', description: 'Ver el proyecto' },
  'project.update': { scope: 'PROJECT', description: 'Editar los datos del proyecto' },
  'project.close': { scope: 'PROJECT', description: 'Cerrar el proyecto' },
  'project.reopen': { scope: 'PROJECT', description: 'Reabrir un proyecto cerrado' },
  'project.trash': { scope: 'PROJECT', description: 'Enviar el proyecto a la papelera' },
  'project.restore': { scope: 'PROJECT', description: 'Restaurar el proyecto desde la papelera' },
  'members.view': { scope: 'PROJECT', description: 'Ver los miembros del proyecto' },
  'members.update_role': { scope: 'PROJECT', description: 'Cambiar el rol de un miembro' },
  'members.remove': { scope: 'PROJECT', description: 'Expulsar a un miembro' },
  'invitations.view': { scope: 'PROJECT', description: 'Ver las invitaciones del proyecto' },
  'invitations.create': { scope: 'PROJECT', description: 'Crear invitaciones' },
  'invitations.disable': { scope: 'PROJECT', description: 'Deshabilitar invitaciones' },

  // --- Finanzas (Fase 3, §11-17, §72, §79) ---
  'project.setup': {
    scope: 'PROJECT',
    description: 'Completar la configuración inicial: etapa, unidad, casas y banca',
  },
  'stages.view': { scope: 'PROJECT', description: 'Ver las etapas del proyecto' },
  'stages.create': { scope: 'PROJECT', description: 'Crear/activar una nueva etapa' },
  'stages.correct_unit': { scope: 'PROJECT', description: 'Corregir la unidad de una etapa' },
  'stages.trash': { scope: 'PROJECT', description: 'Enviar una etapa a la papelera' },
  'stages.restore': { scope: 'PROJECT', description: 'Restaurar una etapa desde la papelera' },
  'houses.view': { scope: 'PROJECT', description: 'Ver las casas de apuestas y sus saldos' },
  'houses.create': { scope: 'PROJECT', description: 'Añadir una casa de apuestas' },
  'houses.deactivate': { scope: 'PROJECT', description: 'Desactivar una casa (con saldo cero)' },
  'movements.view': {
    scope: 'PROJECT',
    description: 'Ver el historial de movimientos financieros',
  },
  'movements.deposit': { scope: 'PROJECT', description: 'Registrar un depósito' },
  'movements.transfer': { scope: 'PROJECT', description: 'Registrar una transferencia interna' },
  'movements.extraordinary': {
    scope: 'PROJECT',
    description: 'Registrar un movimiento extraordinario',
  },
  'withdrawals.request': { scope: 'PROJECT', description: 'Solicitar un retiro' },
  'withdrawals.approve': {
    scope: 'PROJECT',
    description: 'Aprobar o rechazar una solicitud de retiro',
  },

  // --- Apuestas (Fase 4, §18-§27, §90, §107) ---
  'bets.view': { scope: 'PROJECT', description: 'Ver las apuestas del proyecto' },
  'bets.create': { scope: 'PROJECT', description: 'Registrar una apuesta' },
  'bets.update_own': { scope: 'PROJECT', description: 'Editar las apuestas propias' },
  'bets.update_any': { scope: 'PROJECT', description: 'Editar cualquier apuesta del proyecto' },
  /**
   * Liquidar tiene efecto real en el ledger (inserta BET_PLACEMENT/BET_SETTLEMENT con un monto
   * y retorno que declara quien liquida, sin verificación de ticket en esta fase): es una
   * operación financiera, no una simple edición, y se protege como tal (revisión de
   * arquitectura previa a integrar la Fase 4). No depende de la propiedad de la apuesta: como
   * el resto de acciones que tocan el ledger (movements.*, withdrawals.approve), es de
   * administrador, nunca del Colaborador por defecto.
   */
  'bets.settle': { scope: 'PROJECT', description: 'Liquidar una apuesta pendiente' },
  'bets.trash_own': { scope: 'PROJECT', description: 'Enviar a la papelera las apuestas propias' },
  'bets.trash_any': {
    scope: 'PROJECT',
    description: 'Enviar a la papelera cualquier apuesta del proyecto',
  },
  'bets.restore': { scope: 'PROJECT', description: 'Restaurar una apuesta desde la papelera' },
  'bets.move_stage': { scope: 'PROJECT', description: 'Mover una apuesta a otra etapa' },

  // --- Confianza y recuperación (Fase 5.5, §32, §38, §74, §80, §109) ---
  'reconciliations.view': {
    scope: 'PROJECT',
    description: 'Ver el historial de conciliaciones de las casas',
  },
  /** Único paso: declara el saldo oficial y compara (D-C1, D-C2). No mueve dinero. */
  'reconciliations.confirm': {
    scope: 'PROJECT',
    description: 'Conciliar una casa contra su saldo oficial declarado',
  },
  'integrity.view': {
    scope: 'PROJECT',
    description: 'Ver el historial de verificaciones de integridad del proyecto',
  },
  /** Solo lectura: nunca corrige datos ni crea movimientos (D-I1, §38). */
  'integrity.run': {
    scope: 'PROJECT',
    description: 'Ejecutar una verificación de integridad del ledger del proyecto',
  },
  /**
   * Primer permiso con prefijo `system.*` (ADR 0016): capacidades de administración de toda la
   * instancia, no de un proyecto. Reservados al Administrador Global (§37, §109.5).
   */
  'system.integrity.run': {
    scope: 'GLOBAL',
    description: 'Ejecutar una verificación de integridad sobre todos los proyectos',
  },
  'system.backups.view': { scope: 'GLOBAL', description: 'Ver las generaciones de backup' },
  'system.backups.create': { scope: 'GLOBAL', description: 'Disparar un backup manual' },
  'system.backups.restore': {
    scope: 'GLOBAL',
    description: 'Restaurar LetFer desde una generación de backup',
  },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value);
}

export const GLOBAL_ROLE_KEYS = ['GLOBAL_ADMIN', 'USER'] as const;
export const PROJECT_ROLE_KEYS = [
  'PROJECT_OWNER',
  'PROJECT_ADMIN',
  'COLLABORATOR',
  'READER',
] as const;
export type GlobalRoleKey = (typeof GLOBAL_ROLE_KEYS)[number];
export type ProjectRoleKey = (typeof PROJECT_ROLE_KEYS)[number];
export type SystemRoleKey = GlobalRoleKey | ProjectRoleKey;

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  scope: PermissionScope;
  name: string;
  description: string;
  /**
   * `true` si el rol puede asignarse mediante una invitación o un cambio de rol. `PROJECT_OWNER`
   * es implícito (atributo del propietario) y los roles globales no se asignan a un proyecto.
   */
  assignable: boolean;
  permissions: readonly PermissionCode[];
}

/** Rol global por defecto de todo usuario nuevo (spec §105.1). */
export const DEFAULT_GLOBAL_ROLE_KEY: GlobalRoleKey = 'USER';

/** Rol con el que se crea la membresía del propietario y que nadie puede quitarle (§105.4). */
export const OWNER_MEMBERSHIP_ROLE_KEY: ProjectRoleKey = 'PROJECT_ADMIN';

export const SYSTEM_ROLE_DEFINITIONS: readonly SystemRoleDefinition[] = [
  {
    key: 'GLOBAL_ADMIN',
    scope: 'GLOBAL',
    name: 'Administrador Global',
    description: 'Nivel máximo del sistema: todos los permisos en todos los proyectos.',
    assignable: false,
    permissions: PERMISSION_CODES,
  },
  {
    key: 'USER',
    scope: 'GLOBAL',
    name: 'Usuario',
    description:
      'Usuario normal: puede crear proyectos propios y ver aquellos a los que pertenece.',
    assignable: false,
    // §105.1: crear proyectos NO es una facultad exclusiva del Administrador Global.
    permissions: ['projects.create'],
  },
  {
    key: 'PROJECT_OWNER',
    scope: 'PROJECT',
    name: 'Propietario',
    description: 'Atributos adicionales del propietario del proyecto (se suman a su membresía).',
    assignable: false,
    permissions: ['project.reopen', 'project.trash', 'project.restore'],
  },
  {
    key: 'PROJECT_ADMIN',
    scope: 'PROJECT',
    name: 'Administrador de Proyecto',
    description: 'Administra miembros, invitaciones y la configuración del proyecto.',
    assignable: true,
    permissions: [
      'project.view',
      'project.update',
      'project.close',
      'members.view',
      'members.update_role',
      'members.remove',
      'invitations.view',
      'invitations.create',
      'invitations.disable',
      // Finanzas (§88: el Administrador de Proyecto administra etapas, casas y movimientos).
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
      // Apuestas (Fase 4, §88: "crear/editar apuestas según reglas... gestionar papelera").
      'bets.view',
      'bets.create',
      'bets.update_own',
      'bets.update_any',
      'bets.settle',
      'bets.trash_own',
      'bets.trash_any',
      'bets.restore',
      'bets.move_stage',
      // Confianza y recuperación (Fase 5.5, §109.5: conciliar e investigar son de administrador).
      'reconciliations.view',
      'reconciliations.confirm',
      'integrity.view',
      'integrity.run',
    ],
  },
  {
    key: 'COLLABORATOR',
    scope: 'PROJECT',
    name: 'Colaborador',
    description: 'Usuario operativo del proyecto.',
    assignable: true,
    // Solo consulta de finanzas (§88: "información operativa necesaria para colaborar"; D8).
    // Incluye stages.view porque §50 exige mostrar la etapa activa en la cabecera a todo miembro.
    // Apuestas (§4.3, §88): puede crear y ver, y editar/eliminar únicamente las propias.
    permissions: [
      'project.view',
      'members.view',
      'stages.view',
      'houses.view',
      'movements.view',
      'bets.view',
      'bets.create',
      'bets.update_own',
      'bets.trash_own',
      // Confianza y recuperación (Fase 5.5): puede consultar, no conciliar ni verificar.
      'reconciliations.view',
      'integrity.view',
    ],
  },
  {
    key: 'READER',
    scope: 'PROJECT',
    name: 'Lector',
    description: 'Acceso de consulta, sin capacidad de modificación.',
    assignable: true,
    permissions: [
      'project.view',
      'members.view',
      'stages.view',
      'houses.view',
      'movements.view',
      'bets.view',
      // Confianza y recuperación (Fase 5.5): consulta, coherente con el resto de *.view.
      'reconciliations.view',
      'integrity.view',
    ],
  },
];

export function systemRoleDefinition(key: string): SystemRoleDefinition | undefined {
  return SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === key);
}

/**
 * `true` si todos los permisos de `required` están en `granted`. Es el límite de asignación
 * (§84, §98, §105.2): un rol solo puede asignarse si no otorga nada que el actor no tenga.
 */
export function isPermissionSubset(
  required: Iterable<PermissionCode>,
  granted: ReadonlySet<PermissionCode>,
): boolean {
  for (const permission of required) {
    if (!granted.has(permission)) return false;
  }
  return true;
}
