import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';
import { MaintenanceModeService } from './maintenance-mode.service.js';

@Module({
  controllers: [BackupsController],
  providers: [BackupsService, MaintenanceModeService],
  exports: [BackupsService, MaintenanceModeService],
})
export class BackupsModule {}
