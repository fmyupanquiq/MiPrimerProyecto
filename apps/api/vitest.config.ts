import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/support/test-database.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    // Las pruebas de integración comparten la base de datos `letfer_test`.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      // Parámetros de argon2id mínimos: las pruebas no necesitan el coste de producción.
      ARGON2_MEMORY_KIB: '1024',
      ARGON2_PASSES: '1',
      THROTTLE_ENABLED: 'false',
    },
  },
});
