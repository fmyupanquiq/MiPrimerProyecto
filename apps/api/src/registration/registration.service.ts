import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeEmail,
  passwordPolicyIssues,
  type RegisterInput,
} from '@letfer/shared';
import { AuditService } from '../audit/audit.service.js';
import type { LoginResult } from '../auth/auth.service.js';
import { PasswordHasher } from '../auth/password-hasher.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { RequestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { InvitationAcceptanceService } from '../projects/invitation-acceptance.service.js';
import { SessionService } from '../sessions/session.service.js';
import { UsersService } from '../users/users.service.js';

/**
 * Registro por invitación (§84, §105.7): quien recibe un enlace y no tiene cuenta puede crearla.
 * Solo se admite con un enlace vigente cuyo correo (si está restringido) coincida. La cuenta
 * nace con el rol global USER y con sesión abierta, pero NO acepta la invitación: eso lo decide
 * la persona después.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invitations: InvitationAcceptanceService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async register(input: RegisterInput): Promise<LoginResult> {
    const email = normalizeEmail(input.email);

    // Comprobación previa y barata: sin un enlace válido no se hashea nada ni se informa de la
    // política de contraseñas.
    await this.invitations.validateForRegistration(this.db, input.token, email);

    const issues = passwordPolicyIssues(input.password, { email });
    if (issues.length > 0) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'La contraseña no es válida.', {
        details: issues.map((issue) => ({ path: 'password', message: issue.message })),
      });
    }
    const passwordHash = await this.hasher.hash(input.password);
    const context = RequestContext.current();

    return this.db.transaction(async (tx) => {
      // Se vuelve a comprobar dentro de la transacción: el enlace pudo deshabilitarse entretanto.
      const invitation = await this.invitations.validateForRegistration(tx, input.token, email);

      const user = await this.users.create(
        {
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          passwordHash,
          globalRole: 'USER',
        },
        tx,
      );
      const { token, session } = await this.sessions.create(
        {
          userId: user.id,
          persistent: input.keepSignedIn,
          ip: context?.ip,
          userAgent: context?.userAgent,
        },
        tx,
      );
      RequestContext.set({ userId: user.id, sessionId: session.id });
      await this.audit.record(tx, {
        action: 'auth.registered',
        entityType: 'user',
        entityId: user.id,
        projectId: invitation.projectId,
        actorUserId: user.id,
        metadata: { invitationId: invitation.id, persistent: input.keepSignedIn },
      });
      const access = await this.authorization.globalAccess(user, tx);
      return {
        token,
        user,
        session,
        globalRoleKey: access.roleKey,
        globalPermissions: access.permissions,
      };
    });
  }
}
