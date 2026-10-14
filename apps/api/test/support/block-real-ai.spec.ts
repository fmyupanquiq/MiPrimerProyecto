import { describe, expect, it } from 'vitest';
import { LIVE_AI_TESTS_ENABLED } from './live-ai.js';

describe('protección de créditos de Anthropic en las pruebas', () => {
  it.skipIf(LIVE_AI_TESTS_ENABLED)('la clave no llega al entorno de las pruebas', () => {
    expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it.skipIf(LIVE_AI_TESTS_ENABLED)(
    'un fetch a api.anthropic.com se rechaza sin salir a la red',
    async () => {
      await expect(
        fetch('https://api.anthropic.com/v1/messages', { method: 'POST' }),
      ).rejects.toThrow(/bloqueada en las pruebas/);
      await expect(fetch(new URL('https://api.anthropic.com/v1/messages'))).rejects.toThrow(
        /bloqueada/,
      );
    },
  );

  it('la prueba real exige confirmación explícita además de la clave', () => {
    // Con solo la clave (sin ANTHROPIC_LIVE_TESTS=yes-spend-credits) nunca está habilitada.
    expect(LIVE_AI_TESTS_ENABLED).toBe(
      process.env['ANTHROPIC_LIVE_TESTS'] === 'yes-spend-credits' &&
        Boolean(process.env['ANTHROPIC_API_KEY']),
    );
  });
});
