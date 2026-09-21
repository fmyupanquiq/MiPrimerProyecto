import type { AuthState, SessionInfo } from '@letfer/shared';
import type { SessionRow, UserRow } from '../database/schema/index.js';
import { toPublicUser } from '../users/users.service.js';

export function toSessionInfo(session: SessionRow, currentSessionId: string): SessionInfo {
  return {
    id: session.id,
    persistent: session.persistent,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    ip: session.ip,
    userAgent: session.userAgent,
    current: session.id === currentSessionId,
  };
}

/** Estado de autenticación que se devuelve al cliente: usuario público y sesión actual. */
export function toAuthState(user: UserRow, session: SessionRow): AuthState {
  return { user: toPublicUser(user), session: toSessionInfo(session, session.id) };
}
