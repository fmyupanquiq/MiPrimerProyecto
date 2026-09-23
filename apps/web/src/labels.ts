import type {
  BetStatus,
  BetType,
  HouseStatus,
  InvitationExpiry,
  InvitationStatus,
  MemberStatus,
  MovementDirection,
  MovementType,
  ProjectStatus,
  StageStatus,
  WithdrawalStatus,
} from '@letfer/shared';

/** Nombres visibles de los roles de sistema (los personalizados usan su propio nombre). */
const ROLE_LABELS: Record<string, string> = {
  PROJECT_ADMIN: 'Administrador de proyecto',
  COLLABORATOR: 'Colaborador',
  READER: 'Lector',
  PROJECT_OWNER: 'Propietario',
};

export const roleLabel = (key: string | null | undefined, fallback = ''): string =>
  (key ? ROLE_LABELS[key] : undefined) ?? (fallback || key || '');

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: 'Activo',
  CLOSED: 'Cerrado',
  TRASHED: 'En la papelera',
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

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  INITIAL_CAPITAL: 'Capital inicial',
  DEPOSIT: 'Depósito',
  WITHDRAWAL: 'Retiro',
  TRANSFER: 'Transferencia',
  EXTRAORDINARY: 'Extraordinario',
  BET_PLACEMENT: 'Apuesta (colocación)',
  BET_SETTLEMENT: 'Apuesta (liquidación)',
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

export const DATE_FORMAT_LABELS = {
  'DD/MM/YYYY': 'DD/MM/AAAA (día/mes/año)',
  'MM/DD/YYYY': 'MM/DD/AAAA (mes/día/año)',
  'YYYY-MM-DD': 'AAAA-MM-DD',
} as const;

/** Fecha y hora legibles en el idioma de la persona usuaria. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PE', { dateStyle: 'medium' });
}

/** Zonas horarias IANA disponibles en el navegador (con la de Lima siempre presente). */
export function timeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes('America/Lima') ? supported : ['America/Lima', ...supported];
}
