import { Body, Controller, Header, Post } from '@nestjs/common';
import { projectSetupSchema, type ProjectDetail, type ProjectSetupInput } from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { ProjectSetupService } from './project-setup.service.js';

@Controller('projects/:projectId')
export class ProjectSetupController {
  constructor(private readonly setup: ProjectSetupService) {}

  /** Completa la configuración inicial: Etapa 1, unidad, casas y banca (§5, D1). */
  @Post('setup')
  @ProjectRoute('project.setup')
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: projectSetupSchema }) body: ProjectSetupInput,
  ): Promise<ProjectDetail> {
    return this.setup.setup(access, auth.user, body);
  }
}
