import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, type ApiErrorBody } from '@letfer/shared';
import helmet from 'helmet';
import { MaintenanceModeService } from './backups/maintenance-mode.service.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

/** Prefijo global de la API REST. */
export const API_PREFIX = 'api';

/** Tamaño máximo del cuerpo JSON (§41: validación de entradas). */
export const JSON_BODY_LIMIT = '100kb';

/**
 * M3 (revisión de arquitectura previa a integrar la Fase 5.5): protección técnica real de "no en
 * caliente" (D-R1) — mientras `BackupsService.restore()` tiene el modo mantenimiento activo,
 * cualquier otra petición recibe 503 antes de llegar al enrutado de Nest. Se exceptúa
 * `GET /health` para que el monitoreo de infraestructura siga viendo el proceso vivo.
 */
function maintenanceModeMiddleware(maintenanceMode: MaintenanceModeService) {
  const healthPath = `/${API_PREFIX}/health`;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!maintenanceMode.isActive() || req.path === healthPath) {
      next();
      return;
    }
    const body: ApiErrorBody = {
      statusCode: 503,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'LetFer está restaurando un backup: inténtalo de nuevo en unos minutos.',
    };
    res.status(503).json(body);
  };
}

/**
 * Configuración común de la aplicación, compartida por `main.ts`, los comandos y las pruebas
 * e2e: prefijo, cabeceras de seguridad, límite de cuerpo y proxys de confianza.
 * No habilita CORS: la web y la API comparten origen (en desarrollo, mediante el proxy de Vite).
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());

  // `strict: false` solo amplía la búsqueda a módulos hermanos dentro del contexto: si el
  // proveedor no está registrado en ningún módulo (p. ej. pruebas mínimas que no importan
  // BackupsModule), Nest lanza en vez de devolver `undefined` — de ahí el try/catch, ya que
  // el modo mantenimiento es una protección opcional, no algo que toda app deba traer.
  let maintenanceMode: MaintenanceModeService | undefined;
  try {
    maintenanceMode = app.get(MaintenanceModeService, { strict: false });
  } catch {
    maintenanceMode = undefined;
  }
  if (maintenanceMode) app.use(maintenanceModeMiddleware(maintenanceMode));

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  const config = app.get<AppConfig | undefined>(APP_CONFIG, { strict: false });
  const proxyHops = config?.trustProxyHops ?? 0;
  // Solo se confía en X-Forwarded-For cuando hay proxys de confianza configurados.
  app.set('trust proxy', proxyHops > 0 ? proxyHops : false);
}
