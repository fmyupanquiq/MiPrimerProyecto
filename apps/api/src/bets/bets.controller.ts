import { Body, Controller, Get, Header, HttpCode, Param, Post, Patch, Query } from '@nestjs/common';
import {
  confirmBetReturnSchema,
  createBetSchema,
  listBetsQuerySchema,
  moveBetStageSchema,
  settleBetSchema,
  trashBetSchema,
  updateBetSchema,
  ErrorCode,
  type BetDetail,
  type BetSummary,
  type ConfirmBetReturnInput,
  type CreateBetInput,
  type ListBetsQuery,
  type MoveBetStageInput,
  type ReturnDifferencesReport,
  type SettleBetInput,
  type TrashBetInput,
  type UnconfirmedReturnItem,
  type UpdateBetInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth, RequireRecentAuthWhen } from '../auth/recent-auth.guard.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { BetsService } from './bets.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un `betId` mal formado responde igual que una apuesta inexistente. */
function betIdOrNotFound(betId: string): string {
  if (!UUID.test(betId)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Apuesta no encontrada.');
  return betId;
}

/**
 * Apuestas (§18-§27, §90, §107). Las acciones que dependen de la propiedad (editar, papelera)
 * se protegen aquí con el permiso mínimo (`bets.view`); el servicio aplica la regla real de
 * `_own`/`_any` (D-B5) porque necesita conocer quién creó la apuesta. Liquidar (`settle`) es una
 * operación financiera con efecto real en el ledger: se protege con su propio permiso
 * (`bets.settle`), sin variante `_own`, igual que el resto de acciones que tocan el ledger
 * (revisión de arquitectura previa a integrar la Fase 4).
 */
@Controller('projects/:projectId/bets')
export class BetsController {
  constructor(private readonly bets: BetsService) {}

  @Get()
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentProject() access: ProjectAccess,
    @Query({ schema: listBetsQuerySchema }) query: ListBetsQuery,
  ): Promise<BetSummary[]> {
    if (query.status === 'TRASHED' && !access.permissions.has('bets.restore')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción.');
    }
    return this.bets.list(access, query);
  }

  /** Ganadas liquidadas con retorno calculado, pendientes de confirmar el oficial (§77, §112.2). */
  @Get('unconfirmed-returns')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  unconfirmedReturns(@CurrentProject() access: ProjectAccess): Promise<UnconfirmedReturnItem[]> {
    return this.bets.unconfirmedReturns(access);
  }

  /** Comparación de retornos calculados y oficiales (evidencia para el redondeo, D-B8). */
  @Get('return-differences')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  returnDifferences(@CurrentProject() access: ProjectAccess): Promise<ReturnDifferencesReport> {
    return this.bets.returnDifferences(access);
  }

  @Get(':betId')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
  ): Promise<BetDetail> {
    return this.bets.detail(access, betIdOrNotFound(betId));
  }

  @Post()
  @ProjectRoute('bets.create')
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createBetSchema }) body: CreateBetInput,
  ): Promise<BetDetail> {
    return this.bets.create(access, auth.user, body);
  }

  /** `PENDING` admite todo; una apuesta liquidada, solo motivo y fecha de colocación (§107.9). */
  @Patch(':betId')
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
    @Body({ schema: updateBetSchema }) body: UpdateBetInput,
  ): Promise<BetDetail> {
    return this.bets.update(access, auth.user, betIdOrNotFound(betId), body);
  }

  /**
   * Confirma el retorno oficial de una ganada liquidada con retorno calculado (§77, §112.2). Sin
   * diferencia no exige reautenticación; si difiere, hace falta `acknowledgeDifference: true`, que
   * sí la exige (D-A12). El Colaborador no puede (D-A8), tampoco en sus propias apuestas.
   */
  @Post(':betId/confirm-return')
  @HttpCode(200)
  @ProjectRoute('bets.confirm_return')
  @RequireRecentAuthWhen(
    (body) =>
      typeof body === 'object' &&
      body !== null &&
      (body as { acknowledgeDifference?: unknown }).acknowledgeDifference === true,
  )
  @Header('Cache-Control', 'no-store')
  confirmReturn(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
    @Body({ schema: confirmBetReturnSchema }) body: ConfirmBetReturnInput,
  ): Promise<BetDetail> {
    return this.bets.confirmReturn(access, auth.user, betIdOrNotFound(betId), body);
  }

  /** Operación financiera (inserta en el ledger): de administrador, no depende de la propiedad. */
  @Post(':betId/settle')
  @HttpCode(200)
  @ProjectRoute('bets.settle')
  @Header('Cache-Control', 'no-store')
  settle(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
    @Body({ schema: settleBetSchema }) body: SettleBetInput,
  ): Promise<BetDetail> {
    return this.bets.settle(access, auth.user, betIdOrNotFound(betId), body);
  }

  /** Solo administradores autorizados (§25); exige reautenticación, como corregir la unidad. */
  @Post(':betId/move-stage')
  @HttpCode(200)
  @ProjectRoute('bets.move_stage')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  moveStage(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
    @Body({ schema: moveBetStageSchema }) body: MoveBetStageInput,
  ): Promise<BetDetail> {
    return this.bets.moveStage(access, auth.user, betIdOrNotFound(betId), body);
  }

  @Post(':betId/trash')
  @HttpCode(200)
  @ProjectRoute('bets.view')
  @Header('Cache-Control', 'no-store')
  async trash(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
    @Body({ schema: trashBetSchema }) body: TrashBetInput,
  ): Promise<{ id: string }> {
    const id = betIdOrNotFound(betId);
    await this.bets.trash(access, auth.user, id, body);
    return { id };
  }

  @Post(':betId/restore')
  @HttpCode(200)
  @ProjectRoute('bets.restore')
  @Header('Cache-Control', 'no-store')
  async restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('betId') betId: string,
  ): Promise<{ id: string }> {
    const id = betIdOrNotFound(betId);
    await this.bets.restore(access, auth.user, id);
    return { id };
  }
}
