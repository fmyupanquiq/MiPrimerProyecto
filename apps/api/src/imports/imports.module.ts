import { Module } from '@nestjs/common';
import { ImportAuditService } from './import-audit.service.js';
import { ImportWriterService } from './import-writer.service.js';

/**
 * Importación del historial (Fase 9, §113). Aporta la auditoría por lote (9.1.3) y el escritor
 * de importación con la anulación de lotes (9.1.5); los endpoints llegan en fases posteriores.
 */
@Module({
  providers: [ImportAuditService, ImportWriterService],
  exports: [ImportAuditService, ImportWriterService],
})
export class ImportsModule {}
