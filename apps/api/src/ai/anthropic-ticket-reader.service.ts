import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable } from '@nestjs/common';
import type { TicketConfidenceByField, TicketExtraction } from '@letfer/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { TicketReader, TicketReaderInput, TicketReaderResult } from './ticket-reader.js';

const TOOL_NAME = 'record_ticket_extraction';

/**
 * Esquema JSON forzado por herramienta (D-T1, §53): en vez de parsear texto libre, se obliga al
 * modelo a llamar a esta herramienta con un `input` que respeta esta forma. Ningún campo es
 * obligatorio — la IA extrae lo que puede leer, nunca inventa lo que no ve (§29).
 */
const EXTRACTION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Registra los datos leídos de la imagen o PDF de un ticket de apuestas deportivas. ' +
    'Deja fuera cualquier campo que no puedas leer con razonable seguridad: no inventes valores.',
  input_schema: {
    type: 'object',
    properties: {
      house: { type: 'string', description: 'Casa de apuestas' },
      placedDate: { type: 'string', description: 'Fecha de colocación, AAAA-MM-DD si aparece' },
      placedTime: { type: 'string', description: 'Hora de colocación, si aparece' },
      betType: {
        type: 'string',
        enum: ['SIMPLE', 'CREATED', 'MULTIPLE'],
        description: 'Según la estructura visible: una selección, combinada creada, o múltiple',
      },
      selections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sport: { type: 'string' },
            event: { type: 'string' },
            market: { type: 'string' },
            selection: { type: 'string' },
            visibleOdds: { type: 'string' },
          },
        },
      },
      officialTotalOdds: { type: 'string' },
      officialAmount: { type: 'string', description: 'Monto apostado' },
      officialPotentialReturn: { type: 'string' },
      officialRealizedReturn: { type: 'string', description: 'Si el ticket ya muestra resultado' },
      result: { type: 'string' },
      confidenceByField: {
        type: 'object',
        description:
          'Confianza 0-1 por cada campo que sí reportaste, para ayudar la revisión humana',
        additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

interface ExtractionToolInput extends TicketExtraction {
  confidenceByField?: TicketConfidenceByField;
}

/** `TicketReader` sobre la API de Anthropic (D-T1, ADR 0017). Única pieza que conoce el SDK. */
@Injectable()
export class AnthropicTicketReader implements TicketReader {
  private client: Anthropic | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async analyze(input: TicketReaderInput): Promise<TicketReaderResult> {
    const client = this.clientOrThrow();
    const source =
      input.mimeType === 'application/pdf'
        ? ({
            type: 'document' as const,
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: input.buffer.toString('base64'),
            },
          } satisfies Anthropic.DocumentBlockParam)
        : ({
            type: 'image' as const,
            source: {
              type: 'base64',
              media_type: input.mimeType,
              data: input.buffer.toString('base64'),
            },
          } satisfies Anthropic.ImageBlockParam);

    const message = await client.messages.create({
      model: this.config.tickets.anthropicModel,
      max_tokens: 2048,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            source,
            {
              type: 'text',
              text: 'Lee este ticket de apuestas deportivas y registra los datos con la herramienta.',
            },
          ],
        },
      ],
    });

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error('El proveedor de IA no devolvió una extracción estructurada.');
    }
    const { confidenceByField, ...extraction } = toolUse.input as ExtractionToolInput;

    return {
      provider: 'anthropic',
      model: this.config.tickets.anthropicModel,
      extraction,
      confidenceByField: confidenceByField ?? null,
    };
  }

  /**
   * El cliente se crea de forma perezosa (no al arrancar la aplicación): así un entorno sin
   * `ANTHROPIC_API_KEY` (desarrollo sin IA configurada, pruebas con el `TicketReader` falso)
   * arranca igual y solo falla si de verdad se intenta analizar algo.
   */
  private clientOrThrow(): Anthropic {
    if (!this.config.tickets.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY no está configurada: no se puede analizar el ticket.');
    }
    this.client ??= new Anthropic({ apiKey: this.config.tickets.anthropicApiKey });
    return this.client;
  }
}
