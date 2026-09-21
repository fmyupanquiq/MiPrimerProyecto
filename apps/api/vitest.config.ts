import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // Las pruebas de integración comparten la base de datos `letfer_test`.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://letfer:letfer_dev@localhost:5432/letfer_test',
      // Parámetros de argon2id mínimos: las pruebas no necesitan el coste de producción.
      ARGON2_MEMORY_KIB: '1024',
      ARGON2_PASSES: '1',
      THROTTLE_ENABLED: 'false',
    },
  },
});
