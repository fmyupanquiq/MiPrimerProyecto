import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';

@Module({
  controllers: [BackupsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}
