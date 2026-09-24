import type { TicketConfidenceByField, TicketExtraction, TicketMimeType } from '@letfer/shared';

/**
 * Lectura de tickets por IA (§29, §52, §53, D-T1, ADR 0017): interfaz desacoplada del
 * proveedor concreto. `TicketsService` depende de este token, nunca de la implementación
 * (`AnthropicTicketReader`) — cambiar de proveedor es sustituir el provider de este token.
 */
export const TICKET_READER = Symbol('TICKET_READER');

export interface TicketReaderInput {
  buffer: Buffer;
  mimeType: TicketMimeType;
}

export interface TicketReaderResult {
  provider: string;
  model: string;
  extraction: TicketExtraction;
  /** D-T6: 0-1 por campo; `null` si el proveedor no la entrega. */
  confidenceByField: TicketConfidenceByField | null;
}

export interface TicketReader {
  /**
   * Analiza un ticket ya validado (tipo/tamaño, §97) y devuelve una propuesta. Nunca escribe
   * nada por sí mismo (§110.3): quien llama decide qué hacer con el resultado. Lanza si el
   * proveedor falla (red, autenticación, límite de tasa del proveedor); quien llama decide cómo
   * registrar ese fallo.
   */
  analyze(input: TicketReaderInput): Promise<TicketReaderResult>;
}
