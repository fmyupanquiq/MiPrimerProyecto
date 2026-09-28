import { Module } from '@nestjs/common';
import { ImportAuditService } from './import-audit.service.js';
import { ImportUploadService } from './import-upload.service.js';
import { ImportWriterService } from './import-writer.service.js';

/**
 * Importación del historial (Fase 9, §113). Aporta la auditoría por lote (9.1.3), el escritor de
 * importación con la anulación de lotes (9.1.5) y la subida con persistencia de staging (9.3.3);
 * los endpoints llegan en una fase posterior (9.3.8).
 */
@Module({
  providers: [ImportAuditService, ImportWriterService, ImportUploadService],
  exports: [ImportAuditService, ImportWriterService, ImportUploadService],
})
export class ImportsModule {}
