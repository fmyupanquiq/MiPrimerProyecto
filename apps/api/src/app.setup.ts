import type { INestApplication } from '@nestjs/common';

/** Prefijo global de la API REST. */
export const API_PREFIX = 'api';

/** Configuración común de la aplicación, compartida por `main.ts` y las pruebas e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
}
