import { z } from 'zod';

/** Tamaño de página del visor de auditoría (§10, §35, §111.1). */
export const AUDIT_PAGE_DEFAULT_LIMIT = 50;
export const AUDIT_PAGE_MAX_LIMIT = 100;

/** Filtros comunes del visor de auditoría por proyecto y global. */
const auditFilterShape = {
  /** Cursor opaco devuelto por la página anterior (`nextCursor`). */
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX_LIMIT).default(AUDIT_PAGE_DEFAULT_LIMIT),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  actorUserId: z.uuid().optional(),
  /** Acción exacta o prefijo (p. ej. `project.` incluye todas las del proyecto). */
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.uuid().optional(),
};

const validRange = (value: { from?: string | undefined; to?: string | undefined }) =>
  !value.from || !value.to || new Date(value.from).getTime() <= new Date(value.to).getTime();
const rangeMessage = { message: 'La fecha inicial no puede ser posterior a la final.' };

/** El proyecto lo fija la ruta: esta consulta nunca acepta un `projectId` (aislamiento, D8-2). */
export const listProjectAuditLogsQuerySchema = z.object(auditFilterShape).refine(validRange, {
  ...rangeMessage,
  path: ['from'],
});
export type ListProjectAuditLogsQuery = z.infer<typeof listProjectAuditLogsQuerySchema>;

/** Auditoría global: `projectId` filtra un proyecto; `system` deja solo lo que no tiene proyecto. */
export const listGlobalAuditLogsQuerySchema = z
  .object({
    ...auditFilterShape,
    projectId: z.uuid().optional(),
    system: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .refine(validRange, { ...rangeMessage, path: ['from'] })
  .refine((value) => !(value.system && value.projectId), {
    message: 'Usa `projectId` o `system`, no ambos.',
    path: ['system'],
  });
export type ListGlobalAuditLogsQuery = z.infer<typeof listGlobalAuditLogsQuerySchema>;

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actor: { id: string; name: string } | null;
  projectId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  /** `null` cuando no hay más resultados. */
  nextCursor: string | null;
}
