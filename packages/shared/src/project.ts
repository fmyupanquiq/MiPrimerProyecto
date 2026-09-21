/** Estados de un proyecto (spec §85, §105.5). */
export const PROJECT_STATUSES = ['ACTIVE', 'CLOSED', 'TRASHED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Estados de una membresía (spec §105.4). */
export const MEMBER_STATUSES = ['ACTIVE', 'LEFT', 'REMOVED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Monedas admitidas. Por ahora solo PEN (§5); la arquitectura queda preparada para más. */
export const SUPPORTED_CURRENCIES = ['PEN'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = 'PEN';
export const DEFAULT_TIMEZONE = 'America/Lima';
export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY';

/** Días que un proyecto permanece restaurable en la papelera (§9, §89). */
export const PROJECT_TRASH_RETENTION_DAYS = 90;

export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;
