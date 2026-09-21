import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { DbExecutor } from '../database/database.types.js';
import { loginAttempts } from '../database/schema/index.js';

export interface LockState {
  locked: boolean;
  /** Segundos que faltan para poder reintentar (0 si no está bloqueado). */
  retryAfterSeconds: number;
  /** Fallos contados en la ventana actual (hasta el máximo configurado). */
  failures: number;
}

/**
 * Bloqueo temporal por intentos fallidos (§41, §104.3): N fallos en la ventana para un mismo
 * correo bloquean el acceso durante un tiempo. Un acceso correcto reinicia el conteo. Los
 * intentos durante el bloqueo no se registran, por lo que el bloqueo no se prolonga solo.
 */
@Injectable()
export class LoginAttemptsService {
  constructor(
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getLockState(emailNormalized: string, executor: DbExecutor): Promise<LockState> {
    const now = this.clock.now();
    const { maxFailures, windowSeconds, durationSeconds } = this.config.lockout;
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);

    const [lastSuccess] = await executor
      .select({ seq: loginAttempts.seq })
      .from(loginAttempts)
      .where(
        and(eq(loginAttempts.emailNormalized, emailNormalized), eq(loginAttempts.succeeded, true)),
      )
      .orderBy(desc(loginAttempts.seq))
      .limit(1);

    const failures = await executor
      .select({ attemptedAt: loginAttempts.attemptedAt })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.emailNormalized, emailNormalized),
          eq(loginAttempts.succeeded, false),
          // Solo cuentan los fallos de la ventana posteriores al último acceso correcto.
          gt(loginAttempts.attemptedAt, windowStart),
          gt(loginAttempts.seq, lastSuccess?.seq ?? 0),
        ),
      )
      .orderBy(desc(loginAttempts.seq))
      .limit(maxFailures);

    if (failures.length < maxFailures) {
      return { locked: false, retryAfterSeconds: 0, failures: failures.length };
    }
    const lockedUntil = failures[0]!.attemptedAt.getTime() + durationSeconds * 1000;
    const remaining = Math.ceil((lockedUntil - now.getTime()) / 1000);
    return {
      locked: remaining > 0,
      retryAfterSeconds: Math.max(remaining, 0),
      failures: failures.length,
    };
  }

  async record(
    input: { emailNormalized: string; ip?: string | undefined; succeeded: boolean },
    executor: DbExecutor,
  ): Promise<void> {
    const now = this.clock.now();
    await executor.insert(loginAttempts).values({
      emailNormalized: input.emailNormalized,
      ip: input.ip ?? null,
      succeeded: input.succeeded,
      attemptedAt: now,
    });
    if (input.succeeded) {
      // Los intentos anteriores a la ventana ya no influyen: se depuran para no acumularlos.
      const windowStart = new Date(now.getTime() - this.config.lockout.windowSeconds * 1000);
      await executor
        .delete(loginAttempts)
        .where(
          and(
            eq(loginAttempts.emailNormalized, input.emailNormalized),
            lt(loginAttempts.attemptedAt, windowStart),
          ),
        );
    }
  }

  /** Reinicia el conteo (p. ej. tras restablecer la contraseña por el correo del propietario). */
  async reset(
    emailNormalized: string,
    ip: string | undefined,
    executor: DbExecutor,
  ): Promise<void> {
    await this.record({ emailNormalized, ip, succeeded: true }, executor);
  }
}
