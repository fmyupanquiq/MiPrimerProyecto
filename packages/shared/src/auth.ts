import { z } from 'zod';
import { passwordPolicyIssues } from './password-policy.js';
import type { PermissionCode } from './permissions.js';
import type { PublicUser } from './user.js';

/** Correo normalizado (sin espacios, en minúsculas) y con formato válido. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * Contraseña nueva: aplica la política de longitud (§104.4). La regla de la parte local del
 * correo la completa el servidor, que es quien conoce el correo del usuario.
 */
export const newPasswordSchema = z.string().superRefine((value, context) => {
  for (const issue of passwordPolicyIssues(value)) {
    context.addIssue({ code: 'custom', message: issue.message });
  }
});

/** Tope de longitud de una contraseña recibida: evita hashear entradas enormes. */
const MAX_SUBMITTED_PASSWORD_LENGTH = 1024;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_SUBMITTED_PASSWORD_LENGTH),
  /** "Mantener sesión iniciada" (§3, §104.2). */
  keepSignedIn: z.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Solicitud de recuperación de contraseña (§104.4). La respuesta no revela si el correo existe. */
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Restablecimiento con el token recibido por correo (§104.4). */
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: newPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Cambio de contraseña con la sesión iniciada (§104.4). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_SUBMITTED_PASSWORD_LENGTH),
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Reautenticación por contraseña para operaciones sensibles (§39, §104.5). */
export const reauthSchema = z.object({
  password: z.string().min(1).max(MAX_SUBMITTED_PASSWORD_LENGTH),
});
export type ReauthInput = z.infer<typeof reauthSchema>;

const personNameSchema = z.string().trim().min(1).max(100);

/**
 * Registro por invitación (§84, §105.7): sin cuenta, el enlace permite crearla (rol global USER).
 * La cuenta se crea y se abre sesión, pero la invitación NO se acepta: es un paso posterior.
 */
export const registerSchema = z.object({
  token: z.string().trim().max(200),
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  keepSignedIn: z.boolean().default(false),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Edición del perfil. `version` es la versión que el cliente leyó: si otra edición la cambió
 * mientras tanto, la API responde `CONCURRENCY_CONFLICT` (§96).
 */
export const updateProfileSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => value.firstName !== undefined || value.lastName !== undefined, {
    message: 'Indica al menos un campo para modificar.',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Cambio de correo confirmando la contraseña (§104.9). */
export const changeEmailSchema = z.object({
  newEmail: emailSchema,
  password: z.string().min(1).max(MAX_SUBMITTED_PASSWORD_LENGTH),
});
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;

/** Datos de una sesión abierta que se muestran al usuario (§3). */
export interface SessionInfo {
  id: string;
  persistent: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  /** `true` para la sesión desde la que se hace la consulta. */
  current: boolean;
}

/** Respuesta de inicio de sesión y de `GET /auth/me`. */
export interface AuthState {
  user: PublicUser;
  session: SessionInfo;
  /** Permisos globales del usuario (para mostrar u ocultar controles; el backend siempre valida). */
  permissions: PermissionCode[];
}
