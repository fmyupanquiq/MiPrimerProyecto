import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MailModule } from './mail/mail.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { ProjectsModule } from './projects/projects.module.js';
import { RegistrationModule } from './registration/registration.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    UsersModule,
    MailModule,
    AuthorizationModule,
    AuthModule,
    ProjectsModule,
    RegistrationModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
