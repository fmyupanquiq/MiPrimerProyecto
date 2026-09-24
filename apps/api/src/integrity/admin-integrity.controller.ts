import { Controller, Get, Header, Post } from '@nestjs/common';
import type { IntegrityCheckRunSummary } from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireGlobalPermission } from '../authorization/decorators.js';
import { IntegrityService } from './integrity.service.js';

/** Verificación de integridad global, sobre todos los proyectos (§109.2, D-I3, Administrador Global). */
@Controller('admin/integrity-checks')
export class AdminIntegrityController {
  constructor(private readonly integrity: IntegrityService) {}

  @Get()
  @RequireGlobalPermission('system.integrity.run')
  @Header('Cache-Control', 'no-store')
  list(): Promise<IntegrityCheckRunSummary[]> {
    return this.integrity.list(undefined);
  }

  @Post()
  @RequireGlobalPermission('system.integrity.run')
  @Header('Cache-Control', 'no-store')
  run(@CurrentAuth() auth: AuthContext): Promise<IntegrityCheckRunSummary> {
    return this.integrity.run(auth.user, undefined);
  }
}
