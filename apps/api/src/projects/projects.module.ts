import { Module } from '@nestjs/common';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { ProjectLifecycleService } from './project-lifecycle.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController, MembersController],
  providers: [ProjectsService, ProjectLifecycleService, MembersService],
  exports: [ProjectsService, ProjectLifecycleService, MembersService],
})
export class ProjectsModule {}
