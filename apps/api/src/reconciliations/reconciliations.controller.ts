import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import {
  confirmReconciliationSchema,
  ErrorCode,
  type ConfirmReconciliationInput,
  type ReconciliationCheckpointSummary,
  type ReconciliationHouseStatus,
  type ReconciliationReview,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { ReconciliationsService } from './reconciliations.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un `houseId` mal formado responde igual que una casa inexistente. */
function houseIdOrNotFound(houseId: string): string {
  if (!UUID.test(houseId)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Casa no encontrada.');
  return houseId;
}

/**
 * Conciliación (§32, §80, §109.1). No exige reautenticación (D-C7): compara y registra, no
 * mueve dinero ni genera movimientos.
 */
@Controller('projects/:projectId/houses/:houseId/reconciliations')
export class ReconciliationsController {
  constructor(private readonly reconciliations: ReconciliationsService) {}

  @Get()
  @ProjectRoute('reconciliations.view')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentProject() access: ProjectAccess,
    @Param('houseId') houseId: string,
  ): Promise<ReconciliationCheckpointSummary[]> {
    return this.reconciliations.list(access, houseIdOrNotFound(houseId));
  }

  @Get('status')
  @ProjectRoute('reconciliations.view')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentProject() access: ProjectAccess,
    @Param('houseId') houseId: string,
  ): Promise<ReconciliationHouseStatus> {
    return this.reconciliations.status(access, houseIdOrNotFound(houseId));
  }

  @Get('review')
  @ProjectRoute('reconciliations.view')
  @Header('Cache-Control', 'no-store')
  review(
    @CurrentProject() access: ProjectAccess,
    @Param('houseId') houseId: string,
  ): Promise<ReconciliationReview> {
    return this.reconciliations.review(access, houseIdOrNotFound(houseId));
  }

  @Post()
  @ProjectRoute('reconciliations.confirm')
  @Header('Cache-Control', 'no-store')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('houseId') houseId: string,
    @Body({ schema: confirmReconciliationSchema }) body: ConfirmReconciliationInput,
  ): Promise<ReconciliationCheckpointSummary> {
    return this.reconciliations.confirm(access, auth.user, houseIdOrNotFound(houseId), body);
  }
}
