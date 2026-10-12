import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config.js';
import { AnthropicTicketReader } from './anthropic-ticket-reader.service.js';

/**
 * Timeout y reintentos de la llamada a Anthropic. Usa el SDK REAL pero con `fetch` sustituido:
 * ninguna prueba toca la red, usa una clave real ni gasta créditos.
 */
const config = (overrides: Partial<AppConfig['tickets']> = {}): AppConfig =>
  ({
    tickets: {
      dir: '.data/tickets',
      anthropicApiKey: 'sk-ant-fake-key-for-tests',
      anthropicModel: 'claude-sonnet-5-5',
      aiEnabled: true,
      maxAnalysesPerTicket: 5,
      maxAnalysesPerProjectDay: 50,
      aiTimeoutMs: 5_000,
      aiMaxRetries: 1,
      ...overrides,
    },
  }) as AppConfig;

const input = { buffer: Buffer.from('fake-image-bytes'), mimeType: 'image/png' as const };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const okMessage = () =>
  json(200, {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'record_ticket_extraction',
        input: { house: 'Betano' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
  });
const serverError = () =>
  json(500, {
    type: 'error',
    error: { type: 'api_error', message: 'detalle interno del proveedor' },
  });

/** Un fetch que no responde nunca, salvo que el SDK aborte la petición (timeout). */
const hangingFetch = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('AnthropicTicketReader: timeout y reintentos explícitos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('un error transitorio del proveedor se reintenta y el segundo intento tiene éxito', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(serverError())
      .mockResolvedValueOnce(okMessage());
    vi.stubGlobal('fetch', fetchMock);
    const result = await new AnthropicTicketReader(config()).analyze(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.extraction).toEqual({ house: 'Betano' });
  });

  it('agota los reintentos configurados y falla (1 reintento = 2 llamadas en total)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(serverError()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AnthropicTicketReader(config()).analyze(input)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('con AI_MAX_RETRIES=0 no reintenta', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(serverError()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new AnthropicTicketReader(config({ aiMaxRetries: 0 })).analyze(input),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un error de cliente (400) nunca se reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'x' } }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AnthropicTicketReader(config()).analyze(input)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('una respuesta que no llega dentro del timeout se aborta (y se reintenta una vez)', async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal('fetch', fetchMock);
    const started = Date.now();
    await expect(
      new AnthropicTicketReader(config({ aiTimeoutMs: 100 })).analyze(input),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
