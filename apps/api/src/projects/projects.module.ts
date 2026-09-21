import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { ProjectLifecycleService } from './project-lifecycle.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController, MembersController, InvitationsController],
  providers: [ProjectsService, ProjectLifecycleService, MembersService, InvitationsService],
  exports: [ProjectsService, ProjectLifecycleService, MembersService, InvitationsService],
})
export class ProjectsModule {}
