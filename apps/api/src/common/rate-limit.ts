import { SetMetadata } from '@nestjs/common';

export const AUTH_RATE_LIMIT_KEY = 'letfer:auth-rate-limit';

/**
 * Marca un endpoint sensible (login, recuperación de contraseña, reautenticación) para que
 * use el límite de tasa estricto `auth` en lugar del general.
 */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);
