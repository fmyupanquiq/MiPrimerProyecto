import { z } from 'zod';
import { emailSchema } from './auth.js';

/** Vencimientos que se pueden elegir al invitar (§105.7). */
export const INVITATION_EXPIRIES = ['24h', '7d', '15d', '30d', 'never'] as const;
export type InvitationExpiry = (typeof INVITATION_EXPIRIES)[number];

/** Horas de vigencia de cada opción; `null` = sin vencimiento hasta deshabilitarla. */
export const INVITATION_EXPIRY_HOURS: Record<InvitationExpiry, number | null> = {
  '24h': 24,
  '7d': 7 * 24,
  '15d': 15 * 24,
  '30d': 30 * 24,
  never: null,
};

export const DEFAULT_INVITATION_EXPIRY: InvitationExpiry = '7d';

/** Estado derivado de una invitación (no se guarda, §105.7). */
export const INVITATION_STATUSES = ['ACTIVE', 'ACCEPTED', 'EXPIRED', 'DISABLED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Creación de una invitación. Por prudencia, por defecto es de un solo uso y vence a los 7 días
 * (ADR 0011); `restrictedEmail` es opcional y se compara en minúsculas.
 */
export const createInvitationSchema = z.object({
  roleId: z.uuid(),
  expiry: z.enum(INVITATION_EXPIRIES).default(DEFAULT_INVITATION_EXPIRY),
  singleUse: z.boolean().default(true),
  restrictedEmail: emailSchema.nullish().transform((value) => value ?? null),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Token de invitación (256 bits en base64url: 43 caracteres). */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const invitationTokenSchema = z.object({ token: z.string().trim().max(200) });
export type InvitationTokenInput = z.infer<typeof invitationTokenSchema>;

export interface InvitationSummary {
  id: string;
  projectId: string;
  roleId: string;
  /** Clave del rol de sistema; nulo si es un rol personalizado. */
  roleKey: string | null;
  roleName: string;
  status: InvitationStatus;
  singleUse: boolean;
  expiresAt: string | null;
  restrictedEmail: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  /** Cuántas personas ingresaron con esta invitación. */
  acceptedCount: number;
  disabledAt: string | null;
}

/** Respuesta de la creación: el único momento en que se conoce el enlace (§105.7). */
export interface CreatedInvitation extends InvitationSummary {
  token: string;
  link: string;
}
