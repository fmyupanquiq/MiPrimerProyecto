import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AdminUserDetail,
  type AdminUserPage,
  type AdminUserSummary,
  type ListAdminUsersQuery,
  type SetUserStatusInput,
} from '@letfer/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { escapeLike } from '../common/sql-like.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { projects, roles, users, type UserRow } from '../database/schema/index.js';
import { SessionService } from '../sessions/session.service.js';
import { UsersService } from '../users/users.service.js';
import { AccountProtectionService } from './account-protection.service.js';
import { AccountDeletionsService } from './account-deletions.service.js';

const userNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Usuario no encontrado.');

/**
 * Gestión de usuarios por el Administrador Global (§4.1, §8, §111.3): listar, consultar y
 * deshabilitar o reactivar cuentas. Nunca se elimina físicamente a nadie; la eliminación pasa por
 * una solicitud (`AccountDeletionsService`). Las reglas de protección viven en
 * `AccountProtectionService`.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly protection: AccountProtectionService,
    private readonly deletions: AccountDeletionsService,
  ) {}

  async list(query: ListAdminUsersQuery): Promise<AdminUserPage> {
    const conditions: (SQL | undefined)[] = [];
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        sql`(${users.firstName} || ' ' || ${users.lastName} || ' ' || ${users.email}) ILIKE ${pattern}`,
      );
    }
    const where = and(...conditions);

    const [count] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where);
    const rows = await this.db
      .select({
        user: users,
        globalRole: roles.key,
        ownedProjectCount: sql<number>`(SELECT count(*)::int FROM ${projects} WHERE ${projects.ownerId} = ${users.id})`,
        hasPendingDeletionRequest: sql<boolean>`EXISTS (SELECT 1 FROM account_deletion_requests r WHERE r.user_id = ${users.id} AND r.status = 'PENDING')`,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.globalRoleId))
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit)
      .offset(query.offset);

    return {
      items: rows.map((row) =>
        this.toSummary(
          row.user,
          row.globalRole ?? '',
          row.ownedProjectCount,
          row.hasPendingDeletionRequest,
        ),
      ),
      total: count?.total ?? 0,
    };
  }

  async detail(userId: string): Promise<AdminUserDetail> {
    const [row] = await this.db
      .select({ user: users, globalRole: roles.key })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.globalRoleId))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw userNotFound();

    const ownedProjects = await this.db
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(eq(projects.ownerId, userId))
      .orderBy(projects.name);
    const activeSessions = await this.sessions.listActive(userId);
    const deletionRequest = await this.deletions.latestFor(userId);

    return {
      ...this.toSummary(
        row.user,
        row.globalRole ?? '',
        ownedProjects.length,
        deletionRequest?.status === 'PENDING',
      ),
      deletedAt: row.user.deletedAt ? row.user.deletedAt.toISOString() : null,
      ownedProjects,
      activeSessionCount: activeSessions.length,
      deletionRequest,
    };
  }

  /** Deshabilita una cuenta activa: cierra sus sesiones y le impide iniciar sesión (§104.6). */
  async disable(actor: UserRow, targetId: string, input: SetUserStatusInput): Promise<void> {
    await this.protection.guard(
      { actor, targetUserId: targetId, attempted: 'disable' },
      async (tx) => {
        const target = await this.lock(tx, targetId);
        if (target.status !== 'ACTIVE') {
          throw new AppError(
            409,
            ErrorCode.INVALID_STATE,
            'Solo se puede deshabilitar una cuenta activa.',
          );
        }
        await this.protection.assertCanDeactivate(tx, target);
        await this.users.setStatus(
          target.id,
          'DISABLED',
          { actorUserId: actor.id, expectedVersion: input.version, ...reasonOf(input) },
          tx,
        );
      },
    );
  }

  /** Reactiva una cuenta deshabilitada. Una cuenta eliminada no se reactiva desde aquí. */
  async enable(actor: UserRow, targetId: string, input: SetUserStatusInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const target = await this.lock(tx, targetId);
      if (target.status !== 'DISABLED') {
        throw new AppError(
          409,
          ErrorCode.INVALID_STATE,
          'Solo se puede reactivar una cuenta deshabilitada.',
        );
      }
      await this.users.setStatus(
        target.id,
        'ACTIVE',
        { actorUserId: actor.id, expectedVersion: input.version, ...reasonOf(input) },
        tx,
      );
    });
  }

  private async lock(executor: DbExecutor, userId: string): Promise<UserRow> {
    const [target] = await executor
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    if (!target) throw userNotFound();
    return target;
  }

  private toSummary(
    user: UserRow,
    globalRole: string,
    ownedProjectCount: number,
    hasPendingDeletionRequest: boolean,
  ): AdminUserSummary {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      status: user.status,
      globalRole,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      version: user.version,
      ownedProjectCount,
      hasPendingDeletionRequest,
    };
  }
}

function reasonOf(input: SetUserStatusInput): { reason?: string } {
  return input.reason ? { reason: input.reason } : {};
}
