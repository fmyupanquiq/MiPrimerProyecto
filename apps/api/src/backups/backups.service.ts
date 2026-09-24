import { mkdir, stat } from 'node:fs/promises';
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
  parseConnection,
  readManifest,
  run,
  sha256File,
  writeManifest,
} from './backup-files.js';

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

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly clock: Clock,
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
      await mkdir(this.config.backup.dir, { recursive: true });
      const result = await run(this.config.backup.pgDumpPath, ['-Fc', '-f', filePath], env);
      if (result.code !== 0) {
        throw new Error(result.stderr || `pg_dump terminó con código ${result.code}`);
      }
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
   * Esta llamada ejecuta `pg_restore` contra la misma base de datos a la que la API sigue
   * conectada; en un uso real debe hacerse con la API detenida o fuera de tráfico normal —
   * ejecutarla con la aplicación sirviendo peticiones puede bloquearse o fallar por bloqueos de
   * otras conexiones del propio pool (documentado en el ADR 0016). Sigue el orden del §37: backup
   * preventivo primero, luego la restauración, luego la auditoría (después, porque `--clean`
   * borra las tablas actuales antes de restaurar: un registro escrito antes se perdería).
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
