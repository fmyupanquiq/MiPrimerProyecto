import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type TicketAnalysisSummary,
  type TicketMimeType,
  type TicketSummary,
} from '@letfer/shared';
import { and, count, eq, gte } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { newId } from '../database/schema/columns.js';
import { ticketAnalyses, tickets, type UserRow } from '../database/schema/index.js';
import { assertFinanceReady, financeNotFound } from '../finance/finance-errors.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';
import { mimeForExtension, sniffMimeType } from './mime-sniff.js';
import { TICKET_READER, type TicketReader } from '../ai/ticket-reader.js';
import { analysesOfTicket } from './ticket-queries.js';

export interface UploadedFile {
  buffer: Buffer;
  originalFileName: string;
}

const EXTENSION_BY_MIME: Record<TicketMimeType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

/**
 * Tickets e IA (§28-§31, §110). Sube, sirve y analiza tickets; nunca escribe una apuesta —
 * vincular un ticket a una es responsabilidad de `BetsService` (§110.3, sin vía financiera
 * paralela). El histórico en `ticket_analyses`/`tickets` es su propio rastro de auditoría
 * (inmutable, con quién/cuándo en cada fila): no se duplica en `audit_logs` (mismo criterio que
 * `IntegrityService`).
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(TICKET_READER) private readonly reader: TicketReader,
    private readonly clock: Clock,
  ) {}

  /** Sube un ticket (§28); `betId` opcional si ya se conoce la apuesta a la que pertenece. */
  async upload(access: ProjectAccess, actor: UserRow, file: UploadedFile): Promise<TicketSummary> {
    assertFinanceReady(access);

    // D-T3: la extensión y el contenido real se validan por separado y deben coincidir — un
    // archivo cuyo nombre dice ".png" pero cuyo contenido es otra cosa es exactamente el tipo
    // de suplantación que esta comprobación existe para detectar (§97).
    const byExtension = mimeForExtension(file.originalFileName);
    if (!byExtension) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'Extensión no admitida: usa JPG, JPEG, PNG o PDF.',
      );
    }
    const sniffed = sniffMimeType(file.buffer);
    if (!sniffed || sniffed !== byExtension) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'El contenido del archivo no coincide con su extensión.',
      );
    }

    const id = newId();
    const key = `${access.project.id}/${id}${EXTENSION_BY_MIME[sniffed]}`;
    const saved = await this.storage.save(key, file.buffer);

    const [row] = await this.db
      .insert(tickets)
      .values({
        id,
        projectId: access.project.id,
        uploadedBy: actor.id,
        storageKey: key,
        originalFileName: file.originalFileName,
        mimeType: sniffed,
        sizeBytes: saved.sizeBytes,
        checksum: saved.checksum,
      })
      .returning();

    return {
      id: row!.id,
      projectId: row!.projectId,
      betId: row!.betId,
      originalFileName: row!.originalFileName,
      mimeType: row!.mimeType,
      sizeBytes: row!.sizeBytes,
      uploadedBy: { id: actor.id, name: `${actor.firstName} ${actor.lastName}`.trim() },
      createdAt: row!.createdAt.toISOString(),
      lastAnalysis: null,
    };
  }

  /** Contenido del archivo, para servirlo por una ruta autenticada (§42: nunca una URL pública). */
  async getFile(
    access: ProjectAccess,
    ticketId: string,
  ): Promise<{ buffer: Buffer; mimeType: TicketMimeType; originalFileName: string }> {
    const ticket = await this.findOwn(access, ticketId);
    const buffer = await this.storage.read(ticket.storageKey);
    return { buffer, mimeType: ticket.mimeType, originalFileName: ticket.originalFileName };
  }

  /**
   * Analiza un ticket con IA (D-T4: acción explícita). Registra el intento —éxito o fallo— en
   * `ticket_analyses` antes de devolverlo; un fallo del proveedor no lanza sin más, se guarda
   * como `FAILED` con su mensaje (§110.4: cuenta igual para el límite).
   */
  async analyze(
    access: ProjectAccess,
    actor: UserRow,
    ticketId: string,
  ): Promise<TicketAnalysisSummary> {
    assertFinanceReady(access);
    const ticket = await this.findOwn(access, ticketId);
    await this.assertWithinRateLimit(access.project.id, ticketId);

    const analyzedAt = this.clock.now();
    let result: Awaited<ReturnType<TicketReader['analyze']>> | undefined;
    let errorMessage: string | null = null;
    try {
      const buffer = await this.storage.read(ticket.storageKey);
      result = await this.reader.analyze({ buffer, mimeType: ticket.mimeType });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const [row] = await this.db
      .insert(ticketAnalyses)
      .values({
        ticketId: ticket.id,
        projectId: access.project.id,
        analyzedBy: actor.id,
        analyzedAt,
        provider: result?.provider ?? 'anthropic',
        model: result?.model ?? this.config.tickets.anthropicModel,
        status: result ? 'COMPLETED' : 'FAILED',
        errorMessage,
        extraction: result?.extraction ?? null,
        confidenceByField: result?.confidenceByField ?? null,
      })
      .returning();

    if (!result) {
      throw new AppError(
        502,
        ErrorCode.INTERNAL_ERROR,
        `No se pudo analizar el ticket: ${errorMessage}`,
      );
    }
    const history = await analysesOfTicket(this.db, ticket.id);
    return history.find((a) => a.id === row!.id)!;
  }

  listAnalyses(access: ProjectAccess, ticketId: string): Promise<TicketAnalysisSummary[]> {
    return this.findOwn(access, ticketId).then((ticket) => analysesOfTicket(this.db, ticket.id));
  }

  /** §110.4: máximo por ticket y por proyecto en 24h, contados sobre el histórico real. */
  private async assertWithinRateLimit(projectId: string, ticketId: string): Promise<void> {
    const [perTicket] = await this.db
      .select({ n: count() })
      .from(ticketAnalyses)
      .where(eq(ticketAnalyses.ticketId, ticketId));
    if ((perTicket?.n ?? 0) >= this.config.tickets.maxAnalysesPerTicket) {
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        `Este ticket ya alcanzó el máximo de ${this.config.tickets.maxAnalysesPerTicket} análisis.`,
      );
    }
    const since = new Date(this.clock.now().getTime() - 24 * 60 * 60 * 1000);
    const [perProject] = await this.db
      .select({ n: count() })
      .from(ticketAnalyses)
      .where(and(eq(ticketAnalyses.projectId, projectId), gte(ticketAnalyses.analyzedAt, since)));
    if ((perProject?.n ?? 0) >= this.config.tickets.maxAnalysesPerProjectDay) {
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        `El proyecto ya alcanzó el máximo de ${this.config.tickets.maxAnalysesPerProjectDay} análisis de IA en 24 horas.`,
        { retryAfterSeconds: 60 * 60 },
      );
    }
  }

  private async findOwn(access: ProjectAccess, ticketId: string) {
    const [row] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, access.project.id)));
    if (!row) throw financeNotFound('Ticket no encontrado.');
    return row;
  }
}
