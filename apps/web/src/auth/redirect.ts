/**
 * Ruta a la que volver tras iniciar sesión (`?next=`). Solo se admiten rutas internas: nada de
 * URLs absolutas ni `//host` ni `/\host`, para que el parámetro no sirva de redirección abierta.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

/** Enlace al inicio de sesión que devuelve a `path` después de entrar. */
export function loginPathFor(path: string): string {
  return path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`;
}
