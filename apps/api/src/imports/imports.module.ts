import { Module } from '@nestjs/common';
import { ImportAuditService } from './import-audit.service.js';
import { ImportResolutionService } from './import-resolution.service.js';
import { ImportUploadService } from './import-upload.service.js';
import { ImportWriterService } from './import-writer.service.js';

/**
 * Importación del historial (Fase 9, §113). Aporta la auditoría por lote (9.1.3), el escritor de
 * importación con la anulación de lotes (9.1.5), la subida con persistencia de staging (9.3.3) y la
 * resolución humana de casa y plan de etapas (9.3.4); los endpoints llegan en una fase posterior
 * (9.3.8).
 */
@Module({
  providers: [
    ImportAuditService,
    ImportWriterService,
    ImportUploadService,
    ImportResolutionService,
  ],
  exports: [ImportAuditService, ImportWriterService, ImportUploadService, ImportResolutionService],
})
export class ImportsModule {}
