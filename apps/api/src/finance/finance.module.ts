import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { HousesController } from './houses.controller.js';
import { HousesService } from './houses.service.js';
import { MovementsController } from './movements.controller.js';
import { MovementsService } from './movements.service.js';
import { ProjectSetupController } from './project-setup.controller.js';
import { ProjectSetupService } from './project-setup.service.js';
import { StagesController } from './stages.controller.js';
import { StagesService } from './stages.service.js';
import { WithdrawalsController } from './withdrawals.controller.js';
import { WithdrawalsService } from './withdrawals.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [
    ProjectSetupController,
    StagesController,
    HousesController,
    MovementsController,
    WithdrawalsController,
  ],
  providers: [
    ProjectSetupService,
    StagesService,
    HousesService,
    MovementsService,
    WithdrawalsService,
  ],
  exports: [
    ProjectSetupService,
    StagesService,
    HousesService,
    MovementsService,
    WithdrawalsService,
  ],
})
export class FinanceModule {}
