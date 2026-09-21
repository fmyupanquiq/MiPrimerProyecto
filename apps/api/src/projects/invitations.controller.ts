import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import {
  ErrorCode,
  createInvitationSchema,
  type CreateInvitationInput,
  type CreatedInvitation,
  type InvitationSummary,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { InvitationsService } from './invitations.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('projects/:projectId/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * Crea una invitación. La respuesta incluye el enlace y el token una única vez: después solo
   * se conserva su hash y no puede volver a consultarse.
   */
  @Post()
  @ProjectRoute('invitations.create')
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createInvitationSchema }) body: CreateInvitationInput,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(access, auth.user, body);
  }

  @Get()
  @ProjectRoute('invitations.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<InvitationSummary[]> {
    return this.invitations.list(access);
  }

  /** Deshabilita una invitación (idempotente). */
  @Post(':invitationId/disable')
  @HttpCode(200)
  @ProjectRoute('invitations.disable')
  @Header('Cache-Control', 'no-store')
  disable(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('invitationId') invitationId: string,
  ): Promise<InvitationSummary> {
    if (!UUID.test(invitationId)) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Invitación no encontrada.');
    }
    return this.invitations.disable(access, auth.user, invitationId);
  }
}
