import { Module } from '@nestjs/common';
import { AnthropicTicketReader } from './anthropic-ticket-reader.service.js';
import { TICKET_READER } from './ticket-reader.js';

/**
 * Servicio de IA desacoplado (§52, D-T1, ADR 0017). Solo expone el token `TICKET_READER`; nadie
 * fuera de este módulo debe importar `AnthropicTicketReader` directamente.
 */
@Module({
  providers: [{ provide: TICKET_READER, useClass: AnthropicTicketReader }],
  exports: [TICKET_READER],
})
export class AiModule {}
