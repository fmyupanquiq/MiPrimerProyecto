import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { RequestContext } from '../common/request-context.js';
import type { DbExecutor } from '../database/database.types.js';
import { auditLogs } from '../database/schema/index.js';
import { redactSensitive, type AuditValues } from './audit-values.js';

export interface AuditEntry {
  /** Acción en formato `dominio.objeto.verbo`, p. ej. `auth.login.succeeded`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /**
   * Usuario que actúa. Si se omite se toma el de la petición en curso; `null` indica
   * expresamente una acción anónima o del sistema.
   */
  actorUserId?: string | null;
  projectId?: string | null;
  oldValues?: AuditValues | null;
  newValues?: AuditValues | null;
  metadata?: AuditValues | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly clock: Clock) {}

  /**
   * Registra una entrada de auditoría dentro del ejecutor recibido. Se pasa la transacción
   * de la operación auditada para que ambas se confirmen o se revoquen juntas (§57).
   */
  async record(executor: DbExecutor, entry: AuditEntry): Promise<void> {
    const context = RequestContext.current();
    await executor.insert(auditLogs).values({
      occurredAt: this.clock.now(),
      actorUserId: entry.actorUserId === undefined ? (context?.userId ?? null) : entry.actorUserId,
      projectId: entry.projectId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValues: entry.oldValues ? redactSensitive(entry.oldValues) : null,
      newValues: entry.newValues ? redactSensitive(entry.newValues) : null,
      metadata: entry.metadata ? redactSensitive(entry.metadata) : null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      sessionId: context?.sessionId ?? null,
      requestId: context?.requestId ?? null,
    });
  }
}
