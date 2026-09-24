import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { FILE_STORAGE } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/**
 * Tickets e IA (§110, ADR 0017). Expone `FILE_STORAGE` (D-T2) además de sus propios
 * proveedores; `AiModule` aporta `TICKET_READER` (D-T1).
 */
@Module({
  imports: [AiModule],
  controllers: [TicketsController],
  providers: [TicketsService, { provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [TicketsService],
})
export class TicketsModule {}
