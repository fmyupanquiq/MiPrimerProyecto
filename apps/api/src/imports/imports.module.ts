import { Module } from '@nestjs/common';
import { ImportAuditService } from './import-audit.service.js';

/**
 * Importación del historial (Fase 9, §113). En la 9.1.3 solo aporta la auditoría por lote; el
 * escritor de importación llegará en la 9.1.5 y los endpoints, en fases posteriores.
 */
@Module({
  providers: [ImportAuditService],
  exports: [ImportAuditService],
})
export class ImportsModule {}
