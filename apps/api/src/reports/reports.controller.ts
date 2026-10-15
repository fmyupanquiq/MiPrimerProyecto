import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import {
  ErrorCode,
  reportFiltersSchema,
  reportPdfQuerySchema,
  type ReportData,
  type ReportFilters,
  type ReportPdfQuery,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { fullName } from '../projects/project-mappers.js';
import { ReportsService } from './reports.service.js';

/**
 * Reportes e informes PDF (§108.11). Mismos permisos que el dashboard (D-M8, §108.8): `bets.view`
 * + `houses.view` + `movements.view`; quien no es miembro recibe 404 (lo resuelve `ProjectRoute`).
 * Las imágenes de tickets solo se incluyen además con `tickets.view`. Solo lectura.
 */
@Controller('projects/:projectId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('data')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  data(
    @CurrentProject() access: ProjectAccess,
    @Query({ schema: reportFiltersSchema }) query: ReportFilters,
  ): Promise<ReportData> {
    this.assertReportAccess(access);
    return this.reports.data(access, query);
  }

  /** El PDF se genera al pedirlo y se envía como descarga: nunca se guarda ni tiene URL pública. */
  @Get('pdf')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'private, no-store')
  async pdf(
    @CurrentProject() access: ProjectAccess,
    @CurrentAuth() auth: AuthContext,
    @Query({ schema: reportPdfQuerySchema }) query: ReportPdfQuery,
  ): Promise<StreamableFile> {
    this.assertReportAccess(access);
    const { buffer, fileName } = await this.reports.pdf(access, fullName(auth.user), query);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
      length: buffer.length,
    });
  }

  private assertReportAccess(access: ProjectAccess): void {
    if (!access.permissions.has('houses.view') || !access.permissions.has('movements.view')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
    }
  }
}
