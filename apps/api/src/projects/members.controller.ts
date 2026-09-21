import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ErrorCode,
  changeMemberRoleSchema,
  listMembersQuerySchema,
  reasonSchema,
  type AssignableRole,
  type ChangeMemberRoleInput,
  type ListMembersQuery,
  type MemberSummary,
  type ReasonInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { MembersService } from './members.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un `userId` mal formado responde igual que un miembro inexistente. */
function memberIdOrNotFound(userId: string): string {
  if (!UUID.test(userId)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Miembro no encontrado.');
  return userId;
}

@Controller('projects/:projectId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Miembros del proyecto. El correo solo lo ve quien gestiona roles. */
  @Get('members')
  @ProjectRoute('members.view')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentProject() access: ProjectAccess,
    @Query({ schema: listMembersQuerySchema }) query: ListMembersQuery,
  ): Promise<MemberSummary[]> {
    return this.members.list(access, query.status);
  }

  /** Roles que el usuario puede asignar en este proyecto. */
  @Get('assignable-roles')
  @ProjectRoute('members.update_role')
  @Header('Cache-Control', 'no-store')
  assignableRoles(@CurrentProject() access: ProjectAccess): Promise<AssignableRole[]> {
    return this.members.assignableRoles(access);
  }

  /** Cambia el rol de un miembro activo (con `version` de la membresía). */
  @Patch('members/:userId')
  @ProjectRoute('members.update_role')
  @Header('Cache-Control', 'no-store')
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('userId') userId: string,
    @Body({ schema: changeMemberRoleSchema }) body: ChangeMemberRoleInput,
  ): Promise<MemberSummary> {
    return this.members.changeRole(access, auth.user, memberIdOrNotFound(userId), body);
  }

  /** Expulsa a un miembro (queda `REMOVED`). */
  @Delete('members/:userId')
  @HttpCode(204)
  @ProjectRoute('members.remove')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('userId') userId: string,
    @Body({ schema: reasonSchema }) body: ReasonInput,
  ): Promise<void> {
    await this.members.remove(access, auth.user, memberIdOrNotFound(userId), body.reason);
  }

  /** El usuario abandona el proyecto (cualquier miembro activo salvo el propietario). */
  @Post('leave')
  @HttpCode(204)
  @ProjectRoute('project.view')
  async leave(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
  ): Promise<void> {
    await this.members.leave(access, auth.user);
  }
}
