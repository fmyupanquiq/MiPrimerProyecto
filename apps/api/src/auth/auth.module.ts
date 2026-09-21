import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionsModule } from '../sessions/sessions.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { BootstrapAdminService } from './bootstrap-admin.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { OriginGuard } from './origin.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { RecentAuthGuard } from './recent-auth.guard.js';

@Module({
  imports: [UsersModule, SessionsModule],
  controllers: [AuthController, AccountController],
  providers: [
    PasswordHasher,
    BootstrapAdminService,
    LoginAttemptsService,
    AuthService,
    AccountService,
    // Orden de ejecución: origen (CSRF), autenticación y reautenticación reciente.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RecentAuthGuard },
  ],
  exports: [
    PasswordHasher,
    BootstrapAdminService,
    AuthService,
    AccountService,
    LoginAttemptsService,
  ],
})
export class AuthModule {}
