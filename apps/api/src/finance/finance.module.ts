import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectSetupController } from './project-setup.controller.js';
import { ProjectSetupService } from './project-setup.service.js';
import { StagesController } from './stages.controller.js';
import { StagesService } from './stages.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [ProjectSetupController, StagesController],
  providers: [ProjectSetupService, StagesService],
  exports: [ProjectSetupService, StagesService],
})
export class FinanceModule {}
