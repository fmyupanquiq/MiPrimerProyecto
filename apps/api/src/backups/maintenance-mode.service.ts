import { Injectable } from '@nestjs/common';

/**
 * Modo mantenimiento (D-R1, §109.4; M3 de la revisión de arquitectura previa a integrar la
 * Fase 5.5). Protección técnica real, no solo documentada, para que una restauración de backup
 * nunca ocurra "en caliente": mientras está activo, el middleware global (`app.setup.ts`)
 * rechaza toda petición entrante salvo `GET /health`. `BackupsService.restore()` lo activa antes
 * de ejecutar `pg_restore` y lo desactiva siempre en un `finally`, incluso si falla.
 */
@Injectable()
export class MaintenanceModeService {
  private active = false;

  isActive(): boolean {
    return this.active;
  }

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }
}
