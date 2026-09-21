import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

/** Prefijo global de la API REST. */
export const API_PREFIX = 'api';

/** Tamaño máximo del cuerpo JSON (§41: validación de entradas). */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Configuración común de la aplicación, compartida por `main.ts`, los comandos y las pruebas
 * e2e: prefijo, cabeceras de seguridad, límite de cuerpo y proxys de confianza.
 * No habilita CORS: la web y la API comparten origen (en desarrollo, mediante el proxy de Vite).
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  const config = app.get<AppConfig | undefined>(APP_CONFIG, { strict: false });
  const proxyHops = config?.trustProxyHops ?? 0;
  // Solo se confía en X-Forwarded-For cuando hay proxys de confianza configurados.
  app.set('trust proxy', proxyHops > 0 ? proxyHops : false);
}
