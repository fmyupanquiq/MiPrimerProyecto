import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
