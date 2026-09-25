import { Global, Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service.js';
import { AdminAuditController, ProjectAuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [ProjectAuditController, AdminAuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
