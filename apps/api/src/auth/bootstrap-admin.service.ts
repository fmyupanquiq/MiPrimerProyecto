import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail, passwordPolicyIssues } from '@letfer/shared';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { users } from '../database/schema/index.js';
import { UsersService } from '../users/users.service.js';
import { PasswordHasher } from './password-hasher.js';

export interface BootstrapAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export type BootstrapAdminResult =
  { status: 'created'; userId: string } | { status: 'already_exists' };

/** Datos de entrada inválidos. Los mensajes nunca incluyen la contraseña. */
export class BootstrapAdminError extends Error {
  constructor(readonly issues: string[]) {
    super(`No se pudo crear el Administrador Global:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'BootstrapAdminError';
  }
}

/** Clave fija del bloqueo asesor que serializa ejecuciones simultáneas del bootstrap. */
const BOOTSTRAP_LOCK_KEY = 8_304_117_001;

const inputSchema = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1, 'es obligatorio'),
  lastName: z.string().trim().min(1, 'es obligatorio'),
});

/**
 * Crea el primer Administrador Global (spec §83). No es un registro público: lo ejecuta un
 * comando administrativo con credenciales de las variables de entorno (nunca del repositorio).
 *
 * Es idempotente: si ya existe un Administrador Global no cambia nada y, en particular, jamás
 * sobrescribe una contraseña ni asciende a un usuario existente.
 */
@Injectable()
export class BootstrapAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  async run(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
    const issues = this.validate(input);
    if (issues.length > 0) throw new BootstrapAdminError(issues);

    // El hash (costoso) se calcula fuera de la transacción para no retener el bloqueo.
    const passwordHash = await this.hasher.hash(input.password);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

      const [existingAdmin] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.systemRole, 'GLOBAL_ADMIN'))
        .limit(1);
      if (existingAdmin) return { status: 'already_exists' } as const;

      if (await this.usersService.findByEmail(input.email, tx)) {
        throw new BootstrapAdminError([
          'ya existe un usuario con ese correo que no es Administrador Global; ' +
            'el bootstrap no asciende cuentas existentes',
        ]);
      }

      const admin = await this.usersService.create(
        {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          passwordHash,
          systemRole: 'GLOBAL_ADMIN',
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'user.bootstrap_admin',
        entityType: 'user',
        entityId: admin.id,
        actorUserId: null,
        newValues: { email: admin.email, systemRole: admin.systemRole },
      });
      return { status: 'created', userId: admin.id } as const;
    });
  }

  private validate(input: BootstrapAdminInput): string[] {
    const issues: string[] = [];
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    }
    for (const issue of passwordPolicyIssues(input.password, {
      email: normalizeEmail(input.email),
    })) {
      issues.push(`password: ${issue.message}`);
    }
    return issues;
  }
}
