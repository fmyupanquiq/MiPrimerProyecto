import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  saveBetDraftSchema,
  updateBetDraftSchema,
  type BetDraftDetail,
  type BetDraftSummary,
  type SaveBetDraftInput,
  type UpdateBetDraftInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { BetDraftsService } from './bet-drafts.service.js';

/**
 * Borradores de "Añadir apuesta" (ADR 0024). Exigen `bets.create` (quien puede registrar apuestas puede
 * guardar borradores) y solo ven los suyos. No hay ninguna ruta de lectura cruzada.
 */
@Controller('projects/:projectId/bet-drafts')
export class BetDraftsController {
  constructor(private readonly drafts: BetDraftsService) {}

  @Get()
  @ProjectRoute('bets.create')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentProject() access: ProjectAccess,
    @CurrentAuth() auth: AuthContext,
  ): Promise<BetDraftSummary[]> {
    return this.drafts.list(access, auth.user);
  }

  @Get(':draftId')
  @ProjectRoute('bets.create')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentProject() access: ProjectAccess,
    @CurrentAuth() auth: AuthContext,
    @Param('draftId') draftId: string,
  ): Promise<BetDraftDetail> {
    return this.drafts.get(access, auth.user, draftId);
  }

  @Post()
  @ProjectRoute('bets.create')
  create(
    @CurrentProject() access: ProjectAccess,
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: saveBetDraftSchema }) body: SaveBetDraftInput,
  ): Promise<BetDraftDetail> {
    return this.drafts.create(access, auth.user, body);
  }

  @Put(':draftId')
  @ProjectRoute('bets.create')
  update(
    @CurrentProject() access: ProjectAccess,
    @CurrentAuth() auth: AuthContext,
    @Param('draftId') draftId: string,
    @Body({ schema: updateBetDraftSchema }) body: UpdateBetDraftInput,
  ): Promise<BetDraftDetail> {
    return this.drafts.update(access, auth.user, draftId, body);
  }

  @Delete(':draftId')
  @HttpCode(204)
  @ProjectRoute('bets.create')
  async discard(
    @CurrentProject() access: ProjectAccess,
    @CurrentAuth() auth: AuthContext,
    @Param('draftId') draftId: string,
  ): Promise<void> {
    await this.drafts.discard(access, auth.user, draftId);
  }
}
