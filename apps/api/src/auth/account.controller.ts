import { Body, Controller, Header, HttpCode, Patch, Post } from '@nestjs/common';
import {
  changeEmailSchema,
  changePasswordSchema,
  reauthSchema,
  updateProfileSchema,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type PublicUser,
  type ReauthInput,
  type UpdateProfileInput,
} from '@letfer/shared';
import { AuthRateLimit } from '../common/rate-limit.js';
import { toPublicUser } from '../users/users.service.js';
import { AccountService } from './account.service.js';
import { CurrentAuth, type AuthContext } from './auth-context.js';

/** Operaciones del usuario autenticado sobre su propia cuenta. */
@Controller()
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  /** Confirma la contraseña para poder ejecutar acciones sensibles durante 5 minutos (§39). */
  @Post('auth/reauth')
  @AuthRateLimit()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reauth(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: reauthSchema }) body: ReauthInput,
  ): Promise<{ reauthenticatedAt: string }> {
    const at = await this.accountService.reauthenticate(auth, body.password);
    return { reauthenticatedAt: at.toISOString() };
  }

  /** Cambia la contraseña; cierra las demás sesiones y conserva la actual. */
  @Post('auth/password/change')
  @AuthRateLimit()
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordInput,
  ): Promise<void> {
    await this.accountService.changePassword(auth, body);
  }

  /** Edita nombre y apellido. Solo esos campos: el resto del perfil no se puede modificar aquí. */
  @Patch('users/me')
  @Header('Cache-Control', 'no-store')
  async updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: updateProfileSchema }) body: UpdateProfileInput,
  ): Promise<PublicUser> {
    return toPublicUser(await this.accountService.updateProfile(auth, body), auth.globalRoleKey);
  }

  /** Cambia el correo confirmando la contraseña. */
  @Post('users/me/email')
  @AuthRateLimit()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async changeEmail(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: changeEmailSchema }) body: ChangeEmailInput,
  ): Promise<PublicUser> {
    return toPublicUser(await this.accountService.changeEmail(auth, body), auth.globalRoleKey);
  }
}
