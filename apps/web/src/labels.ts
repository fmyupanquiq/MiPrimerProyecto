import type {
  AccountDeletionStatus,
  BackupStatus,
  BetCorrectionKind,
  BetStatus,
  BetType,
  TotalOddsSource,
  HouseStatus,
  BatchFinancialSemaphore,
  ImportBatchStatus,
  ImportRowReportCategory,
  ImportRowStatus,
  ImportSemaphore,
  IntegrityCheckStatus,
  InvitationExpiry,
  InvitationStatus,
  MaintenanceStatus,
  MaintenanceTrigger,
  MemberStatus,
  MovementDirection,
  MovementType,
  ProjectStatus,
  ReconciliationStatus,
  StageStatus,
  TicketAnalysisStatus,
  TicketExtraction,
  UserStatus,
  WithdrawalStatus,
} from '@letfer/shared';
import { getDisplayTimeZone } from './time-zone.js';

/** Nombres visibles de los roles de sistema (los personalizados usan su propio nombre). */
const ROLE_LABELS: Record<string, string> = {
  PROJECT_ADMIN: 'Administrador de proyecto',
  COLLABORATOR: 'Colaborador',
  READER: 'Lector',
  PROJECT_OWNER: 'Propietario',
  GLOBAL_ADMIN: 'Administrador Global',
  USER: 'Usuario',
};

export const roleLabel = (key: string | null | undefined, fallback = ''): string =>
  (key ? ROLE_LABELS[key] : undefined) ?? (fallback || key || '');

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: 'Activo',
  CLOSED: 'Cerrado',
  TRASHED: 'En la papelera',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Activa',
  DISABLED: 'Deshabilitada',
  DELETED: 'Eliminada',
};

export const ACCOUNT_DELETION_STATUS_LABELS: Record<AccountDeletionStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  ACTIVE: 'Activo',
  LEFT: 'Salió',
  REMOVED: 'Expulsado',
};

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  ACTIVE: 'Vigente',
  ACCEPTED: 'Aceptada',
  EXPIRED: 'Vencida',
  DISABLED: 'Deshabilitada',
};

export const EXPIRY_LABELS: Record<InvitationExpiry, string> = {
  '24h': '24 horas',
  '7d': '7 días',
  '15d': '15 días',
  '30d': '30 días',
  never: 'Sin vencimiento (hasta deshabilitarla)',
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  ACTIVE: 'Activa',
  CLOSED: 'Cerrada',
  TRASHED: 'En la papelera',
};

export const HOUSE_STATUS_LABELS: Record<HouseStatus, string> = {
  ACTIVE: 'Activa',
  INACTIVE: 'Desactivada',
};

/** Estados de un lote de importación (§113.9). */
export const IMPORT_BATCH_STATUS_LABELS: Record<ImportBatchStatus, string> = {
  UPLOADED: 'Subido',
  VALIDATED: 'Validado',
  IMPORTED: 'Importado',
  ANNULLED: 'Anulado',
};

/** Semáforo estructural de un lote (D-X17b). */
export const IMPORT_SEMAPHORE_LABELS: Record<ImportSemaphore, string> = {
  OK: 'Listo',
  NEEDS_ACKNOWLEDGMENT: 'Requiere reconocimiento',
  BLOCKED: 'Bloqueado',
};

/** Semáforo financiero del lote frente a las cifras del archivo (§113.7). */
export const IMPORT_FINANCIAL_SEMAPHORE_LABELS: Record<BatchFinancialSemaphore, string> = {
  GREEN: 'Verde',
  YELLOW: 'Amarillo',
  RED: 'Rojo',
};

/** Clasificación de una fila del archivo (D-X21, D-X21b). */
export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  VALID: 'Válida',
  TEMPLATE: 'Plantilla',
  EMPTY: 'Vacía',
  PARTIAL: 'Parcial',
  INVALID: 'Inválida',
};

/** Efecto de una fila sobre la confirmación (D-X17b). */
export const IMPORT_ROW_CATEGORY_LABELS: Record<ImportRowReportCategory, string> = {
  BLOCKING: 'Bloquea',
  NEEDS_ACKNOWLEDGMENT: 'Requiere reconocimiento',
  INFORMATIONAL: 'Informativa',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  INITIAL_CAPITAL: 'Capital inicial',
  DEPOSIT: 'Depósito',
  WITHDRAWAL: 'Retiro',
  TRANSFER: 'Transferencia',
  EXTRAORDINARY: 'Extraordinario',
  BET_PLACEMENT: 'Apuesta (colocación)',
  BET_SETTLEMENT: 'Apuesta (liquidación)',
  REVERSAL: 'Reversión',
};

