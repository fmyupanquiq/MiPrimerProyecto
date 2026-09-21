import { Body, Controller, Get, Header, Patch, Post, Query } from '@nestjs/common';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
  ErrorCode,
  type CreateProjectInput,
  type ListProjectsQuery,
  type ProjectDetail,
  type ProjectSummary,
  type UpdateProjectInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { AppError } from '../common/app-error.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import {
  CurrentProject,
  ProjectRoute,
  RequireGlobalPermission,
} from '../authorization/decorators.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** Crea un proyecto propio: cualquier usuario con `projects.create` (rol USER o Global, §105.1). */
  @Post()
  @RequireGlobalPermission('projects.create')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: createProjectSchema }) body: CreateProjectInput,
  ): Promise<ProjectDetail> {
    return this.projectsService.create(auth.user, body);
  }

  /** "Mis proyectos". Con `?scope=all` (solo Administrador Global) lista todos los proyectos. */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query({ schema: listProjectsQuerySchema }) query: ListProjectsQuery,
  ): Promise<ProjectSummary[]> {
    if (query.scope === 'all' && !auth.globalPermissions.has('projects.list_all')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
    }
    return this.projectsService.list(auth.user, query.scope);
  }

  /** Papelera de proyectos (los propios; todos para quien puede restaurar cualquiera). */
  @Get('trash')
  @Header('Cache-Control', 'no-store')
  trash(@CurrentAuth() auth: AuthContext): Promise<ProjectSummary[]> {
    return this.projectsService.listTrash(auth.user, auth.globalPermissions);
  }

  @Get(':projectId')
  @ProjectRoute('project.view')
  @Header('Cache-Control', 'no-store')
  detail(@CurrentProject() access: ProjectAccess): Promise<ProjectDetail> {
    return this.projectsService.detail(access);
  }

  /** Edita la configuración del proyecto (con `version`). */
  @Patch(':projectId')
  @ProjectRoute('project.update')
  @Header('Cache-Control', 'no-store')
  async update(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: updateProjectSchema }) body: UpdateProjectInput,
  ): Promise<ProjectDetail> {
    await this.projectsService.update(access, auth.user, body);
    // Se vuelve a resolver el acceso para devolver el proyecto ya actualizado.
    return this.projectsService.detailFor(auth.user, access.project.id);
  }
}
