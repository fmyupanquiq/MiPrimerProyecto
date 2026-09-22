import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  correctStageUnitSchema,
  createStageSchema,
  listStagesQuerySchema,
  ErrorCode,
  type CorrectStageUnitInput,
  type CreateStageInput,
  type ListStagesQuery,
  type StageSummary,
  type StageUnitCorrectionPreview,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { StagesService } from './stages.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un `stageId` mal formado responde igual que una etapa inexistente. */
function stageIdOrNotFound(stageId: string): string {
  if (!UUID.test(stageId)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Etapa no encontrada.');
  return stageId;
}

@Controller('projects/:projectId/stages')
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  @Get()
  @ProjectRoute('stages.view')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentProject() access: ProjectAccess,
    @Query({ schema: listStagesQuerySchema }) query: ListStagesQuery,
  ): Promise<StageSummary[]> {
    if (query.status === 'TRASHED' && !access.permissions.has('stages.restore')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
    }
    return this.stages.list(access, query.status);
  }

  /** Crea y activa una nueva etapa, cerrando la actual (§86). */
  @Post()
  @ProjectRoute('stages.create')
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createStageSchema }) body: CreateStageInput,
  ): Promise<StageSummary> {
    return this.stages.create(access, auth.user, body);
  }

  /** Vista previa (por defecto) o aplicación (`confirm: true`) de la corrección de unidad (§12.1). */
  @Post(':stageId/unit')
  @HttpCode(200)
  @ProjectRoute('stages.correct_unit')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  correctUnit(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('stageId') stageId: string,
    @Body({ schema: correctStageUnitSchema }) body: CorrectStageUnitInput,
  ): Promise<StageUnitCorrectionPreview | StageSummary> {
    return this.stages.correctUnit(access, auth.user, stageIdOrNotFound(stageId), body);
  }

  @Post(':stageId/trash')
  @HttpCode(200)
  @ProjectRoute('stages.trash')
  @Header('Cache-Control', 'no-store')
  async trash(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('stageId') stageId: string,
  ): Promise<{ id: string }> {
    const id = stageIdOrNotFound(stageId);
    await this.stages.trash(access, auth.user, id);
    return { id };
  }

  @Post(':stageId/restore')
  @HttpCode(200)
  @ProjectRoute('stages.restore')
  @Header('Cache-Control', 'no-store')
  async restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('stageId') stageId: string,
  ): Promise<{ id: string }> {
    const id = stageIdOrNotFound(stageId);
    await this.stages.restore(access, auth.user, id);
    return { id };
  }
}
