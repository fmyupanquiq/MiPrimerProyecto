import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { loginSchema, type AuthState, type LoginInput, type SessionInfo } from '@letfer/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthRateLimit } from '../common/rate-limit.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { CurrentAuth, Public, type AuthContext } from './auth-context.js';
import { toAuthState } from './auth-state.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookie, writeSessionCookie } from './session-cookie.js';

const sessionIdSchema = z.uuid();

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

  /** Sesiones abiertas del usuario (§3). */
  @Get('sessions')
  @Header('Cache-Control', 'no-store')
  async sessions(@CurrentAuth() auth: AuthContext): Promise<{ sessions: SessionInfo[] }> {
    return { sessions: await this.authService.listSessions(auth) };
  }

  /** Revoca una sesión propia. Si es la actual equivale a cerrar sesión. */
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', { schema: sessionIdSchema }) sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.revokeSession(auth, sessionId);
    if (sessionId === auth.session.id) clearSessionCookie(response, this.config);
  }

  /** Cierra todas las sesiones salvo la actual. */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@CurrentAuth() auth: AuthContext): Promise<{ revoked: number }> {
    return { revoked: await this.authService.revokeOtherSessions(auth) };
  }
}
