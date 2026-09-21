import { z } from 'zod';
import { passwordPolicyIssues } from './password-policy.js';
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
}
