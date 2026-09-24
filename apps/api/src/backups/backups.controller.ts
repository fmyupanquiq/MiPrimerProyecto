import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import {
  restoreBackupSchema,
  type BackupGeneration,
  type RestoreBackupInput,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import { RequireGlobalPermission } from '../authorization/decorators.js';
import { BackupsService } from './backups.service.js';

/**
 * Backups y recuperación (§37, §82, §109.3-4). Nivel de instancia, no de proyecto: solo el
 * Administrador Global (§37).
 */
@Controller('admin/backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @RequireGlobalPermission('system.backups.view')
  @Header('Cache-Control', 'no-store')
  list(): Promise<BackupGeneration[]> {
    return this.backups.list();
  }

  @Post()
  @RequireGlobalPermission('system.backups.create')
  @Header('Cache-Control', 'no-store')
  create(): Promise<BackupGeneration> {
    return this.backups.createBackup('MANUAL');
  }

  /** Restaurar exige reautenticación y confirmación fuerte (D-R1, §37). */
  @Post('restore')
  @HttpCode(200)
  @RequireGlobalPermission('system.backups.restore')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  restore(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: restoreBackupSchema }) body: RestoreBackupInput,
  ): Promise<BackupGeneration> {
    return this.backups.restore(auth.user, body.generationId, body.confirmation);
  }
}
