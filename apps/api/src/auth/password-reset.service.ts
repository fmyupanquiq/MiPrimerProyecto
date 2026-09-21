import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode, normalizeEmail, passwordPolicyIssues } from '@letfer/shared';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { RequestContext } from '../common/request-context.js';
import { lockByKey } from '../database/advisory-lock.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { passwordResetTokens, users } from '../database/schema/index.js';
import { MailService } from '../mail/mail.service.js';
import { hashToken, SessionService } from '../sessions/session.service.js';
import { UsersService } from '../users/users.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { PasswordHasher } from './password-hasher.js';

const invalidToken = () =>
  new AppError(400, ErrorCode.INVALID_TOKEN, 'El enlace no es válido o ha caducado.');

/**
 * Recuperación de contraseña (§84, §104.4): un token aleatorio de 256 bits enviado por correo
 * (en la base de datos solo se guarda su hash), válido 1 hora y de un solo uso.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptsService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Solicita un enlace de recuperación. Nunca revela si el correo existe: no hay diferencia
   * observable entre un correo registrado y uno que no lo está. El envío se lanza sin esperarlo
   * para que la duración de la respuesta tampoco lo delate.
   */
  async requestReset(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status !== 'ACTIVE') return;

    const now = this.clock.now();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const token = randomBytes(32).toString('base64url');

    const created = await this.db.transaction(async (tx) => {
      // Serializa las solicitudes del mismo usuario: el límite y la invalidación de enlaces
      // anteriores deben ser exactos aunque lleguen varias a la vez.
      await lockByKey(tx, `reset:${user.id}`);

      const [recent] = await tx
        .select({ total: count() })
        .from(passwordResetTokens)
        .where(
          and(eq(passwordResetTokens.userId, user.id), gt(passwordResetTokens.createdAt, hourAgo)),
        );
      if ((recent?.total ?? 0) >= this.config.passwordReset.maxPerHour) {
        // Límite por usuario alcanzado: se ignora en silencio (evita inundar el buzón).
        return false;
      }

      // Un enlace nuevo invalida los anteriores (§104.4).
      await tx
        .update(passwordResetTokens)
        .set({ invalidatedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt),
            isNull(passwordResetTokens.invalidatedAt),
          ),
        );
      await tx.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.config.passwordReset.ttlSeconds * 1000),
        requestedIp: RequestContext.current()?.ip ?? null,
      });
      await this.audit.record(tx, {
        action: 'auth.password_reset.requested',
        entityType: 'user',
        entityId: user.id,
        actorUserId: null,
      });
      return true;
    });
    if (!created) return;

    const link = `${this.config.appBaseUrl}/reset-password?token=${token}`;
    const minutes = Math.round(this.config.passwordReset.ttlSeconds / 60);
    // Sin `await`: un proveedor lento no debe alargar la respuesta. Los fallos solo se registran.
    void this.mail
      .send({
        to: user.email,
        subject: 'Restablece tu contraseña de LetFer',
        text:
          'Recibimos una solicitud para restablecer la contraseña de tu cuenta de LetFer.\n\n' +
          `Abre este enlace (válido ${minutes} minutos y de un solo uso):\n${link}\n\n` +
          'Si no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.',
      })
      .catch((error: unknown) => {
        this.logger.warn(`No se pudo enviar el correo de recuperación: ${String(error)}`);
      });
  }

  /**
   * Restablece la contraseña con el token. El token se consume de forma atómica (un solo uso
   * incluso con peticiones simultáneas), se cierran todas las sesiones del usuario y se reinicia
   * su bloqueo por intentos. Si la contraseña no cumple la política el token NO se consume.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const now = this.clock.now();
    const tokenHash = hashToken(token);

    const [row] = await this.db
      .select({ userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.invalidatedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);
    if (!row) throw invalidToken();

    const user = await this.usersService.findById(row.userId);
    if (!user || user.status !== 'ACTIVE') throw invalidToken();

    const issues = passwordPolicyIssues(newPassword, { email: user.email });
    if (issues.length > 0) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'La contraseña nueva no es válida.', {
        details: issues.map((issue) => ({ path: 'newPassword', message: issue.message })),
      });
    }

    const newHash = await this.hasher.hash(newPassword);
    await this.db.transaction(async (tx) => {
      // Consumo atómico: solo una petición puede pasar de "sin usar" a "usada".
      const consumed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            isNull(passwordResetTokens.invalidatedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .returning({ id: passwordResetTokens.id });
      if (consumed.length === 0) throw invalidToken();

      await tx
        .update(users)
        .set({ passwordHash: newHash, passwordChangedAt: now })
        .where(eq(users.id, user.id));
      const revokedSessions = await this.sessions.revokeAllForUser(
        user.id,
        'password_reset',
        {},
        tx,
      );
      // Recuperar el acceso por el correo del propietario levanta el bloqueo por intentos.
      await this.attempts.reset(user.email, RequestContext.current()?.ip, tx);
      await this.audit.record(tx, {
        action: 'auth.password_reset.completed',
        entityType: 'user',
        entityId: user.id,
        actorUserId: null,
        metadata: { revokedSessions },
      });
    });
  }
}
