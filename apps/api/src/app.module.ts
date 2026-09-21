import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';

@Module({
  imports: [ConfigModule, CommonModule, DatabaseModule, AuditModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
