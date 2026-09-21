// Comando administrativo: crea el primer Administrador Global (spec §83).
//
//   1. Define en tu .env local (no versionado): BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD,
//      BOOTSTRAP_ADMIN_FIRST_NAME y BOOTSTRAP_ADMIN_LAST_NAME.
//   2. Ejecuta: npm run bootstrap:admin
//   3. Borra esas variables del .env.
//
// Es idempotente: si ya existe un Administrador Global no cambia nada.
import { NestFactory } from '@nestjs/core';
import { useSpanishValidationMessages } from '@letfer/shared';
import { AppModule } from '../app.module.js';
import { BootstrapAdminError, BootstrapAdminService } from '../auth/bootstrap-admin.service.js';
import { loadEnvFiles } from '../config/app-config.js';
import { readBootstrapInput } from './bootstrap-input.js';

loadEnvFiles();
useSpanishValidationMessages();

const credentials = readBootstrapInput(process.env);
if (!credentials.ok) {
  console.error(`Faltan variables de entorno: ${credentials.missing.join(', ')}`);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
let exitCode = 0;
try {
  const result = await app.get(BootstrapAdminService).run(credentials.input);
  console.log(
    result.status === 'created'
      ? `Administrador Global creado: ${credentials.input.email}`
      : 'Ya existe un Administrador Global; no se realizó ningún cambio.',
  );
} catch (error) {
  console.error(error instanceof BootstrapAdminError ? error.message : 'Error inesperado.');
  if (!(error instanceof BootstrapAdminError)) console.error(error);
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
