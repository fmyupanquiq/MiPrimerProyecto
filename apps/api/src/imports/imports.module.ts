import { Module } from '@nestjs/common';
import { ImportAcknowledgmentService } from './import-acknowledgment.service.js';
import { ImportAuditService } from './import-audit.service.js';
import { ImportBetResolutionService } from './import-bet-resolution.service.js';
import { ImportConfirmationService } from './import-confirmation.service.js';
import { ImportResolutionService } from './import-resolution.service.js';
import { ImportUploadService } from './import-upload.service.js';
import { ImportWriterService } from './import-writer.service.js';

/**
 * Importación del historial (Fase 9, §113). Aporta la auditoría por lote (9.1.3), el escritor de
 * importación con la anulación de lotes (9.1.5), la subida con persistencia de staging (9.3.3), la
 * resolución humana de casa y plan de etapas (9.3.4), la resolución de stageKey/stake (9.3.5), los
 * reconocimientos de D-X17b (9.3.6) y el ensamblado del `ImportBatchWriteInput` (preparación de la
 * 9.3.7); los endpoints llegan en una fase posterior (9.3.8).
 */
@Module({
  providers: [
    ImportAuditService,
    ImportWriterService,
    ImportUploadService,
    ImportResolutionService,
    ImportBetResolutionService,
    ImportAcknowledgmentService,
    ImportConfirmationService,
  ],
  exports: [
    ImportAuditService,
    ImportWriterService,
    ImportUploadService,
    ImportResolutionService,
    ImportBetResolutionService,
    ImportAcknowledgmentService,
    ImportConfirmationService,
  ],
})
export class ImportsModule {}
