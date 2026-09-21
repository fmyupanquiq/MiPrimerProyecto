/** Política de contraseñas (spec §104.4): longitud de 10 a 128, sin reglas de composición. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * La parte local del correo solo se compara cuando tiene al menos este número de caracteres:
 * con partes locales de 1 o 2 caracteres la regla vetaría casi cualquier contraseña.
 */
export const EMAIL_LOCAL_PART_MIN_CHECK_LENGTH = 3;

export type PasswordIssueCode = 'TOO_SHORT' | 'TOO_LONG' | 'CONTAINS_EMAIL_LOCAL_PART';

export interface PasswordIssue {
  code: PasswordIssueCode;
  message: string;
}

/** Longitud en caracteres Unicode (no en unidades UTF-16). */
const lengthOf = (value: string): number => [...value].length;

/** Parte local del correo (antes de la última `@`) en minúsculas. */
function emailLocalPart(email: string): string {
  const at = email.lastIndexOf('@');
  return (at === -1 ? email : email.slice(0, at)).trim().toLowerCase();
}

/**
 * Valida una contraseña nueva. La comprueba tanto la web (ayuda al usuario) como la API
 * (autoridad, §58). Devuelve la lista de problemas; vacía si la contraseña es válida.
 */
export function passwordPolicyIssues(
  password: string,
  context: { email?: string } = {},
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const length = lengthOf(password);
  if (length < PASSWORD_MIN_LENGTH) {
    issues.push({
      code: 'TOO_SHORT',
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    });
  }
  if (length > PASSWORD_MAX_LENGTH) {
    issues.push({
      code: 'TOO_LONG',
      message: `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`,
    });
  }
  if (context.email) {
    const local = emailLocalPart(context.email);
    if (
      lengthOf(local) >= EMAIL_LOCAL_PART_MIN_CHECK_LENGTH &&
      password.toLowerCase().includes(local)
    ) {
      issues.push({
        code: 'CONTAINS_EMAIL_LOCAL_PART',
        message: 'La contraseña no puede contener la parte local de tu correo electrónico.',
      });
    }
  }
  return issues;
}
