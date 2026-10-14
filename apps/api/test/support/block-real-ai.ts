// Se ejecuta antes de CADA archivo de pruebas (`setupFiles` de vitest.config.ts).
//
// Ninguna prueba automática puede gastar créditos de Anthropic por accidente (p. ej. porque quien
// la corre tiene `ANTHROPIC_API_KEY` en su shell o en un .env):
//   1. Se retira la clave del entorno de la prueba.
//   2. Cualquier `fetch` a un host de Anthropic se rechaza antes de salir a la red.
// Las pruebas con IA usan mocks (`TICKET_READER` falso o el SDK sustituido con `vi.mock`). La única
// excepción es la prueba real y opcional, que exige DOS decisiones explícitas:
//   ANTHROPIC_LIVE_TESTS=yes-spend-credits  y  ANTHROPIC_API_KEY=<clave>
import { LIVE_AI_TESTS_ENABLED } from './live-ai.js';

if (!LIVE_AI_TESTS_ENABLED) {
  delete process.env['ANTHROPIC_API_KEY'];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/(^|\.)anthropic\.com(?::\d+)?(\/|$)/i.test(url.replace(/^[a-z]+:\/\//i, ''))) {
      return Promise.reject(
        new Error(
          'Llamada real a Anthropic bloqueada en las pruebas (usa un mock; ver block-real-ai.ts).',
        ),
      );
    }
    return realFetch(input, init);
  };
}