export const TOTAL_ODDS_SOURCE_LABELS: Record<TotalOddsSource, string> = {
  OFFICIAL: 'Oficial (la muestra la casa)',
  CALCULATED: 'Calculada de referencia',
  UNKNOWN: 'Origen no verificado',
};

export const BET_TYPE_LABELS: Record<BetType, string> = {
  SIMPLE: 'Simple',
  CREATED: 'Creada',
  MULTIPLE: 'Múltiple',
};

export const BET_STATUS_LABELS: Record<BetStatus, string> = {
  PENDING: 'Pendiente',
  WON: 'Ganada',
  LOST: 'Perdida',
  VOID: 'Anulada',
  CASHOUT: 'Cash Out',
};

export const BET_CORRECTION_KIND_LABELS: Record<BetCorrectionKind, string> = {
  RETURN_CONFIRMATION: 'Confirmación del retorno oficial',
  SETTLEMENT_CORRECTION: 'Corrección de la liquidación',
  REOPEN: 'Reapertura',
  TRASH_REVERSAL: 'Envío a la papelera',
  RESTORE_REPOST: 'Restauración',
};

export const MOVEMENT_DIRECTION_LABELS: Record<MovementDirection, string> = {
  CREDIT: 'Entrada',
  DEBIT: 'Salida',
};

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
};

export const RECONCILIATION_STATUS_LABELS: Record<ReconciliationStatus, string> = {
  MATCHED: 'Coincide',
  DISCREPANCY: 'Discrepancia',
  INVALIDATED: 'Invalidado',
};

export const INTEGRITY_CHECK_STATUS_LABELS: Record<IntegrityCheckStatus, string> = {
  OK: 'Sin hallazgos',
  ISSUES_FOUND: 'Hallazgos encontrados',
};

export const INTEGRITY_CHECK_LABELS: Record<string, string> = {
  NEGATIVE_AVAILABLE: 'Disponible negativo',
  SETTLEMENT_SHAPE: 'Forma de liquidación',
  PENDING_BET_REFERENCES: 'Referencias de apuestas pendientes',
  LEDGER_SHAPE: 'Forma del ledger',
  CHECKPOINT_INVALIDATION: 'Invalidación de checkpoints',
  BET_LEDGER_NET: 'Efecto de la apuesta en el ledger',
  REVERSAL_INTEGRITY: 'Reversiones y correcciones',
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
};

export const MAINTENANCE_TRIGGER_LABELS: Record<MaintenanceTrigger, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Automática (diaria)',
};

export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

export const TICKET_ANALYSIS_STATUS_LABELS: Record<TicketAnalysisStatus, string> = {
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

/** Nombres visibles de los campos del contrato de extracción (§53), para la revisión humana. */
export const TICKET_FIELD_LABELS: Record<keyof TicketExtraction, string> = {
  house: 'Casa',
  placedDate: 'Fecha de colocación',
  placedTime: 'Hora de colocación',
  betType: 'Tipo de apuesta',
  externalReference: 'Referencia del ticket',
  selections: 'Selecciones',
  stake: 'Stake',
  officialTotalOdds: 'Cuota total',
  officialAmount: 'Monto apostado',
  officialPotentialReturn: 'Retorno potencial',
  officialRealizedReturn: 'Retorno realizado',
  result: 'Resultado',
};

export const DATE_FORMAT_LABELS = {
  'DD/MM/YYYY': 'DD/MM/AAAA (día/mes/año)',
  'MM/DD/YYYY': 'MM/DD/AAAA (mes/día/año)',
  'YYYY-MM-DD': 'AAAA-MM-DD',
} as const;

/** Fecha y hora legibles, en la zona del proyecto (§93; fuera de un proyecto, la del navegador). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: getDisplayTimeZone(),
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PE', {
    dateStyle: 'medium',
    timeZone: getDisplayTimeZone(),
  });
}

/**
 * Momento de una apuesta: con hora si se conoce; si no, solo la fecha (§93: no se inventa una
 * hora como si fuese oficial, p. ej. las 12:00 técnicas de una importación, §113.4).
 */
export function formatMoment(iso: string, timeKnown: boolean): string {
  return timeKnown ? formatDateTime(iso) : `${formatDate(iso)} (hora desconocida)`;
}

/** Fecha corta (día y mes) para los ejes de los gráficos. */
export function formatShortDate(iso: string, month: 'short' | '2-digit' = 'short'): string {
  return new Date(iso).toLocaleDateString('es-PE', {
    day: '2-digit',
    month,
    timeZone: getDisplayTimeZone(),
  });
}

/** Zonas horarias IANA disponibles en el navegador (con la de Lima siempre presente). */
export function timeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes('America/Lima') ? supported : ['America/Lima', ...supported];
}
