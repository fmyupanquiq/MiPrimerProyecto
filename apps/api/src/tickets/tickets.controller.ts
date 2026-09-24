import {
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
import {
  ErrorCode,
  TICKET_MAX_FILE_SIZE_BYTES,
  type TicketAnalysisSummary,
  type TicketSummary,
} from '@letfer/shared';
import { CurrentAuth, type AuthContext } from '../auth/auth-context.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { CurrentProject, ProjectRoute } from '../authorization/decorators.js';
import { AppError } from '../common/app-error.js';
import { TicketsService } from './tickets.service.js';

/**
 * Tickets e IA (§28-§31, §110). No exige reautenticación: subir/analizar un ticket no mueve
 * dinero (D6 solo la exige para aprobar retiros, corregir unidad de etapa y movimientos
 * extraordinarios).
 */
@Controller('projects/:projectId/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @ProjectRoute('tickets.upload')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TICKET_MAX_FILE_SIZE_BYTES } }))
  upload(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<TicketSummary> {
    if (!file) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Adjunta un archivo.');
    }
    return this.tickets.upload(access, auth.user, {
      buffer: file.buffer,
      originalFileName: file.originalname,
    });
  }

  @Get(':ticketId/file')
  @ProjectRoute('tickets.view')
  @Header('Cache-Control', 'private, no-store')
  async file(
    @CurrentProject() access: ProjectAccess,
    @Param('ticketId') ticketId: string,
  ): Promise<StreamableFile> {
    const { buffer, mimeType, originalFileName } = await this.tickets.getFile(access, ticketId);
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: `inline; filename="${originalFileName.replace(/"/g, '')}"`,
    });
  }

  @Post(':ticketId/analyze')
  @HttpCode(200)
  @ProjectRoute('tickets.analyze')
  @Header('Cache-Control', 'no-store')
  analyze(
    @CurrentAuth() auth: AuthContext,
    @CurrentProject() access: ProjectAccess,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketAnalysisSummary> {
    return this.tickets.analyze(access, auth.user, ticketId);
  }

  @Get(':ticketId/analyses')
  @ProjectRoute('tickets.view')
  @Header('Cache-Control', 'no-store')
  analyses(
    @CurrentProject() access: ProjectAccess,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketAnalysisSummary[]> {
    return this.tickets.listAnalyses(access, ticketId);
  }
}
