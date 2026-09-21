import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { sessions, users, type SessionRow, type UserRow } from '../database/schema/index.js';

export interface CreateSessionInput {
  userId: string;
  /** `true` si el usuario marcó "Mantener sesión iniciada". */
  persistent: boolean;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface CreatedSession {
  /** Token en claro: se entrega una sola vez al cliente y nunca se guarda. */
  token: string;
  session: SessionRow;
}

export interface ValidSession {
  session: SessionRow;
  user: UserRow;
}

/** SHA-256 (hex) de un token. Los tokens tienen 256 bits de entropía, no necesitan sal ni coste. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Sesión no revocada, no expirada de forma absoluta y no expirada por inactividad. */
const isLive = (now: Date) =>
  and(
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, now),
    sql`${sessions.lastSeenAt} + make_interval(secs => ${sessions.idleTimeoutSeconds}) > ${now}`,
  );

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Abre una sesión (§104.2). El inicio de sesión cuenta como confirmación de contraseña. */
  async create(input: CreateSessionInput, executor: DbExecutor = this.db): Promise<CreatedSession> {
    const now = this.clock.now();
    const { session } = this.config;
    const idleSeconds = input.persistent
      ? session.persistentIdleSeconds
      : session.temporaryIdleSeconds;
    const absoluteSeconds = input.persistent
      ? session.persistentAbsoluteSeconds
      : session.temporaryAbsoluteSeconds;

    const token = randomBytes(32).toString('base64url');
    const [created] = await executor
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: hashToken(token),
        persistent: input.persistent,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + absoluteSeconds * 1000),
        idleTimeoutSeconds: idleSeconds,
        reauthenticatedAt: now,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning();
    return { token, session: created! };
  }

  /**
   * Devuelve la sesión y su usuario si el token es válido: sin revocar, sin expirar (absoluta
   * ni por inactividad) y con la cuenta en estado `ACTIVE` (§104.6). No modifica nada.
   */
  async validate(token: string, executor: DbExecutor = this.db): Promise<ValidSession | null> {
    if (!token) return null;
    const now = this.clock.now();
    const [row] = await executor
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), eq(users.status, 'ACTIVE'), isLive(now)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Renueva la ventana de inactividad. Para no escribir en cada petición solo actualiza si pasó
   * el intervalo configurado desde el último uso. Devuelve la sesión resultante.
   */
  async touch(session: SessionRow, executor: DbExecutor = this.db): Promise<SessionRow> {
    const now = this.clock.now();
    const threshold = new Date(now.getTime() - this.config.session.touchIntervalSeconds * 1000);
    if (session.lastSeenAt > threshold) return session;

    const [updated] = await executor
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(sessions.id, session.id),
          lt(sessions.lastSeenAt, threshold),
          isNull(sessions.revokedAt),
        ),
      )
      .returning();
    return updated ?? session;
  }

  /** Registra una confirmación de contraseña (reautenticación, §104.5). */
  async markReauthenticated(
    sessionId: string,
    executor: DbExecutor = this.db,
  ): Promise<SessionRow> {
    const [updated] = await executor
      .update(sessions)
      .set({ reauthenticatedAt: this.clock.now() })
      .where(eq(sessions.id, sessionId))
      .returning();
    return updated!;
  }

  /** Revoca una sesión concreta. Con `userId` solo revoca si pertenece a ese usuario. */
  async revoke(
    sessionId: string,
    reason: string,
    options: { userId?: string } = {},
    executor: DbExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokedReason: reason })
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          options.userId ? eq(sessions.userId, options.userId) : undefined,
        ),
      )
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  /** Revoca todas las sesiones abiertas de un usuario (salvo una, si se indica). Devuelve cuántas. */
  async revokeAllForUser(
    userId: string,
    reason: string,
    options: { exceptSessionId?: string } = {},
    executor: DbExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokedReason: reason })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          options.exceptSessionId ? ne(sessions.id, options.exceptSessionId) : undefined,
        ),
      )
      .returning({ id: sessions.id });
    return rows.length;
  }

  /** Sesiones abiertas (vigentes) de un usuario, la más reciente primero (§3). */
  async listActive(userId: string, executor: DbExecutor = this.db): Promise<SessionRow[]> {
    return executor
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isLive(this.clock.now())))
      .orderBy(desc(sessions.lastSeenAt));
  }
}
