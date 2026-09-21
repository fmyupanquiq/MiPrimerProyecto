import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, normalizeEmail, type SessionInfo } from '@letfer/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { RequestContext } from '../common/request-context.js';
import { lockByKey } from '../database/advisory-lock.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { users, type SessionRow, type UserRow } from '../database/schema/index.js';
import { SessionService } from '../sessions/session.service.js';
import { UsersService } from '../users/users.service.js';
import type { AuthContext } from './auth-context.js';
import { toSessionInfo } from './auth-state.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { PasswordHasher } from './password-hasher.js';

export interface LoginCommand {
  email: string;
  password: string;
  keepSignedIn: boolean;
}

export interface LoginResult {
  /** Token en claro para la cookie; no se guarda en ningún sitio. */
  token: string;
  user: UserRow;
  session: SessionRow;
}

type LoginOutcome =
  | { kind: 'ok'; result: LoginResult }
  | { kind: 'failed' }
  | { kind: 'locked'; retryAfterSeconds: number };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptsService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  /**
   * Inicio de sesión (§3, §104.3). La respuesta es idéntica para un correo inexistente, una
   * contraseña incorrecta y una cuenta que no está activa; en todos los casos se hace el mismo
   * trabajo de hash. Los intentos de un mismo correo se serializan para que el conteo de fallos
   * sea exacto aunque lleguen en paralelo.
   */
  async login(command: LoginCommand): Promise<LoginResult> {
    const email = normalizeEmail(command.email);
    const context = RequestContext.current();

    const outcome = await this.db.transaction(async (tx): Promise<LoginOutcome> => {
      await lockByKey(tx, `login:${email}`);

      const lock = await this.attempts.getLockState(email, tx);
      if (lock.locked) return { kind: 'locked', retryAfterSeconds: lock.retryAfterSeconds };

      const user = await this.usersService.findByEmail(email, tx);
      let passwordOk = false;
      if (user) {
        passwordOk = await this.hasher.verify(command.password, user.passwordHash);
      } else {
        await this.hasher.verifyDummy(command.password);
      }

      if (!user || !passwordOk || user.status !== 'ACTIVE') {
        await this.attempts.record(
          { emailNormalized: email, ip: context?.ip, succeeded: false },
          tx,
        );
        const after = await this.attempts.getLockState(email, tx);
        if (after.locked) {
          await this.audit.record(tx, {
            action: 'auth.account_locked',
            entityType: 'user',
            entityId: user?.id ?? null,
            actorUserId: null,
            metadata: { failures: after.failures, retryAfterSeconds: after.retryAfterSeconds },
          });
        }
        return { kind: 'failed' };
      }

      await this.attempts.record({ emailNormalized: email, ip: context?.ip, succeeded: true }, tx);
      await this.usersService.markLogin(user.id, tx);
      if (this.hasher.needsRehash(user.passwordHash)) {
        // Endurece el hash con los parámetros vigentes aprovechando que conocemos la contraseña.
        const upgraded = await this.hasher.hash(command.password);
        await tx.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
      }

      const { token, session } = await this.sessions.create(
        {
          userId: user.id,
          persistent: command.keepSignedIn,
          ip: context?.ip,
          userAgent: context?.userAgent,
        },
        tx,
      );
      RequestContext.set({ userId: user.id, sessionId: session.id });
      await this.audit.record(tx, {
        action: 'auth.login.succeeded',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
        metadata: { persistent: command.keepSignedIn },
      });
      const fresh = (await this.usersService.findById(user.id, tx)) ?? user;
      return { kind: 'ok', result: { token, user: fresh, session } };
    });

    if (outcome.kind === 'locked') {
      throw new AppError(
        429,
        ErrorCode.ACCOUNT_LOCKED,
        'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.',
        { retryAfterSeconds: outcome.retryAfterSeconds },
      );
    }
    if (outcome.kind === 'failed') {
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Correo o contraseña incorrectos.');
    }
    return outcome.result;
  }

  /** Cierra la sesión actual (§3) y lo audita. */
  async logout(auth: AuthContext): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(auth.session.id, 'logout', { userId: auth.user.id }, tx);
      await this.audit.record(tx, {
        action: 'auth.logout',
        entityType: 'user',
        entityId: auth.user.id,
        actorUserId: auth.user.id,
      });
    });
  }

  /** Sesiones abiertas del usuario (§3), con la actual marcada. */
  async listSessions(auth: AuthContext): Promise<SessionInfo[]> {
    const active = await this.sessions.listActive(auth.user.id);
    return active.map((session) => toSessionInfo(session, auth.session.id));
  }

  /**
   * Revoca una de las sesiones del propio usuario. Una sesión ajena o inexistente da el mismo
   * 404: no se revela si existe.
   */
  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const revoked = await this.sessions.revoke(
        sessionId,
        'user_revoked',
        { userId: auth.user.id },
        tx,
      );
      if (!revoked) throw new AppError(404, ErrorCode.NOT_FOUND, 'Sesión no encontrada.');
      await this.audit.record(tx, {
        action: 'auth.session.revoked',
        entityType: 'user',
        entityId: auth.user.id,
        actorUserId: auth.user.id,
        metadata: { revokedSessionId: sessionId, current: sessionId === auth.session.id },
      });
    });
  }

  /** Cierra todas las sesiones del usuario menos la actual. Devuelve cuántas cerró. */
  async revokeOtherSessions(auth: AuthContext): Promise<number> {
    return this.db.transaction(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(
        auth.user.id,
        'user_revoked_others',
        { exceptSessionId: auth.session.id },
        tx,
      );
      await this.audit.record(tx, {
        action: 'auth.sessions.revoked_others',
        entityType: 'user',
        entityId: auth.user.id,
        actorUserId: auth.user.id,
        metadata: { revoked },
      });
      return revoked;
    });
  }
}
