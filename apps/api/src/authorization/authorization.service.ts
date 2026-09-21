import { Inject, Injectable } from '@nestjs/common';
import { isPermissionCode, type PermissionCode } from '@letfer/shared';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { rolePermissions, roles, type RoleRow } from '../database/schema/index.js';

export interface LoadedRole {
  role: RoleRow;
  /** Clave del rol de sistema; el nombre si es un rol personalizado. */
  key: string;
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
}
