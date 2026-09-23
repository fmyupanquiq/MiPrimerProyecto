import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  dashboardFiltersSchema,
  ErrorCode,
  type BankrollChart,
  type DashboardAnalysis,
  type DashboardFilters,
  type DashboardStatus,
  type PerformanceChart,
} from '@letfer/shared';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Dashboard y métricas (§33, §34, §108). Sin permiso `dashboard.view` propio (D-M8, §108.8): se
 * exige la combinación `bets.view` + `houses.view` + `movements.view`, verificada aquí igual que
 * ya hace `BetsController` con el filtro `?status=TRASHED` — hoy la tienen todos los roles de
 * proyecto (Administrador, Colaborador, Lector), pero la comprobación explícita evita que un rol
 * futuro con solo una parte del combo vea el tablero por accidente.
 */
@Controller('projects/:projectId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('status')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  status(@CurrentProject() access: ProjectAccess): Promise<DashboardStatus> {
    this.assertDashboardAccess(access);
    return this.dashboard.status(access);
  }

  @Get('analysis')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  analysis(
    @CurrentProject() access: ProjectAccess,
    @Query({ schema: dashboardFiltersSchema }) query: DashboardFilters,
  ): Promise<DashboardAnalysis> {
    this.assertDashboardAccess(access);
    return this.dashboard.analysis(access, query);
  }

  @Get('bankroll-chart')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  bankrollChart(@CurrentProject() access: ProjectAccess): Promise<BankrollChart> {
    this.assertDashboardAccess(access);
    return this.dashboard.bankrollChart(access);
  }

  @Get('performance-chart')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  performanceChart(@CurrentProject() access: ProjectAccess): Promise<PerformanceChart> {
    this.assertDashboardAccess(access);
    return this.dashboard.performanceChart(access);
  }

  private assertDashboardAccess(access: ProjectAccess): void {
    if (!access.permissions.has('houses.view') || !access.permissions.has('movements.view')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
    }
  }
}
