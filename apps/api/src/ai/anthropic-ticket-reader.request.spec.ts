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
      aiTimeoutMs: 60_000,
      aiMaxRetries: 1,
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

  it.each([
    ['null', null],
    ['texto', '{"house":"Betano"}'],
    ['lista', [{ house: 'Betano' }]],
  ])(
    'si el input de la herramienta no es un objeto (%s), lanza un error controlado',
    async (_n, bad) => {
      create.mockResolvedValue({
        content: [{ type: 'tool_use', name: 'record_ticket_extraction', input: bad }],
      });
      const reader = new AnthropicTicketReader(config());
      await expect(reader.analyze(input)).rejects.toThrow(
        /no devolvió una extracción estructurada/,
      );
    },
  );

  it('una respuesta cortada por max_tokens nunca se acepta (podría estar a medias)', async () => {
    create.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', name: 'record_ticket_extraction', input: { house: 'Betano' } }],
    });
    const reader = new AnthropicTicketReader(config());
    await expect(reader.analyze(input)).rejects.toThrow(/incompleta/);
  });

  it('con stop_reason tool_use la respuesta válida sigue funcionando igual', async () => {
    create.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'record_ticket_extraction', input: { house: 'Betano' } }],
    });
    const reader = new AnthropicTicketReader(config());
    const result = await reader.analyze(input);
    expect(result.extraction).toEqual({ house: 'Betano' });
  });
});

/**
 * Reglas de interpretación enviadas al modelo (leg frente a condición interna). Estas pruebas NO
 * miden al modelo —eso lo hace el arnés de evaluación con tickets reales—: fijan que las reglas
 * siguen presentes en la petición y que el contrato no cambió de forma.
 */
describe('AnthropicTicketReader: reglas del prompt para bloques de condiciones (Bet Builder o equivalente)', () => {
  type SchemaNode = {
    description?: string;
    properties?: Record<string, SchemaNode>;
    items?: SchemaNode;
  };
  const requestOf = async () => {
    create.mockReset();
    create.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'record_ticket_extraction', input: { house: 'Betano' } }],
    });
    await new AnthropicTicketReader(config()).analyze(input);
    const request = create.mock.calls[0]![0] as {
      tools: { description: string; input_schema: SchemaNode }[];
      messages: { content: { type: string; text?: string }[] }[];
    };
    const tool = request.tools[0]!;
    const text = request.messages[0]!.content.find((block) => block.type === 'text')!.text!;
    return { tool, text, props: tool.input_schema.properties! };
  };

  it('el contrato jerárquico: ticket, legs (selections) y condiciones internas (conditions)', async () => {
    const { props } = await requestOf();
    expect(Object.keys(props)).toEqual([
      'house',
      'placedDate',
      'placedTime',
      'betType',
      'externalReference',
      'selections',
      'stake',
      'officialTotalOdds',
      'officialAmount',
      'officialPotentialReturn',
      'officialRealizedReturn',
      'result',
      'confidenceByField',
    ]);
    const leg = props['selections']!.items!.properties!;
    expect(Object.keys(leg)).toEqual([
      'sport',
      'event',
      'market',
      'selection',
      'visibleOdds',
      'legScore',
      'legResult',
      'conditions',
    ]);
    // Las condiciones internas NO tienen cuota propia en el contrato.
    expect(Object.keys(leg['conditions']!.items!.properties!)).toEqual([
      'market',
      'selection',
      'conditionStatus',
    ]);
    expect(leg['conditions']!.items).toMatchObject({ required: ['selection'] });
    expect(leg['conditions']).toMatchObject({ minItems: 2 });
  });

  it('distingue los tres casos: Múltiple, Creada independiente y Múltiple con un leg creado', async () => {
    const { props, tool, text } = await requestOf();
    const selections = props['selections']!.description!;
    expect(selections).toContain('A) Múltiple con varios legs normales');
    expect(selections).toContain('B) Creada independiente');
    expect(selections).toContain('C) Múltiple que contiene uno o más legs creados');
    expect(selections).toContain('NO aumentan el número de entradas');
    expect(selections).toContain('"Combinada de 4"');
    expect(selections).toContain('tiene 4 entradas, no 5');
    expect(tool.description).toContain('tres niveles');
    expect(text).toContain('las condiciones internas no son legs');
  });

  it('la regla se basa en la estructura visual, no en la palabra "Bet Builder" ni en una casa', async () => {
    const { props } = await requestOf();
    const selections = props['selections']!.description!;
    expect(selections).toContain('Same Game Parlay');
    expect(selections).toContain('apuestas construidas');
    expect(selections).toContain('de cualquier casa');
    expect(selections).toContain('cuenta la estructura visual, no el nombre');
    expect(selections).not.toMatch(/Betano|Betsafe/);
  });

  it('la cuota es la del leg entero: nunca por condición, repartida, calculada ni de otra fila', async () => {
    const { props } = await requestOf();
    const leg = props['selections']!.items!.properties!;
    const odds = leg['visibleOdds']!.description!;
    expect(odds).toContain('Cuota del LEG ENTERO');
    expect(odds).toContain('nunca una por condición');
    expect(odds).toContain('Nunca la repartas');
    expect(odds).toContain('ni la copies de otra fila');
    expect(leg['conditions']!.description).toContain('NO llevan cuota propia');
  });

  it('las condiciones van en conditions y el pronóstico del leg no se usa en un leg creado', async () => {
    const { props } = await requestOf();
    const leg = props['selections']!.items!.properties!;
    expect(leg['selection']!.description).toContain('En un leg creado NO uses este campo');
    expect(leg['conditions']!.description).toContain('No omitas ninguna');
    expect(leg['market']!.description).toContain('nombre del bloque');
  });

  it('los estados y el marcador solo se leen si el ticket los muestra; nunca se deducen', async () => {
    const { props } = await requestOf();
    const leg = props['selections']!.items!.properties!;
    expect(leg['legResult']!.description).toContain('SOLO si el ticket muestra un indicador');
    expect(leg['legResult']!.description).toContain('Nunca lo deduzcas del marcador');
    expect(leg['conditions']!.items!.properties!['conditionStatus']!.description).toContain(
      'nunca lo deduzcas del marcador',
    );
    expect((leg['legResult'] as { enum?: string[] }).enum).toEqual([
      'WON',
      'LOST',
      'VOID',
      'PENDING',
    ]);
  });

  it('un bloque dentro de una combinada sigue siendo MULTIPLE', async () => {
    const { props } = await requestOf();
    expect(props['betType']!.description).toContain('Cuenta legs, no condiciones');
    expect(props['betType']!.description).toContain('sigue siendo MULTIPLE');
  });
});
