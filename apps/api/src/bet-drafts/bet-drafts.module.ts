import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { BetDraftsController } from './bet-drafts.controller.js';
import { BetDraftsService } from './bet-drafts.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [BetDraftsController],
  providers: [BetDraftsService],
})
export class BetDraftsModule {}
