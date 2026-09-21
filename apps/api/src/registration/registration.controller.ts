import { Body, Controller, Header, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { registerSchema, type AuthState, type RegisterInput } from '@letfer/shared';
import type { Response } from 'express';
import { Public } from '../auth/auth-context.js';
import { toAuthState } from '../auth/auth-state.js';
import { writeSessionCookie } from '../auth/session-cookie.js';
import { AuthRateLimit } from '../common/rate-limit.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { RegistrationService } from './registration.service.js';

@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Crea la cuenta de quien recibió un enlace de invitación y abre sesión (cookie HttpOnly). No
   * acepta la invitación: la persona la acepta o rechaza después.
   */
  @Public()
  @AuthRateLimit()
  @Post('register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async register(
    @Body({ schema: registerSchema }) body: RegisterInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthState> {
    const { token, user, session, globalRoleKey, globalPermissions } =
      await this.registration.register(body);
    writeSessionCookie(response, token, this.config, session.persistent);
    return toAuthState(user, session, globalRoleKey, globalPermissions);
  }
}
