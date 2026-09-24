import { Module } from '@nestjs/common';
import { BetsModule } from '../bets/bets.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ReconciliationsController } from './reconciliations.controller.js';
import { ReconciliationsService } from './reconciliations.service.js';

@Module({
  imports: [ProjectsModule, FinanceModule, BetsModule],
  controllers: [ReconciliationsController],
  providers: [ReconciliationsService],
  exports: [ReconciliationsService],
})
export class ReconciliationsModule {}
