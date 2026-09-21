import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit no carga el .env por sí mismo: se busca en apps/api y en la raíz del monorepo.
for (const candidate of [resolve('.env'), resolve('../../.env')]) {
  if (existsSync(candidate)) process.loadEnvFile(candidate);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
  strict: true,
  verbose: true,
});
