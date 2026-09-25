/** Cómo se lanzó una purga de registros auxiliares (§111.6): a mano o por la tarea diaria interna. */
export const MAINTENANCE_TRIGGERS = ['MANUAL', 'SCHEDULED'] as const;
export type MaintenanceTrigger = (typeof MAINTENANCE_TRIGGERS)[number];

export const MAINTENANCE_STATUSES = ['COMPLETED', 'FAILED'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/**
 * Filas eliminadas por tabla. Solo existen estos tres contadores porque la purga se limita a
 * tablas auxiliares (D8-1, D8-3): nunca datos de negocio, ledger, invitaciones ni auditoría.
 */
export interface MaintenancePurged {
  sessions: number;
  loginAttempts: number;
  passwordResetTokens: number;
}

export interface MaintenanceRunSummary {
  id: string;
  trigger: MaintenanceTrigger;
  /** Quién la lanzó; nulo si fue la tarea programada. */
  runBy: { id: string; name: string } | null;
  startedAt: string;
  finishedAt: string;
  status: MaintenanceStatus;
  /** Antigüedad mínima, en días, que se exigió a lo purgado. */
  retentionDays: number;
  purged: MaintenancePurged;
  /** Solo si `status = 'FAILED'`; nunca incluye detalles internos. */
  errorMessage: string | null;
}
