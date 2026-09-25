import { Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import type { MaintenanceRunSummary } from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireGlobalPermission } from '../authorization/decorators.js';
import { MaintenanceService } from './maintenance.service.js';

/**
 * Mantenimiento de la instancia (§111.6): purga de registros auxiliares caducados. Exclusivo del
 * Administrador Global (`system.maintenance.run`). No exige reautenticación: solo elimina
 * registros que ya no valen y nunca datos de negocio ni auditoría.
 */
@Controller('admin/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('runs')
  @RequireGlobalPermission('system.maintenance.run')
  @Header('Cache-Control', 'no-store')
  runs(): Promise<MaintenanceRunSummary[]> {
    return this.maintenance.list();
  }

  @Post('purge')
  @HttpCode(200)
  @RequireGlobalPermission('system.maintenance.run')
  @Header('Cache-Control', 'no-store')
  purge(@CurrentAuth() auth: AuthContext): Promise<MaintenanceRunSummary> {
    return this.maintenance.purge('MANUAL', auth.user);
  }
}
