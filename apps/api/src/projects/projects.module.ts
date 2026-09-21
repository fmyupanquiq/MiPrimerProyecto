import { Module } from '@nestjs/common';
import { ProjectLifecycleService } from './project-lifecycle.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectLifecycleService],
  exports: [ProjectsService, ProjectLifecycleService],
})
export class ProjectsModule {}
