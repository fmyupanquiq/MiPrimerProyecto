import type { BootstrapAdminInput } from '../auth/bootstrap-admin.service.js';

const VARIABLES = {
  email: 'BOOTSTRAP_ADMIN_EMAIL',
  password: 'BOOTSTRAP_ADMIN_PASSWORD',
  firstName: 'BOOTSTRAP_ADMIN_FIRST_NAME',
  lastName: 'BOOTSTRAP_ADMIN_LAST_NAME',
} as const;

export type BootstrapEnvResult =
  { ok: true; input: BootstrapAdminInput } | { ok: false; missing: string[] };

/** Lee las credenciales del bootstrap desde el entorno. Informa qué variables faltan. */
export function readBootstrapInput(env: NodeJS.ProcessEnv): BootstrapEnvResult {
  const missing = Object.values(VARIABLES).filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    input: {
      email: env[VARIABLES.email]!.trim(),
      password: env[VARIABLES.password]!,
      firstName: env[VARIABLES.firstName]!.trim(),
      lastName: env[VARIABLES.lastName]!.trim(),
    },
  };
}
