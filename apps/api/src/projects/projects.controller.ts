import { Body, Controller, Get, Header, HttpCode, Patch, Post, Query } from '@nestjs/common';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  reasonSchema,
  transferOwnershipSchema,
  updateProjectSchema,
  ErrorCode,
  type CreateProjectInput,
  type ListProjectsQuery,
  type ProjectDetail,
  type ProjectSummary,
  type ReasonInput,
  type TransferOwnershipInput,
  type UpdateProjectInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import { AppError } from '../common/app-error.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import {
  CurrentProject,
  ProjectRoute,
  RequireGlobalPermission,
} from '../authorization/decorators.js';
import { ProjectLifecycleService } from './project-lifecycle.service.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly lifecycle: ProjectLifecycleService,
  ) {}

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

  /** Cierra el proyecto (ACTIVE → CLOSED). Exige reautenticación reciente (§105.5). */
  @Post(':projectId/close')
  @HttpCode(200)
  @ProjectRoute('project.close')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async close(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
  ): Promise<ProjectDetail> {
    await this.lifecycle.close(access.project.id, auth.user);
    return this.projectsService.detailFor(auth.user, access.project.id);
  }

  /** Reabre el proyecto (CLOSED → ACTIVE): propietario y Administrador Global. */
  @Post(':projectId/reopen')
  @HttpCode(200)
  @ProjectRoute('project.reopen')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async reopen(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
  ): Promise<ProjectDetail> {
    await this.lifecycle.reopen(access.project.id, auth.user);
    return this.projectsService.detailFor(auth.user, access.project.id);
  }

  /** Envía el proyecto a la papelera (restaurable al menos 90 días). */
  @Post(':projectId/trash')
  @HttpCode(200)
  @ProjectRoute('project.trash')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async sendToTrash(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: reasonSchema }) body: ReasonInput,
  ): Promise<{ id: string; status: 'TRASHED' }> {
    const project = await this.lifecycle.trash(access.project.id, auth.user, body.reason);
    return { id: project.id, status: 'TRASHED' };
  }

  /** Restaura un proyecto de la papelera a su estado anterior. */
  @Post(':projectId/restore')
  @HttpCode(200)
  @ProjectRoute('project.restore', { allowTrashed: true })
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
  ): Promise<ProjectDetail> {
    await this.lifecycle.restore(access.project.id, auth.user);
    return this.projectsService.detailFor(auth.user, access.project.id);
  }

  /**
   * Transfiere la propiedad del proyecto a otro miembro activo. Solo el Administrador Global
   * (permiso global `projects.transfer_ownership`) y con reautenticación reciente (F4).
   */
  @Post(':projectId/transfer-ownership')
  @HttpCode(200)
  @ProjectRoute('projects.transfer_ownership')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  async transferOwnership(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: transferOwnershipSchema }) body: TransferOwnershipInput,
  ): Promise<ProjectDetail> {
    await this.projectsService.transferOwnership(auth.user, access.project.id, body.newOwnerId);
    return this.projectsService.detailFor(auth.user, access.project.id);
  }
}
