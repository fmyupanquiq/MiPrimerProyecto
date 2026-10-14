/** Las pruebas contra la API real de Anthropic exigen esta confirmación Y una clave: gastan créditos. */
export const LIVE_AI_TESTS_ENABLED =
  process.env['ANTHROPIC_LIVE_TESTS'] === 'yes-spend-credits' &&
  Boolean(process.env['ANTHROPIC_API_KEY']);
