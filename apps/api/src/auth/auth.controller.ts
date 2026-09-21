import { Body, Controller, Get, Header, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { loginSchema, type AuthState, type LoginInput } from '@letfer/shared';
import type { Response } from 'express';
import { AuthRateLimit } from '../common/rate-limit.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { CurrentAuth, Public, type AuthContext } from './auth-context.js';
import { toAuthState } from './auth-state.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookie, writeSessionCookie } from './session-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Inicia sesión y entrega el token como cookie HttpOnly (nunca en el cuerpo). */
  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthState> {
    const { token, user, session } = await this.authService.login(body);
    writeSessionCookie(response, token, this.config, session.persistent);
    return toAuthState(user, session);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(auth);
    clearSessionCookie(response, this.config);
  }

  /** Usuario y sesión actuales. */
  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentAuth() auth: AuthContext): AuthState {
    return toAuthState(auth.user, auth.session);
  }
}
