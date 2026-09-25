import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  decideAccountDeletionSchema,
  listAccountDeletionsQuerySchema,
  requestAccountDeletionSchema,
  type AccountDeletionRequestSummary,
  type DecideAccountDeletionInput,
  type ListAccountDeletionsQuery,
  type MyAccountDeletionState,
  type RequestAccountDeletionInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import { RequireGlobalPermission } from '../authorization/decorators.js';
import { uuidOrNotFound } from '../common/uuid.js';
import { AccountDeletionsService } from './account-deletions.service.js';

/** La persona usuaria solicita, consulta y retira su propia solicitud de eliminación (§8). */
@Controller('users/me/deletion-request')
export class MyAccountDeletionController {
  constructor(private readonly deletions: AccountDeletionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async current(@CurrentAuth() auth: AuthContext): Promise<MyAccountDeletionState> {
    return { request: await this.deletions.latestFor(auth.user.id) };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  request(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: requestAccountDeletionSchema }) body: RequestAccountDeletionInput,
  ): Promise<AccountDeletionRequestSummary> {
    return this.deletions.request(auth.user, body);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  cancel(@CurrentAuth() auth: AuthContext): Promise<AccountDeletionRequestSummary> {
    return this.deletions.cancelOwn(auth.user);
  }
}

const requestId = (value: string) =>
  uuidOrNotFound(value, 'Solicitud de eliminación no encontrada.');

/** Decisión sobre las solicitudes de eliminación de cuenta: solo el Administrador Global (§8). */
@Controller('admin/account-deletions')
export class AdminAccountDeletionsController {
  constructor(private readonly deletions: AccountDeletionsService) {}

  @Get()
  @RequireGlobalPermission('system.account_deletions.decide')
  @Header('Cache-Control', 'no-store')
  list(
    @Query({ schema: listAccountDeletionsQuerySchema }) query: ListAccountDeletionsQuery,
  ): Promise<AccountDeletionRequestSummary[]> {
    return this.deletions.list(query.status);
  }

  /** Aprobar cierra las sesiones y deja la cuenta eliminada: exige reautenticación (§8). */
  @Post(':requestId/approve')
  @HttpCode(200)
  @RequireGlobalPermission('system.account_deletions.decide')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') id: string,
    @Body({ schema: decideAccountDeletionSchema }) body: DecideAccountDeletionInput,
  ): Promise<AccountDeletionRequestSummary> {
    return this.deletions.approve(auth.user, requestId(id), body);
  }

  @Post(':requestId/reject')
  @HttpCode(200)
  @RequireGlobalPermission('system.account_deletions.decide')
  @Header('Cache-Control', 'no-store')
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') id: string,
    @Body({ schema: decideAccountDeletionSchema }) body: DecideAccountDeletionInput,
  ): Promise<AccountDeletionRequestSummary> {
    return this.deletions.reject(auth.user, requestId(id), body);
  }
}
