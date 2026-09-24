import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { BackupsModule } from './backups/backups.module.js';
import { BetsModule } from './bets/bets.module.js';
import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MailModule } from './mail/mail.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { IntegrityModule } from './integrity/integrity.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ReconciliationsModule } from './reconciliations/reconciliations.module.js';
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
    FinanceModule,
    BetsModule,
    DashboardModule,
    ReconciliationsModule,
    IntegrityModule,
    BackupsModule,
    RegistrationModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
