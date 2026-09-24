import { Controller, Get, Header, Post } from '@nestjs/common';
import type { IntegrityCheckRunSummary } from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { IntegrityService } from './integrity.service.js';

/** Verificación de integridad por proyecto (§38, §109.2, D-I3). Solo lectura, bajo demanda (D-I2). */
@Controller('projects/:projectId/integrity-checks')
export class IntegrityController {
  constructor(private readonly integrity: IntegrityService) {}

  @Get()
  @ProjectRoute('integrity.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<IntegrityCheckRunSummary[]> {
    return this.integrity.list(access.project.id);
  }

  @Post()
  @ProjectRoute('integrity.run')
  @Header('Cache-Control', 'no-store')
  run(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
  ): Promise<IntegrityCheckRunSummary> {
    return this.integrity.run(auth.user, access.project.id);
  }
}
