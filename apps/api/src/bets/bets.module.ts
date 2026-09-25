import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { BetCorrectionsService } from './bet-corrections.service.js';
import { BetsController } from './bets.controller.js';
import { BetsService } from './bets.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [BetsController],
  providers: [BetCorrectionsService, BetsService],
  exports: [BetsService],
})
export class BetsModule {}
