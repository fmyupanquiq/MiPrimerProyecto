import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { BetsController } from './bets.controller.js';
import { BetsService } from './bets.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [BetsController],
  providers: [BetsService],
  exports: [BetsService],
})
export class BetsModule {}
