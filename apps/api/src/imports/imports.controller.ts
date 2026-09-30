import {
  acknowledgeImportBatchSchema,
  annulImportBatchSchema,
  confirmImportBatchSchema,
  confirmImportHouseSchema,
  ErrorCode,
  IMPORT_MAX_FILE_BYTES,
  saveImportStagePlanSchema,
  uploadImportBatchSchema,
  type AcknowledgeImportBatchInput,
  type AnnulImportBatchInput,
  type ConfirmImportBatchInput,
  type ConfirmImportHouseInput,
  type ImportBatchAnnulResult,
  type ImportBatchSummaryRow,
  type ImportBatchWriteResult,
  type ImportConfirmationReadiness,
  type ImportPreview,
  type SaveImportStagePlanInput,
  type UploadImportBatchInput,
} from '@letfer/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import { RequireRecentAuth } from '../auth/recent-auth.guard.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { ImportAcknowledgmentService } from './import-acknowledgment.service.js';
import { ImportBatchQueryService } from './import-batch-query.service.js';
import { ImportConfirmationService } from './import-confirmation.service.js';
import { ImportResolutionService } from './import-resolution.service.js';
import { ImportUploadService } from './import-upload.service.js';
import { resolveImportOriginAdapter } from './parser/import-origin-registry.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function batchIdOrNotFound(id: string): string {
  if (!UUID.test(id)) {
    throw new AppError(404, ErrorCode.NOT_FOUND, 'Lote de importación no encontrado.');
  }
  return id;
}

/**
 * Endpoints de importación histórica (Fase 9.3.8, §113, ADR 0020, docs/PLAN_FASE_9_3.md §5).
 * Capa fina: cada ruta valida su cuerpo (zod), comprueba permiso de proyecto
 * (`@ProjectRoute`, 404 sin acceso al proyecto, 403 con acceso pero sin permiso) y reautenticación
 * reciente donde corresponde (§113.6, §113.8), y delega directamente en los servicios ya
 * construidos (9.3.3 a 9.3.7) — ninguna regla de negocio vive aquí.
 */
@Controller('projects/:projectId/import-batches')
export class ImportBatchesController {
  constructor(
    private readonly query: ImportBatchQueryService,
    private readonly upload: ImportUploadService,
    private readonly resolution: ImportResolutionService,
    private readonly acknowledgment: ImportAcknowledgmentService,
    private readonly confirmation: ImportConfirmationService,
  ) {}

