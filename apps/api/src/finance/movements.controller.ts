import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import {
  createDepositSchema,
  createExtraordinaryMovementSchema,
  createTransferSchema,
  type CreateDepositInput,
  type CreateExtraordinaryMovementInput,
  type CreateTransferInput,
  type MovementSummary,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { MovementsService } from './movements.service.js';

@Controller('projects/:projectId/movements')
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Get()
  @ProjectRoute('movements.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<MovementSummary[]> {
    return this.movements.list(access);
  }

  @Post('deposits')
  @ProjectRoute('movements.deposit')
  @Header('Cache-Control', 'no-store')
  deposit(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createDepositSchema }) body: CreateDepositInput,
  ): Promise<MovementSummary> {
    return this.movements.deposit(access, auth.user, body);
  }

  @Post('transfers')
  @ProjectRoute('movements.transfer')
  @Header('Cache-Control', 'no-store')
  transfer(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createTransferSchema }) body: CreateTransferInput,
  ): Promise<MovementSummary> {
    return this.movements.transfer(access, auth.user, body);
  }

  /** Extraordinario (§16.4): exige contraseña reciente (D6). */
  @Post('extraordinary')
  @ProjectRoute('movements.extraordinary')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  extraordinary(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createExtraordinaryMovementSchema }) body: CreateExtraordinaryMovementInput,
  ): Promise<MovementSummary> {
    return this.movements.extraordinary(access, auth.user, body);
  }
}
