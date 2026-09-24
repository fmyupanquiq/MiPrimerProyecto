import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { AdminIntegrityController } from './admin-integrity.controller.js';
import { IntegrityController } from './integrity.controller.js';
import { IntegrityService } from './integrity.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [IntegrityController, AdminIntegrityController],
  providers: [IntegrityService],
  exports: [IntegrityService],
})
export class IntegrityModule {}
