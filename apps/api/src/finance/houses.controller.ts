import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import {
  createHouseSchema,
  ErrorCode,
  type CreateHouseInput,
  type HouseSummary,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { HousesService } from './houses.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function houseIdOrNotFound(houseId: string): string {
  if (!UUID.test(houseId)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Casa no encontrada.');
  return houseId;
}

@Controller('projects/:projectId/houses')
export class HousesController {
  constructor(private readonly houses: HousesService) {}

  @Get()
  @ProjectRoute('houses.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<HouseSummary[]> {
    return this.houses.list(access);
  }

  @Post()
  @ProjectRoute('houses.create')
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Body({ schema: createHouseSchema }) body: CreateHouseInput,
  ): Promise<HouseSummary> {
    return this.houses.create(access, auth.user, body);
  }

  @Post(':houseId/deactivate')
  @HttpCode(200)
  @ProjectRoute('houses.deactivate')
  @Header('Cache-Control', 'no-store')
  async deactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('houseId') houseId: string,
  ): Promise<{ id: string }> {
    const id = houseIdOrNotFound(houseId);
    await this.houses.deactivate(access, auth.user, id);
    return { id };
  }

  @Post(':houseId/activate')
  @HttpCode(200)
  @ProjectRoute('houses.deactivate')
  @Header('Cache-Control', 'no-store')
  async activate(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('houseId') houseId: string,
  ): Promise<{ id: string }> {
    const id = houseIdOrNotFound(houseId);
    await this.houses.activate(access, auth.user, id);
    return { id };
  }
}
