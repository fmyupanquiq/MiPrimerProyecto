import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  listAdminUsersQuerySchema,
  setUserStatusSchema,
  type AdminUserDetail,
  type AdminUserPage,
  type ListAdminUsersQuery,
  type SetUserStatusInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import { RequireGlobalPermission } from '../authorization/decorators.js';
import { uuidOrNotFound } from '../common/uuid.js';
import { AdminUsersService } from './admin-users.service.js';

const userId = (value: string) => uuidOrNotFound(value, 'Usuario no encontrado.');

/** Gestión de usuarios (§111.3): exclusiva del Administrador Global. */
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @RequireGlobalPermission('system.users.view')
  @Header('Cache-Control', 'no-store')
  list(
    @Query({ schema: listAdminUsersQuerySchema }) query: ListAdminUsersQuery,
  ): Promise<AdminUserPage> {
    return this.adminUsers.list(query);
  }

  @Get(':userId')
  @RequireGlobalPermission('system.users.view')
  @Header('Cache-Control', 'no-store')
  detail(@Param('userId') id: string): Promise<AdminUserDetail> {
    return this.adminUsers.detail(userId(id));
  }

  /**
   * Deshabilitar exige reautenticación reciente (§39). La protección impide dejar el sistema sin
   * Administrador Global y deshabilitar a quien aún es propietario de proyectos.
   */
  @Post(':userId/disable')
  @HttpCode(200)
  @RequireGlobalPermission('system.users.manage')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async disable(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') id: string,
    @Body({ schema: setUserStatusSchema }) body: SetUserStatusInput,
  ): Promise<AdminUserDetail> {
    await this.adminUsers.disable(auth.user, userId(id), body);
    return this.adminUsers.detail(id);
  }

  @Post(':userId/enable')
  @HttpCode(200)
  @RequireGlobalPermission('system.users.manage')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async enable(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') id: string,
    @Body({ schema: setUserStatusSchema }) body: SetUserStatusInput,
  ): Promise<AdminUserDetail> {
    await this.adminUsers.enable(auth.user, userId(id), body);
    return this.adminUsers.detail(id);
  }

  /** Cierra todas las sesiones de la persona (p. ej. cuenta comprometida): reautenticación reciente. */
  @Post(':userId/revoke-sessions')
  @HttpCode(200)
  @RequireGlobalPermission('system.users.manage')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async revokeSessions(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') id: string,
  ): Promise<{ revoked: number }> {
    return { revoked: await this.adminUsers.revokeSessions(auth.user, userId(id)) };
  }
}
