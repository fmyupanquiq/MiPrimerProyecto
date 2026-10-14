import { describe, expect, it } from 'vitest';
import { LIVE_AI_TESTS_ENABLED } from '../../test/support/live-ai.js';
import { AnthropicTicketReader } from './anthropic-ticket-reader.service.js';
import type { AppConfig } from '../config/app-config.js';

/** Config mínima para construir el servicio en pruebas (solo se usa `tickets.*`). */
const config = (overrides: Partial<AppConfig['tickets']> = {}): AppConfig =>
  ({
    tickets: {
      dir: '.data/tickets',
      anthropicApiKey: undefined,
      anthropicModel: 'claude-sonnet-5-5',
      aiEnabled: true,
      maxAnalysesPerTicket: 5,
      maxAnalysesPerProjectDay: 50,
      aiTimeoutMs: 60_000,
      aiMaxRetries: 1,
      ...overrides,
    },
  }) as AppConfig;

/**
 * Sin llamadas reales a Anthropic en la suite normal (D-T1, ADR 0017): aquí solo se comprueba
 * que, sin clave o con la IA desactivada, el error es claro y nunca llega a construir el cliente
 * del SDK (ningún test de esta suite necesita red ni `ANTHROPIC_API_KEY`).
 */
describe('AnthropicTicketReader (sin red)', () => {
  const input = { buffer: Buffer.from('fake'), mimeType: 'image/png' as const };

  it('sin ANTHROPIC_API_KEY, el error es claro y no revela nada sensible', async () => {
    const reader = new AnthropicTicketReader(config());
    await expect(reader.analyze(input)).rejects.toThrow(/ANTHROPIC_API_KEY no está configurada/);
  });

  it('con AI_TICKETS_ENABLED=false, el error es claro aunque exista una clave configurada', async () => {
    const reader = new AnthropicTicketReader(
      config({ aiEnabled: false, anthropicApiKey: 'sk-ant-x' }),
    );
    await expect(reader.analyze(input)).rejects.toThrow(/desactivado/);
  });
});

/**
 * Smoke test real y opcional (§31, §40): GASTA créditos. Solo se ejecuta con DOS decisiones
 * explícitas: `ANTHROPIC_LIVE_TESTS=yes-spend-credits` y `ANTHROPIC_API_KEY` (tener la clave en el
 * entorno ya no basta). `npm test` nunca depende de Internet ni de una clave real;
 * esta es la única forma de probar la integración real con Claude, a propósito fuera de la suite
 * normal.
 */
describe.skipIf(!LIVE_AI_TESTS_ENABLED)('AnthropicTicketReader (smoke real, opcional)', () => {
  // PNG 1×1 válido: no hay texto que leer, pero sirve para comprobar que la llamada real al SDK
  // y la extracción estructurada funcionan de punta a punta sin reventar.
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  it('hace una llamada real y devuelve una extracción estructurada (sin inventar datos)', async () => {
    const reader = new AnthropicTicketReader(
      config({ anthropicApiKey: process.env['ANTHROPIC_API_KEY'] }),
    );
    const result = await reader.analyze({ buffer: onePixelPng, mimeType: 'image/png' });
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-5-5');
    expect(result.extraction).toBeTypeOf('object');
  }, 30_000);
});
