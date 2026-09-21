/** Oculta la parte local de un correo para mencionarlo sin exponerlo entero (`a***@dominio`). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
