import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/support/test-database.js';

export default defineConfig({
  test: {
    environment: 'node',
    // `test/**/*.spec.ts`: pruebas unitarias del arnés de evaluación de tickets (test/ticket-eval).
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    // Retira ANTHROPIC_API_KEY y bloquea fetch a Anthropic: ninguna prueba gasta créditos por accidente.
    setupFiles: ['./test/support/block-real-ai.ts'],
    // Las pruebas de integración comparten la base de datos `letfer_test`.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      // Parámetros de argon2id mínimos: las pruebas no necesitan el coste de producción.
      ARGON2_MEMORY_KIB: '1024',
      ARGON2_PASSES: '1',
      THROTTLE_ENABLED: 'false',
      // El backup automático interno (§109.3) no debe correr de fondo durante las pruebas; cada
      // prueba de backups lo habilita explícitamente donde corresponda.
      BACKUP_SCHEDULER_ENABLED: 'false',
      // Igual para la purga diaria de registros auxiliares (§111.6).
      MAINTENANCE_SCHEDULER_ENABLED: 'false',
    },
  },
});
