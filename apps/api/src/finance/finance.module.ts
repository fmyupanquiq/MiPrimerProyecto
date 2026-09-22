import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectSetupController } from './project-setup.controller.js';
import { ProjectSetupService } from './project-setup.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [ProjectSetupController],
  providers: [ProjectSetupService],
  exports: [ProjectSetupService],
})
export class FinanceModule {}
