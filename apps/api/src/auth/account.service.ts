import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  passwordPolicyIssues,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@letfer/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { maskEmail } from '../common/mask-email.js';
import { Clock } from '../common/clock.js';
import { RequestContext } from '../common/request-context.js';
import { lockByKey } from '../database/advisory-lock.js';
import { nextVersion } from '../database/concurrency.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { users, type UserRow } from '../database/schema/index.js';
import { MailService } from '../mail/mail.service.js';
import { SessionService } from '../sessions/session.service.js';
import { emailInUseIfUniqueViolation, UsersService } from '../users/users.service.js';
import type { AuthContext } from './auth-context.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { PasswordHasher } from './password-hasher.js';

type ConfirmOutcome =
  { kind: 'ok' } | { kind: 'wrong' } | { kind: 'locked'; retryAfterSeconds: number };

/**
 * Operaciones del propio usuario sobre su cuenta: confirmación de contraseña, cambio de
 * contraseña, reautenticación, perfil y correo (§3, §39, §104).
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger('Account');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptsService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly clock: Clock,
  ) {}

  /**
   * Comprueba la contraseña actual de un usuario ya autenticado. Comparte el contador de fallos
   * con el inicio de sesión (§104.3): así no se puede adivinar la contraseña desde una sesión
   * abierta sin activar el bloqueo. Los fallos se confirman en la base de datos antes de fallar.
   */
  async confirmPassword(user: UserRow, password: string): Promise<void> {
    const context = RequestContext.current();
    const email = user.email;

    const outcome = await this.db.transaction(async (tx): Promise<ConfirmOutcome> => {
      await lockByKey(tx, `login:${email}`);
      const lock = await this.attempts.getLockState(email, tx);
      if (lock.locked) return { kind: 'locked', retryAfterSeconds: lock.retryAfterSeconds };

      const ok = await this.hasher.verify(password, user.passwordHash);
      await this.attempts.record({ emailNormalized: email, ip: context?.ip, succeeded: ok }, tx);
      if (ok) return { kind: 'ok' };

      const after = await this.attempts.getLockState(email, tx);
      if (after.locked) {
        await this.audit.record(tx, {
          action: 'auth.account_locked',
          entityType: 'user',
          entityId: user.id,
          actorUserId: null,
          metadata: { failures: after.failures, retryAfterSeconds: after.retryAfterSeconds },
        });
      }
      return { kind: 'wrong' };
    });

    if (outcome.kind === 'locked') {
      throw new AppError(
        429,
        ErrorCode.ACCOUNT_LOCKED,
        'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.',
        { retryAfterSeconds: outcome.retryAfterSeconds },
      );
    }
    if (outcome.kind === 'wrong') {
      throw new AppError(403, ErrorCode.INVALID_CREDENTIALS, 'La contraseña es incorrecta.');
    }
  }

  /** Reautenticación (§39): confirma la contraseña y marca la sesión como recién confirmada. */
  async reauthenticate(auth: AuthContext, password: string): Promise<Date> {
    await this.confirmPassword(auth.user, password);
    const session = await this.sessions.markReauthenticated(auth.session.id);
    return session.reauthenticatedAt;
  }

  /**
   * Cambia la contraseña (§104.4): exige la actual, aplica la política (incluida la parte local
   * del correo) y cierra las demás sesiones del usuario.
   */
  async changePassword(auth: AuthContext, input: ChangePasswordInput): Promise<void> {
    await this.confirmPassword(auth.user, input.currentPassword);

    const issues = passwordPolicyIssues(input.newPassword, { email: auth.user.email });
    if (issues.length > 0) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'La contraseña nueva no es válida.', {
        details: issues.map((issue) => ({ path: 'newPassword', message: issue.message })),
      });
    }

    const newHash = await this.hasher.hash(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: newHash, passwordChangedAt: this.clock.now() })
        .where(eq(users.id, auth.user.id));
      const revokedSessions = await this.sessions.revokeAllForUser(
        auth.user.id,
        'password_changed',
        { exceptSessionId: auth.session.id },
        tx,
      );
      await this.sessions.markReauthenticated(auth.session.id, tx);
      await this.audit.record(tx, {
        action: 'user.password_changed',
        entityType: 'user',
        entityId: auth.user.id,
        actorUserId: auth.user.id,
        metadata: { revokedSessions },
      });
    });
  }

  /** Edita nombre y apellido con control de concurrencia optimista (§96). */
  async updateProfile(auth: AuthContext, input: UpdateProfileInput): Promise<UserRow> {
    return this.usersService.updateProfile(auth.user.id, input.version, {
      ...(input.firstName !== undefined && { firstName: input.firstName }),
      ...(input.lastName !== undefined && { lastName: input.lastName }),
    });
  }

  /**
   * Cambia el correo confirmando la contraseña (§104.9). Se audita con el valor anterior y el
   * nuevo, y se avisa al correo anterior; un fallo del envío no revierte el cambio.
   */
  async changeEmail(auth: AuthContext, input: ChangeEmailInput): Promise<UserRow> {
    await this.confirmPassword(auth.user, input.password);

    const previousEmail = auth.user.email;
    if (input.newEmail === previousEmail) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'El correo no es válido.', {
        details: [{ path: 'newEmail', message: 'El nuevo correo es igual al actual.' }],
      });
    }

    const updated = await this.db.transaction(async (tx) => {
      let row: UserRow | undefined;
      try {
        [row] = await tx
          .update(users)
          .set({ email: input.newEmail, version: nextVersion(users.version) })
          .where(eq(users.id, auth.user.id))
          .returning();
      } catch (error) {
        throw emailInUseIfUniqueViolation(error);
      }
      await this.audit.record(tx, {
        action: 'user.email.changed',
        entityType: 'user',
        entityId: auth.user.id,
        actorUserId: auth.user.id,
        oldValues: { email: previousEmail },
        newValues: { email: input.newEmail },
      });
      return row!;
    });

    await this.notifyEmailChanged(previousEmail, input.newEmail);
    return updated;
  }

  private async notifyEmailChanged(previousEmail: string, newEmail: string): Promise<void> {
    try {
      await this.mail.send({
        to: previousEmail,
        subject: 'Se cambió el correo de tu cuenta de LetFer',
        text:
          `El correo de tu cuenta de LetFer se cambió a ${maskEmail(newEmail)}.\n\n` +
          'Si no fuiste tú, avisa de inmediato a un administrador: alguien pudo acceder a tu cuenta.',
      });
    } catch (error) {
      this.logger.warn(`No se pudo enviar el aviso de cambio de correo: ${String(error)}`);
    }
  }
}
