import { stat } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ErrorCode, type BackupGeneration, type BackupTrigger } from '@letfer/shared';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { UserRow } from '../database/schema/index.js';
import {
  backupFilePath,
  connectionEnv,
  deleteBackupFile,
  ensureSecureDir,
  parseConnection,
  readManifest,
  run,
  secureFile,
  sha256File,
  writeManifest,
} from './backup-files.js';
import { MaintenanceModeService } from './maintenance-mode.service.js';

/**
 * Backups automáticos y recuperación (§37, §82, §109.3-4, D-B1 a D-B4, D-R1). El backup se
 * dispara desde dentro de este mismo proceso (D-B1), no desde un cron externo. Cada generación
 * es una copia completa mediante `pg_dump` (D-B2, nunca parcial); el manifiesto vive fuera de
 * PostgreSQL (D-B3, `backup-files.ts`). La restauración es una operación de mantenimiento
 * controlada, no en caliente (D-R1): ver el aviso en `restore()`.
 */
@Injectable()
export class BackupsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BackupsService.name);
  private intervalHandle: NodeJS.Timeout | undefined;
  /** Serializa lecturas/escrituras del manifiesto dentro de este proceso. */
  private manifestChain: Promise<unknown> = Promise.resolve();
  /** M2: evita dos restauraciones simultáneas (doble clic, o dos Administradores Globales). */
  private restoreInProgress = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly maintenanceMode: MaintenanceModeService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.backup.schedulerEnabled) return;
    this.intervalHandle = setInterval(() => {
      this.maybeRunScheduledBackup().catch((error: unknown) => {
        this.logger.error('Falló la comprobación de backup programado', error);
      });
    }, this.config.backup.checkIntervalSeconds * 1000);
    this.intervalHandle.unref();
  }

  onApplicationShutdown(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  async list(): Promise<BackupGeneration[]> {
    return readManifest(this.config.backup.dir);
  }

  /**
   * Se llama periódicamente (D-B1); dispara un backup como mucho una vez por día calendario
   * (UTC) y no antes de la hora configurada (`BACKUP_SCHEDULE_HOUR_UTC`). Decisión pura y
   * probable directamente, sin depender de que el temporizador real llegue a dispararse.
   */
  async maybeRunScheduledBackup(): Promise<BackupGeneration | null> {
    // M2: no compite con una restauración en curso — un pg_dump a mitad de un pg_restore
    // (que borra y recrea tablas) podría fallar o capturar un estado a medias.
    if (this.restoreInProgress) return null;
    const now = this.clock.now();
    if (now.getUTCHours() < this.config.backup.scheduleHourUtc) return null;
    const today = now.toISOString().slice(0, 10);
    const generations = await readManifest(this.config.backup.dir);
    const alreadyRanToday = generations.some(
      (g) => g.status === 'COMPLETED' && g.takenAt.slice(0, 10) === today,
    );
    if (alreadyRanToday) return null;
    return this.createBackup('SCHEDULED');
  }

  /** Copia completa mediante `pg_dump` en formato personalizado (D-B2), nunca parcial. */
  async createBackup(trigger: BackupTrigger): Promise<BackupGeneration> {
    const id = uuidv7();
    const takenAt = this.clock.now();
    const fileName = `letfer-${takenAt.toISOString().replace(/[:.]/g, '-')}-${id}.dump`;
    const filePath = backupFilePath(this.config.backup.dir, fileName);
    const env = connectionEnv(parseConnection(this.config.databaseUrl));

    let sizeBytes = 0;
    let checksum = '';
    let status: BackupGeneration['status'] = 'COMPLETED';
    let errorMessage: string | null = null;
    try {
      await ensureSecureDir(this.config.backup.dir); // H2: directorio 0700
      const result = await run(this.config.backup.pgDumpPath, ['-Fc', '-f', filePath], env);
      if (result.code !== 0) {
        throw new Error(result.stderr || `pg_dump terminó con código ${result.code}`);
      }
      await secureFile(filePath); // H2: el volcado lo crea pg_dump, se asegura aparte a 0600
      const stats = await stat(filePath);
      sizeBytes = stats.size;
      checksum = await sha256File(filePath);
    } catch (error) {
      status = 'FAILED';
      errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Backup fallido (${trigger}): ${errorMessage}`);
    }

    const generation: BackupGeneration = {
      id,
      takenAt: takenAt.toISOString(),
      triggeredBy: trigger,
      fileName,
      sizeBytes,
      checksum,
      status,
      errorMessage,
    };
    await this.appendToManifest(generation);
    return generation;
  }

  /**
   * Restauración (§37, §109.4, D-R1): operación de mantenimiento controlada, **no en caliente**.
   * La validación (existe, está COMPLETED, la confirmación coincide) se hace primero y no toca
   * nada; solo entonces se activa la protección real (M2, M3 de la revisión de arquitectura
   * previa a integrar la Fase 5.5):
   *
   * - M2: `restoreInProgress` impide una segunda restauración simultánea (comprobar-y-fijar sin
   *   `await` entre medias: seguro de carreras dentro del mismo proceso) y pausa el backup
   *   programado (`maybeRunScheduledBackup`) mientras dure.
   * - M3: `MaintenanceModeService` hace que el middleware global rechace con 503 cualquier otra
   *   petición entrante mientras `pg_restore` corre — la protección técnica real que D-R1 exige,
   *   no solo una instrucción operativa de "detener la API a mano".
   *
   * Sigue el orden del §37: backup preventivo primero, luego la restauración, luego la auditoría
   * (después, porque `--clean` borra las tablas actuales antes de restaurar: un registro escrito
   * antes se perdería).
   */
  async restore(
    actor: UserRow,
    generationId: string,
    confirmation: string,
  ): Promise<BackupGeneration> {
    const generations = await readManifest(this.config.backup.dir);
    const target = generations.find((g) => g.id === generationId);
    if (!target)
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Generación de backup no encontrada.');
    if (target.status !== 'COMPLETED') {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'Esta generación no se completó correctamente.',
      );
    }
    if (confirmation !== target.id && confirmation !== target.fileName) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE,
        'La confirmación no coincide con la generación a restaurar.',
      );
    }

    // M2: comprobar-y-fijar en el mismo turno del bucle de eventos (sin `await` entre medias):
    // dos llamadas a restore() no pueden colarse una dentro de la ventana de la otra.
    if (this.restoreInProgress) {
      throw new AppError(409, ErrorCode.INVALID_STATE, 'Ya hay una restauración en curso.');
    }
    this.restoreInProgress = true;
    this.maintenanceMode.activate(); // M3: a partir de aquí, el resto de la API responde 503.
    try {
      const preventive = await this.createBackup('MANUAL');
      if (preventive.status !== 'COMPLETED') {
        throw new AppError(
          409,
          ErrorCode.INVALID_STATE,
          'No se pudo tomar el backup preventivo: la restauración se canceló sin tocar nada.',
        );
      }

      const env = connectionEnv(parseConnection(this.config.databaseUrl));
      const conn = parseConnection(this.config.databaseUrl);
      const filePath = backupFilePath(this.config.backup.dir, target.fileName);
      const result = await run(
        this.config.backup.pgRestorePath,
        ['--clean', '--if-exists', '-d', conn.database, filePath],
        env,
      );
      const restored = result.code === 0;

      // Después de restaurar (§37: la auditoría es el último paso; --clean habría borrado un
      // registro escrito antes de la restauración).
      await this.audit.record(this.db, {
        action: 'backup.restored',
        entityType: 'backup_generation',
        entityId: target.id,
        actorUserId: actor.id,
        newValues: {
          generationId: target.id,
          fileName: target.fileName,
          preventiveBackupId: preventive.id,
          restored,
        },
      });

      if (!restored) {
        throw new AppError(
          500,
          ErrorCode.INTERNAL_ERROR,
          `pg_restore falló: ${result.stderr || `código ${result.code}`}`,
        );
      }
      return target;
    } finally {
      // Siempre se libera, incluso si algo de lo anterior lanzó: nunca deja la API en modo
      // mantenimiento indefinidamente ni bloqueada para la próxima restauración.
      this.maintenanceMode.deactivate();
      this.restoreInProgress = false;
    }
  }

  private async appendToManifest(generation: BackupGeneration): Promise<void> {
    await this.withManifestLock(async () => {
      const generations = await readManifest(this.config.backup.dir);
      generations.unshift(generation);
      const kept = generations.slice(0, this.config.backup.retentionCount);
      const removed = generations.slice(this.config.backup.retentionCount);
      await writeManifest(this.config.backup.dir, kept);
      for (const old of removed) {
        await deleteBackupFile(this.config.backup.dir, old.fileName);
      }
    });
  }

  /** Serializa el acceso al manifiesto: dos backups a la vez no deben pisarse la escritura. */
  private withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.manifestChain.then(fn, fn);
    this.manifestChain = next.catch(() => undefined);
    return next;
  }
}
