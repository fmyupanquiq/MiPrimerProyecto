import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionsModule } from '../sessions/sessions.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { BootstrapAdminService } from './bootstrap-admin.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { OriginGuard } from './origin.guard.js';
import { PasswordHasher } from './password-hasher.js';

@Module({
  imports: [UsersModule, SessionsModule],
  controllers: [AuthController],
  providers: [
    PasswordHasher,
    BootstrapAdminService,
    LoginAttemptsService,
    AuthService,
    // Orden de ejecución: primero el origen (CSRF) y después la autenticación.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordHasher, BootstrapAdminService, AuthService, LoginAttemptsService],
})
export class AuthModule {}