  @Post()
  @ProjectRoute('import.run')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_FILE_BYTES } }))
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body({ schema: uploadImportBatchSchema }) body: UploadImportBatchInput,
  ): Promise<ImportBatchSummaryRow> {
    if (!file) throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Adjunta un archivo.');
    const adapter = resolveImportOriginAdapter(body.origin);
    return this.upload
      .upload({
        projectId: access.project.id,
        actorUserId: auth.user.id,
        originalName: file.originalname,
        file: file.buffer,
        adapter,
        timeZone: access.project.timezone,
      })
      .then((result) => result.batch);
  }

  @Get()
  @ProjectRoute('imports.view')
  @Header('Cache-Control', 'no-store')
  list(@CurrentProject() access: ProjectAccess): Promise<ImportBatchSummaryRow[]> {
    return this.query.list(access.project.id);
  }

  @Get(':batchId')
  @ProjectRoute('imports.view')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
  ): Promise<ImportBatchSummaryRow> {
    return this.query.get(access.project.id, batchIdOrNotFound(batchId));
  }

  @Get(':batchId/preview')
  @ProjectRoute('imports.view')
  @Header('Cache-Control', 'no-store')
  preview(
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
  ): Promise<ImportPreview> {
    return this.query.preview(
      access.project.id,
      batchIdOrNotFound(batchId),
      access.project.timezone,
    );
  }

  /**
   * Si el lote puede confirmarse ahora (D-X17b, §113.7, D-X10): bloqueos, motivos que exigen
   * reconocimiento y si ya se dio. Solo lectura; es la misma comprobación que aplica `confirm`,
   * expuesta para que la web la muestre sin deducirla (Fase 9.4.7).
   */
  @Get(':batchId/readiness')
  @ProjectRoute('imports.view')
  @Header('Cache-Control', 'no-store')
  readiness(
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
  ): Promise<ImportConfirmationReadiness> {
    return this.acknowledgment.canConfirmImport({
      projectId: access.project.id,
      batchId: batchIdOrNotFound(batchId),
      timeZone: access.project.timezone,
    });
  }

  @Post(':batchId/house')
  @HttpCode(200)
  @ProjectRoute('import.run')
  @Header('Cache-Control', 'no-store')
  confirmHouse(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
    @Body({ schema: confirmImportHouseSchema }) body: ConfirmImportHouseInput,
  ): Promise<ImportBatchSummaryRow> {
    return this.resolution.confirmHouse({
      projectId: access.project.id,
      batchId: batchIdOrNotFound(batchId),
      actorUserId: auth.user.id,
      houseId: body.houseId,
    });
  }

  @Post(':batchId/stage-plan')
  @HttpCode(200)
  @ProjectRoute('import.run')
  @Header('Cache-Control', 'no-store')
  saveStagePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
    @Body({ schema: saveImportStagePlanSchema }) body: SaveImportStagePlanInput,
  ): Promise<ImportBatchSummaryRow> {
    return this.resolution.saveStagePlan({
      projectId: access.project.id,
      batchId: batchIdOrNotFound(batchId),
      actorUserId: auth.user.id,
      plan: {
        stages: body.stages.map((stage) => ({
          ...stage,
          startsAt: stage.startsAt ? new Date(stage.startsAt) : null,
        })),
      },
    });
  }

  @Post(':batchId/acknowledge')
  @HttpCode(200)
  @ProjectRoute('import.run')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  acknowledge(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
    @Body({ schema: acknowledgeImportBatchSchema }) body: AcknowledgeImportBatchInput,
  ): Promise<ImportBatchSummaryRow> {
    return this.acknowledgment.acknowledge({
      projectId: access.project.id,
      batchId: batchIdOrNotFound(batchId),
      actorUserId: auth.user.id,
      reason: body.reason,
    });
  }

  @Post(':batchId/confirm')
  @HttpCode(200)
  @ProjectRoute('import.run')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
    @Body({ schema: confirmImportBatchSchema }) body: ConfirmImportBatchInput,
  ): Promise<ImportBatchWriteResult> {
    return this.confirmation.confirmBatch({
      projectId: access.project.id,
      batchId: batchIdOrNotFound(batchId),
      actorUserId: auth.user.id,
      reason: body.reason,
      isRehearsal: body.isRehearsal,
      timeZone: access.project.timezone,
    });
  }

  @Post(':batchId/annul')
  @HttpCode(200)
  @ProjectRoute('import.run')
  @RequireRecentAuth()
  @Header('Cache-Control', 'no-store')
  annul(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
    @Body({ schema: annulImportBatchSchema }) body: AnnulImportBatchInput,
  ): Promise<ImportBatchAnnulResult> {
    return this.confirmation.annulBatch({
      projectId: access.project.id,
      batchId: batchIdOrNotFound(batchId),
      actorUserId: auth.user.id,
      reason: body.reason,
    });
  }

  @Get(':batchId/file')
  @ProjectRoute('imports.view')
  @Header('Cache-Control', 'private, no-store')
  async file(
    @CurrentProject() access: ProjectAccess,
    @Param('batchId') batchId: string,
  ): Promise<StreamableFile> {
    const { buffer, originalName } = await this.query.getFile(
      access.project.id,
      batchIdOrNotFound(batchId),
    );
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${originalName.replace(/"/g, '')}"`,
    });
  }
}
