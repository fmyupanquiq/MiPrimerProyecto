import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config.js';

/**
 * Aísla por completo el SDK de Anthropic (Fase 10.6.1): comprueba la FORMA exacta de la
 * petición —en particular, que `tool_choice` ya no fuerza un tipo incompatible con algunos
 * modelos (p. ej. `claude-sonnet-5-5` lo rechazaba con 400 `invalid_request_error`, visto en la
 * primera prueba real)— y la transformación de la respuesta a una extracción. Nunca toca la red;
 * vive en un archivo aparte para no mezclarse con el smoke test real de
 * `anthropic-ticket-reader.spec.ts`, que sí necesita el SDK de verdad.
 */
const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropicClient {
    messages = { create };
  }
  return { default: FakeAnthropicClient };
});

// Import dinámico, después de `vi.mock`: así no hay ambigüedad sobre el orden — el módulo bajo
// prueba se carga ya con el SDK sustituido.
const { AnthropicTicketReader } = await import('./anthropic-ticket-reader.service.js');

const config = (overrides: Partial<AppConfig['tickets']> = {}): AppConfig =>
  ({
    tickets: {
      dir: '.data/tickets',
      anthropicApiKey: 'sk-ant-test',
      anthropicModel: 'claude-sonnet-5-5',
      aiEnabled: true,
      maxAnalysesPerTicket: 5,
      maxAnalysesPerProjectDay: 50,
      ...overrides,
    },
  }) as AppConfig;

const input = { buffer: Buffer.from('fake-image-bytes'), mimeType: 'image/png' as const };

describe('AnthropicTicketReader: forma de la petición y transformación de la respuesta', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('no fuerza tool_choice de tipo "tool"/"any" (algunos modelos lo rechazan): usa "auto"', async () => {
    create.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'record_ticket_extraction', input: { house: 'Betano' } }],
    });
    const reader = new AnthropicTicketReader(config());
    await reader.analyze(input);

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0]![0] as {
      model: string;
      tool_choice: unknown;
      tools: { name: string }[];
    };
    expect(request.tool_choice).toEqual({ type: 'auto' });
    expect(request.model).toBe('claude-sonnet-5-5');
    // Sigue habiendo una sola herramienta posible: la extracción estructurada de siempre.
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0]!.name).toBe('record_ticket_extraction');
  });

  it('un tool_use de record_ticket_extraction se transforma en la extracción esperada', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: 'Leyendo el ticket…' },
        {
          type: 'tool_use',
          name: 'record_ticket_extraction',
          input: {
            house: 'Betano',
            officialAmount: '60.00',
            confidenceByField: { house: 0.9, officialAmount: 0.7 },
          },
        },
      ],
    });
    const reader = new AnthropicTicketReader(config());
    const result = await reader.analyze(input);

    expect(result).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      extraction: { house: 'Betano', officialAmount: '60.00' },
      confidenceByField: { house: 0.9, officialAmount: 0.7 },
    });
  });

  it('sin confidenceByField en la respuesta, queda null (nunca se inventa confianza)', async () => {
    create.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'record_ticket_extraction', input: { house: 'Betano' } }],
    });
    const reader = new AnthropicTicketReader(config());
    const result = await reader.analyze(input);
    expect(result.confidenceByField).toBeNull();
  });

  it('si el modelo no llama a la herramienta, lanza un error controlado: sin datos parciales', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'No logro leer nada útil en esta imagen.' }],
    });
    const reader = new AnthropicTicketReader(config());
    await expect(reader.analyze(input)).rejects.toThrow(/no devolvió una extracción estructurada/);
    // `AnthropicTicketReader` no conoce `bets`/`tickets`/el ledger: no tiene cómo guardar nada,
    // ni parcial ni completo. Quien sí decide qué hacer con el fallo (registrarlo como FAILED,
    // nunca crear una apuesta) es `TicketsService.analyze`, ya probado en
    // `test/tickets.e2e-spec.ts` ("un fallo del proveedor se registra como FAILED...").
  });
});
