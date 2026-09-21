import type { Request, Response } from 'express';
import type { AppConfig } from '../config/app-config.js';

/**
 * Nombre de la cookie de sesión. Con HTTPS usa el prefijo `__Host-`, que obliga al navegador
 * a exigir `Secure`, ruta `/` y ausencia de `Domain` (mayor protección contra fijación).
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-letfer_session' : 'letfer_session';
}

/** Lee las cookies de la cabecera `Cookie`. Ignora entradas mal formadas. */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!name || cookies.has(name)) continue;
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      // Valor con codificación inválida: se ignora.
    }
  }
  return cookies;
}

export interface ExtractedToken {
  token: string;
  via: 'cookie' | 'bearer';
}

/** Obtiene el token de sesión de `Authorization: Bearer` o, si no, de la cookie. */
export function extractSessionToken(request: Request, secure: boolean): ExtractedToken | null {
  const authorization = request.headers.authorization;
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    return match ? { token: match[1]!, via: 'bearer' } : null;
  }
  const cookie = parseCookieHeader(request.headers.cookie).get(sessionCookieName(secure));
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

const cookieOptions = (config: AppConfig) => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax' as const,
  path: '/',
});

/**
 * Entrega el token como cookie `HttpOnly` (inaccesible para JavaScript). Con "Mantener sesión"
 * es persistente (hasta el tope absoluto); sin ella es cookie de sesión del navegador.
 */
export function writeSessionCookie(
  response: Response,
  token: string,
  config: AppConfig,
  persistent: boolean,
): void {
  response.cookie(sessionCookieName(config.cookieSecure), token, {
    ...cookieOptions(config),
    ...(persistent && { maxAge: config.session.persistentAbsoluteSeconds * 1000 }),
  });
}

export function clearSessionCookie(response: Response, config: AppConfig): void {
  response.clearCookie(sessionCookieName(config.cookieSecure), cookieOptions(config));
}
