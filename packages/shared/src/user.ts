/** Estados de cuenta (spec §104.6). Solo `ACTIVE` puede iniciar sesión. */
export const USER_STATUSES = ['ACTIVE', 'DISABLED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Datos de un usuario que la API expone al propio usuario (nunca incluye secretos). */
export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarRef: string | null;
  status: UserStatus;
  /** Clave del rol global (p. ej. `USER`, `GLOBAL_ADMIN`; §105.2). */
  globalRole: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** Versión para el control de concurrencia optimista al editar el perfil (§96). */
  version: number;
}

/** Forma canónica de un correo: sin espacios en los extremos y en minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
