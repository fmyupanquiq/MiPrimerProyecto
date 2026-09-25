import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  ErrorCode,
  type MaintenancePurged,
  type MaintenanceRunSummary,
  type MaintenanceTrigger,
} from '@letfer/shared';
import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { MaintenanceModeService } from '../backups/maintenance-mode.service.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  maintenanceRuns,
  users,
  type MaintenanceRunRow,
  type UserRow,
} from '../database/schema/index.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PURGE_LOCK = 'maintenance:purge';
const HISTORY_LIMIT = 30;
/** Tope de intentos programados fallidos por día (UTC) y espera mínima entre ellos (L3). */
const MAX_FAILED_SCHEDULED_PER_DAY = 3;
const FAILED_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const NOTHING_PURGED: MaintenancePurged = { sessions: 0, loginAttempts: 0, passwordResetTokens: 0 };

/**
 * Purga de registros auxiliares caducados (§111.6, ADR 0018, ADR 0006/0007/0008).
 *
 * Solo toca tres tablas de apoyo y solo lo que dejó de valer hace más de `retentionDays`:
 * sesiones (expiradas, por inactividad o revocadas), intentos de acceso y tokens de recuperación
 * (usados, invalidados o vencidos). No hay claves foráneas hacia ellas y `audit_logs.session_id`
 * es un identificador sin referencia, así que nada de negocio, ledger, invitaciones ni auditoría
 * se ve afectado (D8-1, D8-3).
 *
 * La purga y su registro (`maintenance_runs` + auditoría) van en la misma transacción: o se
 * purga y queda constancia, o no se purga nada. Es idempotente y se serializa con un bloqueo.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private intervalHandle: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly maintenanceMode: MaintenanceModeService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.maintenance.schedulerEnabled) return;
    this.intervalHandle = setInterval(() => {
      this.maybeRunScheduled().catch((error: unknown) => {
        this.logger.error('Falló la comprobación de mantenimiento programado', error);
      });
    }, this.config.maintenance.checkIntervalSeconds * 1000);
    this.intervalHandle.unref();
  }

  onApplicationShutdown(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  /** Últimas ejecuciones, la más reciente primero. */
  async list(): Promise<MaintenanceRunSummary[]> {
    const rows = await this.db
      .select({ run: maintenanceRuns, firstName: users.firstName, lastName: users.lastName })
      .from(maintenanceRuns)
      .leftJoin(users, eq(users.id, maintenanceRuns.runBy))
      .orderBy(desc(maintenanceRuns.startedAt), desc(maintenanceRuns.id))
      .limit(HISTORY_LIMIT);
    return rows.map(({ run, firstName, lastName }) =>
      this.toSummary(run, firstName === null ? null : `${firstName} ${lastName ?? ''}`.trim()),
    );
  }

  /**
   * Se llama periódicamente; ejecuta la purga como mucho una vez por día calendario (UTC) y no
   * antes de la hora configurada. Decisión pura y comprobable sin esperar al temporizador real.
   */
  async maybeRunScheduled(): Promise<MaintenanceRunSummary | null> {
    // No compite con una restauración de backup en curso (D-R1).
    if (this.maintenanceMode.isActive()) return null;
    const now = this.clock.now();
    if (now.getUTCHours() < this.config.maintenance.scheduleHourUtc) return null;

    // Intentos programados de hoy (UTC). Uno completado basta; un fallo se reintenta con espera y
    // con tope, para que una avería persistente no llene el historial ni la auditoría (L3).
    const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const today = await this.db
      .select({ startedAt: maintenanceRuns.startedAt, status: maintenanceRuns.status })
      .from(maintenanceRuns)
      .where(
        and(eq(maintenanceRuns.trigger, 'SCHEDULED'), gte(maintenanceRuns.startedAt, dayStart)),
      )
      .orderBy(desc(maintenanceRuns.startedAt));
    if (today.some((run) => run.status === 'COMPLETED')) return null;
    if (today.length >= MAX_FAILED_SCHEDULED_PER_DAY) return null;
    const lastFailure = today[0];
    if (lastFailure && now.getTime() - lastFailure.startedAt.getTime() < FAILED_RETRY_DELAY_MS) {
      return null;
    }
    return this.purge('SCHEDULED', null);
  }

  /** Ejecuta la purga. Un fallo no se propaga: queda registrado como ejecución `FAILED`. */
  async purge(trigger: MaintenanceTrigger, actor: UserRow | null): Promise<MaintenanceRunSummary> {
    // Ninguna purga (manual o programada) compite con una restauración de backup en curso (D-R1).
    if (this.maintenanceMode.isActive()) {
      throw new AppError(
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        'LetFer está restaurando un backup: inténtalo de nuevo en unos minutos.',
      );
    }
    const startedAt = this.clock.now();
    const retentionDays = this.config.maintenance.retentionDays;
    const cutoff = new Date(startedAt.getTime() - retentionDays * MS_PER_DAY);

    try {
      const run = await this.db.transaction(async (tx) => {
        await lockByKey(tx, PURGE_LOCK);
        const purged: MaintenancePurged = {
          sessions: await this.deleted(
            tx,
            sql`DELETE FROM sessions
                 WHERE LEAST(revoked_at, expires_at,
                             last_seen_at + make_interval(secs => idle_timeout_seconds)) < ${cutoff}`,
          ),
          loginAttempts: await this.deleted(
            tx,
            sql`DELETE FROM login_attempts WHERE attempted_at < ${cutoff}`,
          ),
          passwordResetTokens: await this.deleted(
            tx,
            sql`DELETE FROM password_reset_tokens
                 WHERE LEAST(used_at, invalidated_at, expires_at) < ${cutoff}`,
          ),
        };
        const [row] = await tx
          .insert(maintenanceRuns)
          .values({
            trigger,
            runBy: actor?.id ?? null,
            startedAt,
            finishedAt: this.clock.now(),
            status: 'COMPLETED',
            retentionDays,
            purged,
          })
          .returning();
        await this.audit.record(tx, {
          action: 'maintenance.purge.completed',
          entityType: 'maintenance_run',
          entityId: row!.id,
          actorUserId: actor?.id ?? null,
          // Sin claves con "password" ni "token": la redacción de auditoría oculta todo lo que las
          // contenga, y aquí son solo contadores.
          metadata: {
            trigger,
            retentionDays,
            purgedSessions: purged.sessions,
            purgedLoginAttempts: purged.loginAttempts,
            purgedRecoveryLinks: purged.passwordResetTokens,
          },
        });
        return row!;
      });
      return this.toSummary(run, actor ? `${actor.firstName} ${actor.lastName}`.trim() : null);
    } catch (error) {
      this.logger.error(`Purga de mantenimiento fallida (${trigger})`, error);
      return this.recordFailure(trigger, actor, startedAt, retentionDays, error);
    }
  }

  /**
   * Registra la ejecución fallida en su propia transacción (la de la purga ya se revirtió, así
   * que no se eliminó nada). El mensaje es genérico: nunca se guardan detalles internos.
   */
  private async recordFailure(
    trigger: MaintenanceTrigger,
    actor: UserRow | null,
    startedAt: Date,
    retentionDays: number,
    original: unknown,
  ): Promise<MaintenanceRunSummary> {
    try {
      const run = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(maintenanceRuns)
          .values({
            trigger,
            runBy: actor?.id ?? null,
            startedAt,
            finishedAt: this.clock.now(),
            status: 'FAILED',
            retentionDays,
            purged: NOTHING_PURGED,
            errorMessage: 'La purga falló y no se eliminó nada. Revisa los registros del servidor.',
          })
          .returning();
        await this.audit.record(tx, {
          action: 'maintenance.purge.failed',
          entityType: 'maintenance_run',
          entityId: row!.id,
          actorUserId: actor?.id ?? null,
          metadata: { trigger, retentionDays },
        });
        return row!;
      });
      return this.toSummary(run, actor ? `${actor.firstName} ${actor.lastName}`.trim() : null);
    } catch (secondary) {
      // Ni siquiera se pudo dejar constancia (p. ej. base de datos caída): se propaga el original.
      this.logger.error('No se pudo registrar el fallo de mantenimiento', secondary);
      throw original;
    }
  }

  /** Ejecuta un `DELETE` y devuelve cuántas filas eliminó (sin traerlas al proceso). */
  private async deleted(executor: DbExecutor, statement: SQL): Promise<number> {
    const result = await executor.execute(
      sql`WITH gone AS (${statement} RETURNING 1) SELECT count(*)::int AS count FROM gone`,
    );
    return Number((result.rows[0] as { count: number | string }).count);
  }

  private toSummary(run: MaintenanceRunRow, runByName: string | null): MaintenanceRunSummary {
    return {
      id: run.id,
      trigger: run.trigger,
      runBy: run.runBy ? { id: run.runBy, name: runByName ?? '' } : null,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt.toISOString(),
      status: run.status,
      retentionDays: run.retentionDays,
      purged: run.purged,
      errorMessage: run.errorMessage,
    };
  }
}
