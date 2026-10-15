import { Module } from '@nestjs/common';
import { BetsModule } from '../bets/bets.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reportes e informes PDF (§108.11): solo lectura sobre el dashboard, las apuestas y los tickets. */
@Module({
  imports: [DashboardModule, BetsModule, TicketsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
