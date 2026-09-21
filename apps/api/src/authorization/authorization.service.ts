import { Inject, Injectable } from '@nestjs/common';
import {
  isPermissionCode,
  isPermissionSubset,
  systemRoleDefinition,
  type PermissionCode,
} from '@letfer/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  projectMembers,
  projects,
  rolePermissions,
  roles,
  type ProjectMemberRow,
  type ProjectRow,
  type RoleRow,
} from '../database/schema/index.js';

export interface LoadedRole {
  role: RoleRow;
  /** Clave del rol de sistema; el nombre si es un rol personalizado. */
  key: string;
  permissions: ReadonlySet<PermissionCode>;
}

/** Acceso de un usuario a un proyecto: membresía, propiedad y permisos efectivos (§105.2). */
export interface ProjectAccess {
  project: ProjectRow;
  /** Membresía activa del usuario, si la tiene (el Administrador Global puede no tenerla). */
  membership: ProjectMemberRow | null;
  isOwner: boolean;
  /** Clave del rol de la membresía activa, si tiene. */
  roleKey: string | null;
  /** Unión de los permisos globales, de la membresía y de propietario. */
  permissions: ReadonlySet<PermissionCode>;
}

/** Evaluación de roles y permisos (spec §4.5, §39, §105.2). Siempre en el servidor. */
@Injectable()
export class AuthorizationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Rol con sus permisos, o `null` si no existe. Los permisos desconocidos se ignoran. */
  async loadRole(roleId: string, executor: DbExecutor = this.db): Promise<LoadedRole | null> {
    const [role] = await executor.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) return null;
    const granted = await executor
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    return {
      role,
      key: role.key ?? role.name,
      permissions: new Set(granted.map((row) => row.code).filter(isPermissionCode)),
    };
  }

  /** Rol global y permisos globales de un usuario. */
  async globalAccess(user: { globalRoleId: string }, executor: DbExecutor = this.db) {
    const loaded = await this.loadRole(user.globalRoleId, executor);
    if (!loaded)
      throw new Error(`El usuario referencia un rol global inexistente: ${user.globalRoleId}`);
    return { roleKey: loaded.key, permissions: loaded.permissions };
  }

  /**
   * Acceso de un usuario a un proyecto, o `null` si no debe ni saber que existe (§105.3).
   *
   * Tiene acceso quien es miembro activo, el propietario o quien tiene `project.view` por su rol
   * global (el Administrador Global). Un proyecto en papelera solo es visible para quienes pueden
   * restaurarlo, y solo mediante rutas que lo admitan (`allowTrashed`).
   */
  async projectAccess(
    user: { id: string; globalRoleId: string },
    projectId: string,
    options: { allowTrashed?: boolean } = {},
    executor: DbExecutor = this.db,
  ): Promise<ProjectAccess | null> {
    const [project] = await executor
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return null;

    const global = await this.globalAccess(user, executor);
    const [membership] = await executor
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, user.id),
          eq(projectMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const isOwner = project.ownerId === user.id;
    const permissions = new Set<PermissionCode>(global.permissions);
    let roleKey: string | null = null;

    if (membership) {
      const memberRole = await this.loadRole(membership.roleId, executor);
      roleKey = memberRole?.key ?? null;
      for (const permission of memberRole?.permissions ?? []) permissions.add(permission);
    }
    if (isOwner) {
      const [ownerRole] = await executor
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'PROJECT_OWNER'))
        .limit(1);
      const owner = ownerRole ? await this.loadRole(ownerRole.id, executor) : null;
      for (const permission of owner?.permissions ?? []) permissions.add(permission);
    }

    const hasAccess = membership !== undefined || isOwner || permissions.has('project.view');
    if (!hasAccess) return null;

    if (project.status === 'TRASHED') {
      if (!options.allowTrashed || !permissions.has('project.restore')) return null;
    }
    return { project, membership: membership ?? null, isOwner, roleKey, permissions };
  }

  /**
   * ¿Puede el actor asignar este rol dentro del proyecto? (§84, §98, §105.2). El rol debe ser
   * de proyecto y asignable (nunca `PROJECT_OWNER` ni globales), pertenecer al sistema o al propio
   * proyecto, y no otorgar ningún permiso que el actor no tenga.
   */
  canAssignRole(access: ProjectAccess, target: LoadedRole): boolean {
    const { role } = target;
    if (role.deletedAt || role.scope !== 'PROJECT') return false;
    if (role.isSystem) {
      if (!systemRoleDefinition(role.key ?? '')?.assignable) return false;
    } else if (role.projectId !== access.project.id) {
      return false;
    }
    return isPermissionSubset(target.permissions, access.permissions);
  }

  /** Roles que el actor puede asignar en el proyecto (para las invitaciones y los cambios de rol). */
  async assignableRoles(
    access: ProjectAccess,
    executor: DbExecutor = this.db,
  ): Promise<LoadedRole[]> {
    const assignableKeys = ['PROJECT_ADMIN', 'COLLABORATOR', 'READER'];
    const candidates = await executor
      .select()
      .from(roles)
      .where(
        and(
          isNull(roles.deletedAt),
          or(
            and(eq(roles.isSystem, true), inArray(roles.key, assignableKeys)),
            eq(roles.projectId, access.project.id),
          ),
        ),
      );
    if (candidates.length === 0) return [];

    const grants = await executor
      .select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(
        inArray(
          rolePermissions.roleId,
          candidates.map((role) => role.id),
        ),
      );

    const loaded = candidates.map((role): LoadedRole => ({
      role,
      key: role.key ?? role.name,
      permissions: new Set(
        grants
          .filter((grant) => grant.roleId === role.id)
          .map((grant) => grant.code)
          .filter(isPermissionCode),
      ),
    }));
    return loaded
      .filter((role) => this.canAssignRole(access, role))
      .sort((a, b) => a.role.name.localeCompare(b.role.name, 'es'));
  }
}
