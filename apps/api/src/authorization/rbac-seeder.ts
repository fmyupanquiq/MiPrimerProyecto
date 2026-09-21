import {
  PERMISSION_CODES,
  PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  type PermissionCode,
} from '@letfer/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { lockByKey } from '../database/advisory-lock.js';
import type { Database } from '../database/database.module.js';
import { permissions, rolePermissions, roles } from '../database/schema/index.js';

/**
 * Sincroniza las tablas `permissions`, `roles` y `role_permissions` con el catálogo de
 * `@letfer/shared` (spec §4.5, §105.2), que es la única fuente de la matriz de los roles de
 * sistema. Es idempotente y segura ante arranques simultáneos (bloqueo asesor).
 *
 * - Inserta o actualiza los permisos y los roles de sistema.
 * - Deja los permisos de cada rol de sistema EXACTAMENTE como en el catálogo (añade los que
 *   falten y quita los que sobren), de modo que un cambio de la matriz llega a las bases de datos
 *   existentes en el siguiente arranque.
 * - No toca los roles personalizados.
 */
export async function reconcileRbac(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await lockByKey(tx, 'rbac-reconcile');

    await tx
      .insert(permissions)
      .values(
        PERMISSION_CODES.map((code) => ({
          code,
          scope: PERMISSIONS[code].scope,
          description: PERMISSIONS[code].description,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.code,
        set: {
          scope: sql`excluded.scope`,
          description: sql`excluded.description`,
        },
      });

    await tx
      .insert(roles)
      .values(
        SYSTEM_ROLE_DEFINITIONS.map((definition) => ({
          key: definition.key,
          scope: definition.scope,
          name: definition.name,
          description: definition.description,
          isSystem: true,
        })),
      )
      .onConflictDoUpdate({
        target: roles.key,
        targetWhere: sql`${roles.key} IS NOT NULL`,
        set: {
          scope: sql`excluded.scope`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
        },
      });

    const systemRoles = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(
        inArray(
          roles.key,
          SYSTEM_ROLE_DEFINITIONS.map((definition) => definition.key),
        ),
      );
    const idByKey = new Map(systemRoles.map((role) => [role.key, role.id]));

    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      const roleId = idByKey.get(definition.key)!;
      const wanted: PermissionCode[] = [...definition.permissions];

      if (wanted.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(wanted.map((permissionCode) => ({ roleId, permissionCode })))
          .onConflictDoNothing();
      }
      await tx
        .delete(rolePermissions)
        .where(
          wanted.length > 0
            ? and(
                eq(rolePermissions.roleId, roleId),
                notInArray(rolePermissions.permissionCode, wanted),
              )
            : eq(rolePermissions.roleId, roleId),
        );
    }
  });
}
