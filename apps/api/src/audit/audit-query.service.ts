import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AuditLogEntry,
  type AuditLogPage,
  type ListProjectAuditLogsQuery,
} from '@letfer/shared';
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { auditLogs, users } from '../database/schema/index.js';
import { redactSensitive } from './audit-values.js';

/** Alcance de una consulta: el proyecto lo fija la ruta, nunca el cliente (aislamiento, D8-2). */
export type AuditScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'global'; projectId?: string | undefined; systemOnly?: boolean | undefined };

type AuditFilters = ListProjectAuditLogsQuery;

/** Instante con microsegundos, tal como lo devuelve `to_char` de PostgreSQL. */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidCursor = () =>
  new AppError(400, ErrorCode.VALIDATION_FAILED, 'El cursor de paginación no es válido.');

export function encodeAuditCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor: string): { at: string; id: string } {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (rest.length > 0 || !at || !id || !CURSOR_AT.test(at) || !UUID.test(id)) {
    throw invalidCursor();
  }
  return { at, id };
}

/** Escapa `%`, `_` y `\` para usar un texto literal como prefijo de `LIKE`. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Visor de auditoría (§10, §35, §111.1): solo lectura, con filtros y paginación por cursor sobre
 * `(occurred_at, id)`. El cursor conserva los microsegundos del instante para no perder ni
 * repetir filas que compartan milisegundo.
 */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(scope: AuditScope, filters: AuditFilters): Promise<AuditLogPage> {
    const conditions: (SQL | undefined)[] = [];

    if (scope.kind === 'project') {
      conditions.push(eq(auditLogs.projectId, scope.projectId));
    } else if (scope.systemOnly) {
      conditions.push(isNull(auditLogs.projectId));
    } else if (scope.projectId) {
      conditions.push(eq(auditLogs.projectId, scope.projectId));
    }

    if (filters.from) conditions.push(gte(auditLogs.occurredAt, new Date(filters.from)));
    if (filters.to) conditions.push(lte(auditLogs.occurredAt, new Date(filters.to)));
    if (filters.actorUserId) conditions.push(eq(auditLogs.actorUserId, filters.actorUserId));
    if (filters.action) {
      conditions.push(sql`${auditLogs.action} LIKE ${`${escapeLike(filters.action)}%`}`);
    }
    if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
    if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
    if (filters.cursor) {
      const { at, id } = decodeAuditCursor(filters.cursor);
      conditions.push(
        sql`(${auditLogs.occurredAt}, ${auditLogs.id}) < (${at}::timestamptz, ${id}::uuid)`,
      );
    }

    const cursorAt = sql<string>`to_char(${auditLogs.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await this.db
      .select({
        log: auditLogs,
        cursorAt,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(filters.limit + 1);

    const page = rows.slice(0, filters.limit);
    const last = page.at(-1);
    const items = page.map(({ log, actorFirstName, actorLastName }): AuditLogEntry => ({
      id: log.id,
      occurredAt: log.occurredAt.toISOString(),
      actor:
        log.actorUserId && actorFirstName !== null
          ? { id: log.actorUserId, name: `${actorFirstName} ${actorLastName ?? ''}`.trim() }
          : null,
      projectId: log.projectId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      // Defensa en profundidad: aunque una entrada antigua hubiera guardado un secreto, no sale.
      oldValues: log.oldValues ? redactSensitive(log.oldValues) : null,
      newValues: log.newValues ? redactSensitive(log.newValues) : null,
      metadata: log.metadata ? redactSensitive(log.metadata) : null,
      ip: log.ip,
      userAgent: log.userAgent,
      sessionId: log.sessionId,
      requestId: log.requestId,
    }));
    return {
      items,
      nextCursor:
        rows.length > filters.limit && last ? encodeAuditCursor(last.cursorAt, last.log.id) : null,
    };
  }
}
