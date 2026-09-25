import { z } from 'zod';
import { USER_STATUSES, type UserStatus } from './user.js';

/**
 * Estados de una solicitud de eliminación de cuenta (§8, §111.3, D8-5). Mismo ciclo que los
 * retiros (D5): solo `PENDING` admite una decisión; el resto son estados finales.
 */
export const ACCOUNT_DELETION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

export const ADMIN_USERS_DEFAULT_LIMIT = 25;
export const ADMIN_USERS_MAX_LIMIT = 100;

export const listAdminUsersQuerySchema = z.object({
  status: z.enum(USER_STATUSES).optional(),
  /** Texto contenido en el nombre, el apellido o el correo. */
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_USERS_MAX_LIMIT)
    .default(ADMIN_USERS_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;

/** Deshabilitar o reactivar una cuenta: con la versión leída (§96) y un motivo opcional. */
export const setUserStatusSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

export const requestAccountDeletionSchema = z.preprocess(
  (value) => value ?? {},
  z.object({ reason: z.string().trim().max(500).optional() }),
);
export type RequestAccountDeletionInput = { reason?: string | undefined };

export const decideAccountDeletionSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});
export type DecideAccountDeletionInput = z.infer<typeof decideAccountDeletionSchema>;

export const listAccountDeletionsQuerySchema = z.object({
  status: z.enum(ACCOUNT_DELETION_STATUSES).optional(),
});
export type ListAccountDeletionsQuery = z.infer<typeof listAccountDeletionsQuerySchema>;

/** Fila de la lista de usuarios del Administrador Global. */
export interface AdminUserSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: UserStatus;
  /** Clave del rol global (p. ej. `USER`, `GLOBAL_ADMIN`). */
  globalRole: string;
  createdAt: string;
  lastLoginAt: string | null;
  version: number;
  /** Proyectos de los que es propietario (en cualquier estado): bloquean deshabilitar/eliminar. */
  ownedProjectCount: number;
  hasPendingDeletionRequest: boolean;
}

export interface AdminUserPage {
  items: AdminUserSummary[];
  total: number;
}

export interface AdminUserDetail extends AdminUserSummary {
  deletedAt: string | null;
  ownedProjects: { id: string; name: string; status: string }[];
  activeSessionCount: number;
  /** Última solicitud de eliminación de cuenta, si la hubo. */
  deletionRequest: AccountDeletionRequestSummary | null;
}

/** Estado de la solicitud de la propia persona: un objeto, porque la API no serializa un `null` suelto. */
export interface MyAccountDeletionState {
  request: AccountDeletionRequestSummary | null;
}

export interface AccountDeletionRequestSummary {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: AccountDeletionStatus;
  reason: string | null;
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionReason: string | null;
  version: number;
}
