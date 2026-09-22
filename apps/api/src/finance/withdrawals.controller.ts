import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import {
  decideWithdrawalSchema,
  requestWithdrawalSchema,
  ErrorCode,
  type DecideWithdrawalInput,
  type RequestWithdrawalInput,
  type WithdrawalRequestSummary,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { WithdrawalsService } from './withdrawals.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function withdrawalIdOrNotFound(id: string): string {
  if (!UUID.test(id)) {
    throw new AppError(404, ErrorCode.NOT_FOUND, 'Solicitud de retiro no encontrada.');
  }
  return id;
}

@Controller('projects/:projectId/withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  @ProjectRoute('movements.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<WithdrawalRequestSummary[]> {
    return this.withdrawals.list(access);
  }

  @Post()
  @ProjectRoute('withdrawals.request')
  @Header('Cache-Control', 'no-store')
  request(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: requestWithdrawalSchema }) body: RequestWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    return this.withdrawals.request(access, auth.user, body);
  }

  /** Aprobar mueve dinero: exige contraseña reciente (§79, D6). */
  @Post(':withdrawalId/approve')
  @HttpCode(200)
  @ProjectRoute('withdrawals.approve')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  approve(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('withdrawalId') withdrawalId: string,
    @Body({ schema: decideWithdrawalSchema }) body: DecideWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    return this.withdrawals.approve(access, auth.user, withdrawalIdOrNotFound(withdrawalId), body);
  }

  @Post(':withdrawalId/reject')
  @HttpCode(200)
  @ProjectRoute('withdrawals.approve')
  @Header('Cache-Control', 'no-store')
  reject(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('withdrawalId') withdrawalId: string,
    @Body({ schema: decideWithdrawalSchema }) body: DecideWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    return this.withdrawals.reject(access, auth.user, withdrawalIdOrNotFound(withdrawalId), body);
  }

  /** Cancela la propia solicitud (o, con permiso de aprobar, la de otra persona). */
  @Post(':withdrawalId/cancel')
  @HttpCode(200)
  @ProjectRoute('withdrawals.request')
  @Header('Cache-Control', 'no-store')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('withdrawalId') withdrawalId: string,
    @Body({ schema: decideWithdrawalSchema }) body: DecideWithdrawalInput,
  ): Promise<WithdrawalRequestSummary> {
    return this.withdrawals.cancel(access, auth.user, withdrawalIdOrNotFound(withdrawalId), body);
  }
}
