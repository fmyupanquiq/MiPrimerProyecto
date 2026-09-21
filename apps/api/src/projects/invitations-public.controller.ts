import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import {
  invitationTokenSchema,
  type AcceptInvitationResult,
  type InvitationPreview,
  type InvitationTokenInput,
} from '@letfer/shared';
import { CurrentAuth, Public, type AuthContext } from '../auth/auth-context.js';
import { AuthRateLimit } from '../common/rate-limit.js';
import { InvitationAcceptanceService } from './invitation-acceptance.service.js';

/**
 * Uso de una invitación a partir de su enlace. La vista previa es pública (quien recibe el enlace
 * puede no tener cuenta todavía); aceptar y rechazar exigen sesión. Todas usan el límite estricto.
 */
@Controller('invitations')
export class InvitationsPublicController {
  constructor(private readonly acceptance: InvitationAcceptanceService) {}

  @Post('preview')
  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  preview(
    @Body({ schema: invitationTokenSchema }) body: InvitationTokenInput,
  ): Promise<InvitationPreview> {
    return this.acceptance.preview(body.token);
  }

  @Post('accept')
  @AuthRateLimit()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  accept(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: invitationTokenSchema }) body: InvitationTokenInput,
  ): Promise<AcceptInvitationResult> {
    return this.acceptance.accept(auth.user, body.token);
  }

  @Post('reject')
  @AuthRateLimit()
  @HttpCode(204)
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: invitationTokenSchema }) body: InvitationTokenInput,
  ): Promise<void> {
    await this.acceptance.reject(auth.user, body.token);
  }
}
