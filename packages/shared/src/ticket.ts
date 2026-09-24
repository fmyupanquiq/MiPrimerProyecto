import { z } from 'zod';

/**
 * Tickets e IA (§28-§31, §51-§53, §90, §97, §110). El ticket es una entrada no confiable
 * (§97): la IA propone, el humano confirma, el backend valida y recién entonces se registra
 * (regla crítica de dominio). La IA nunca escribe una apuesta directamente (§110.3).
 */
export const TICKET_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type TicketMimeType = (typeof TICKET_MIME_TYPES)[number];

/** D-T3: 10 MB por archivo. */
export const TICKET_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const TICKET_ANALYSIS_STATUSES = ['COMPLETED', 'FAILED'] as const;
export type TicketAnalysisStatus = (typeof TICKET_ANALYSIS_STATUSES)[number];

/**
 * Contrato conceptual de lectura de ticket (§53), devuelto por `TicketReader.analyze()`. Todos
 * los campos son opcionales: la IA extrae lo que puede leer, nunca inventa lo que no ve.
 */
export interface TicketExtractionSelection {
  sport?: string;
  event?: string;
  market?: string;
  selection?: string;
  visibleOdds?: string;
}
export interface TicketExtraction {
  house?: string;
  placedDate?: string;
  placedTime?: string;
  betType?: string;
  selections?: TicketExtractionSelection[];
  officialTotalOdds?: string;
  officialAmount?: string;
  officialPotentialReturn?: string;
  officialRealizedReturn?: string;
  result?: string;
}

/** Confianza por campo (D-T6), 0-1; solo para ayudar la revisión humana, nunca decide nada. */
export type TicketConfidenceByField = Record<string, number>;

export interface TicketAnalysisSummary {
  id: string;
  ticketId: string;
  /** Posición secuencial dentro del ticket (1º, 2º análisis...), no una fecha (§30). */
  version: number;
  status: TicketAnalysisStatus;
  provider: string;
  model: string;
  extraction: TicketExtraction;
  confidenceByField: TicketConfidenceByField | null;
  errorMessage: string | null;
  analyzedBy: { id: string; name: string };
  analyzedAt: string;
}

export interface TicketSummary {
  id: string;
  projectId: string;
  betId: string | null;
  originalFileName: string;
  mimeType: TicketMimeType;
  sizeBytes: number;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  /** Último análisis conocido, para no tener que pedir el histórico completo en las listas. */
  lastAnalysis: TicketAnalysisSummary | null;
}

/** Cuerpo textual esperado junto al archivo multipart al subir un ticket. */
export const uploadTicketSchema = z.object({
  betId: z.uuid().optional(),
});
export type UploadTicketInput = z.infer<typeof uploadTicketSchema>;

/**
 * Vincula un ticket ya subido a una apuesta al crearla/editarla (§110.3): se añade a
 * `createBetSchema`/`updateBetSchema` (`bet.ts`). No hay un endpoint "aplicar" — el propio
 * formulario de apuesta hace el merge campo a campo (D-T5) en el cliente y envía el resultado a
 * `POST/PATCH .../bets` de siempre; la IA nunca tiene su propio camino de escritura (§110.3).
 */
export const ticketIdSchema = z.uuid();
