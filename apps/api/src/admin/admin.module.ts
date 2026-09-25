import { Module } from '@nestjs/common';
import { BackupsModule } from '../backups/backups.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  AdminAccountDeletionsController,
  MyAccountDeletionController,
} from './account-deletions.controller.js';
import { AccountDeletionsService } from './account-deletions.service.js';
import { AccountProtectionService } from './account-protection.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

/** Administración de la instancia (Fase 8, §111, ADR 0018). */
@Module({
  imports: [UsersModule, SessionsModule, BackupsModule],
  controllers: [
    AdminUsersController,
    MyAccountDeletionController,
    AdminAccountDeletionsController,
    MaintenanceController,
  ],
  providers: [
    AccountProtectionService,
    AccountDeletionsService,
    AdminUsersService,
    MaintenanceService,
  ],
  exports: [AccountProtectionService, MaintenanceService],
})
export class AdminModule {}
