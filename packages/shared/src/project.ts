import { z } from 'zod';
import type { PermissionCode } from './permissions.js';

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

// ---------------------------------------------------------------------------------------------
// Esquemas de entrada y tipos de respuesta
// ---------------------------------------------------------------------------------------------
/** ¿Es una zona horaria IANA válida? (§93). Usa la base de datos de zonas del propio motor JS. */
export function isValidTimezone(value: string): boolean {
  if (!value || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Sin caracteres de control (p. ej. NUL, que PostgreSQL no admite en texto); se permiten saltos de línea en la descripción.
const noControlChars = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const isControl = code < 0x20 || code === 0x7f;
    if (isControl && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
};
const CONTROL_MESSAGE = { message: 'Contiene caracteres no permitidos.' };
const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_NAME_MAX_LENGTH)
  .refine(noControlChars, CONTROL_MESSAGE);
const projectDescriptionSchema = z
  .string()
  .trim()
  .max(PROJECT_DESCRIPTION_MAX_LENGTH)
  .refine(noControlChars, CONTROL_MESSAGE);
const timezoneSchema = z.string().trim().refine(isValidTimezone, {
  message: 'Zona horaria no válida (usa un nombre IANA, p. ej. America/Lima).',
});

/** Creación de un proyecto (§105.1, §105.6). La moneda es siempre PEN en esta versión. */
export const createProjectSchema = z.object({
  name: projectNameSchema,
  description: projectDescriptionSchema.default(''),
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
  dateFormat: z.enum(DATE_FORMATS).default(DEFAULT_DATE_FORMAT),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * Edición de la configuración del proyecto. `version` es la versión leída por el cliente
 * (control de concurrencia optimista, §96). La moneda no se modifica (§105.6).
 */
export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema.optional(),
    timezone: timezoneSchema.optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
    version: z.number().int().positive(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.timezone !== undefined ||
      value.dateFormat !== undefined,
    { message: 'Indica al menos un campo para modificar.' },
  );
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Motivo opcional al enviar un proyecto a la papelera o expulsar a un miembro. */
export const reasonSchema = z.preprocess(
  (value) => value ?? {},
  z.object({ reason: z.string().trim().max(500).optional() }),
);
export type ReasonInput = { reason?: string | undefined };

export const listProjectsQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/** Proyecto en un listado ("Mis proyectos", papelera). */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  imageRef: string | null;
  status: ProjectStatus;
  ownerId: string;
  ownerName: string;
  /** El usuario que consulta es el propietario. */
  isOwner: boolean;
  /** Clave del rol de membresía del usuario (nulo si accede solo por su rol global). */
  myRole: string | null;
  createdAt: string;
  /** Solo en la papelera. */
  deletedAt: string | null;
  purgeEligibleAt: string | null;
  previousStatus: ProjectStatus | null;
}

/** Proyecto completo con los permisos efectivos del usuario que lo consulta. */
export interface ProjectDetail extends ProjectSummary {
  currency: Currency;
  timezone: string;
  dateFormat: DateFormat;
  version: number;
  updatedAt: string;
  myPermissions: PermissionCode[];
}
