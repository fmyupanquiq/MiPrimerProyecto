import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Token de inyección de la configuración tipada de la aplicación. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const MIN_MAINTENANCE_RETENTION_DAYS = 7;

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const booleanFlag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

/**
 * Variables de entorno reconocidas. Los valores por defecto de sesiones, bloqueo,
 * recuperación y reautenticación son los aprobados en la especificación (§104).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Origen público de la web: se usa en los enlaces de correo y en la validación de `Origin`.
  APP_BASE_URL: z.url().default('http://localhost:5173'),
  // Número de proxys de confianza delante de la API ("0" = ninguno).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  // §104.2: sesiones
  SESSION_PERSISTENT_IDLE_SECONDS: positiveInt(30 * DAY),
  SESSION_PERSISTENT_ABSOLUTE_SECONDS: positiveInt(90 * DAY),
  SESSION_TEMPORARY_IDLE_SECONDS: positiveInt(HOUR),
  SESSION_TEMPORARY_ABSOLUTE_SECONDS: positiveInt(12 * HOUR),
  SESSION_TOUCH_INTERVAL_SECONDS: positiveInt(60),

  // §104.3: bloqueo por intentos fallidos
  LOCKOUT_MAX_FAILURES: positiveInt(5),
  LOCKOUT_WINDOW_SECONDS: positiveInt(15 * 60),
  LOCKOUT_DURATION_SECONDS: positiveInt(15 * 60),

  // §104.4: recuperación de contraseña
  PASSWORD_RESET_TTL_SECONDS: positiveInt(HOUR),
  PASSWORD_RESET_MAX_PER_HOUR: positiveInt(3),

  // §104.5: reautenticación
  REAUTH_WINDOW_SECONDS: positiveInt(5 * 60),

  // argon2id (parámetros mínimos recomendados por OWASP: m=19 MiB, t=2, p=1)
  ARGON2_MEMORY_KIB: positiveInt(19456),
  ARGON2_PASSES: positiveInt(2),
  ARGON2_PARALLELISM: positiveInt(1),

  // Limitación de tasa por IP
  THROTTLE_ENABLED: booleanFlag(true),
  THROTTLE_LIMIT: positiveInt(300),
  THROTTLE_TTL_SECONDS: positiveInt(60),
  THROTTLE_AUTH_LIMIT: positiveInt(20),
  THROTTLE_AUTH_TTL_SECONDS: positiveInt(60),

  // Correo: en desarrollo los mensajes se escriben como archivos en esta carpeta.
  MAIL_OUTBOX_DIR: z.string().min(1).default('.data/outbox'),

  // Backups (§37, §82, §109.3, D-B1 a D-B4): disparados desde dentro de la propia API, sin
  // depender de un cron del sistema operativo ni de un proveedor concreto.
  BACKUP_DIR: z.string().min(1).default('.data/backups'),
  BACKUP_RETENTION_COUNT: positiveInt(30),
  BACKUP_CHECK_INTERVAL_SECONDS: positiveInt(HOUR),
  BACKUP_SCHEDULE_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_SCHEDULER_ENABLED: booleanFlag(true),
  // D-B2: exige pg_dump/pg_restore en el entorno (ADR 0016); rutas configurables para no
  // depender de que estén en el PATH.
  PG_DUMP_PATH: z.string().min(1).default('pg_dump'),
  PG_RESTORE_PATH: z.string().min(1).default('pg_restore'),
  // Mantenimiento (§111.6, ADR 0018): purga diaria de registros auxiliares caducados. Solo
  // sesiones, intentos de acceso y tokens de recuperación con más de N días desde que dejaron de
  // valer; nunca datos de negocio ni auditoría.
  // Mínimo de 7 días: un valor menor borraría rastro de seguridad reciente (sesiones, intentos).
  MAINTENANCE_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(MIN_MAINTENANCE_RETENTION_DAYS)
    .default(30),
  MAINTENANCE_CHECK_INTERVAL_SECONDS: positiveInt(HOUR),
  MAINTENANCE_SCHEDULE_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(4),
  MAINTENANCE_SCHEDULER_ENABLED: booleanFlag(true),
  // Tickets: los backups también empaquetan este directorio con `tar` (ADR 0017).
  TAR_PATH: z.string().min(1).default('tar'),

  // Tickets e IA (§28-§31, §110, D-T2 a D-T6, ADR 0017)
  TICKETS_DIR: z.string().min(1).default('.data/tickets'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5'),
  AI_MAX_ANALYSES_PER_TICKET: positiveInt(5),
  AI_MAX_ANALYSES_PER_PROJECT_DAY: positiveInt(50),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  appBaseUrl: string;
  /** Origen (esquema + host + puerto) de la web, derivado de `appBaseUrl`. */
  appOrigin: string;
  trustProxyHops: number;
  cookieSecure: boolean;
  session: {
    persistentIdleSeconds: number;
    persistentAbsoluteSeconds: number;
    temporaryIdleSeconds: number;
    temporaryAbsoluteSeconds: number;
    touchIntervalSeconds: number;
  };
  lockout: { maxFailures: number; windowSeconds: number; durationSeconds: number };
  passwordReset: { ttlSeconds: number; maxPerHour: number };
  reauthWindowSeconds: number;
  argon2: { memoryKib: number; passes: number; parallelism: number };
  throttle: {
    enabled: boolean;
    limit: number;
    ttlMs: number;
    authLimit: number;
    authTtlMs: number;
  };
  mail: { outboxDir: string };
  backup: {
    dir: string;
    retentionCount: number;
    checkIntervalSeconds: number;
    scheduleHourUtc: number;
    schedulerEnabled: boolean;
    pgDumpPath: string;
    pgRestorePath: string;
    /** Empaqueta `tickets.dir` junto al volcado en cada generación (ADR 0017). */
    tarPath: string;
  };
  maintenance: {
    retentionDays: number;
    checkIntervalSeconds: number;
    scheduleHourUtc: number;
    schedulerEnabled: boolean;
  };
  tickets: {
    dir: string;
    anthropicApiKey: string | undefined;
    anthropicModel: string;
    /** D-T6/§110.4: límites de análisis IA, contados sobre `ticket_analyses` (sin tabla aparte). */
    maxAnalysesPerTicket: number;
    maxAnalysesPerProjectDay: number;
  };
}

/** Error de configuración: el mensaje nombra las variables inválidas, nunca sus valores. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Valida y convierte las variables de entorno. Falla de forma clara y sin revelar valores. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(entorno)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuración inválida. Revisa el archivo .env:\n${problems}`);
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === 'production';
  const appOrigin = new URL(values.APP_BASE_URL).origin;

  if (isProduction && !appOrigin.startsWith('https://')) {
    throw new ConfigError(
      'Configuración inválida. Revisa el archivo .env:\n' +
        '  - APP_BASE_URL: en producción debe usar HTTPS (§41)',
    );
  }
  const cookieSecure = values.COOKIE_SECURE ? values.COOKIE_SECURE === 'true' : isProduction;
  if (isProduction && !cookieSecure) {
    throw new ConfigError(
      'Configuración inválida. Revisa el archivo .env:\n' +
        '  - COOKIE_SECURE: en producción la cookie de sesión debe ser Secure (§41)',
    );
  }
  if (isProduction && !values.ANTHROPIC_API_KEY) {
    throw new ConfigError(
      'Configuración inválida. Revisa el archivo .env:\n' +
        '  - ANTHROPIC_API_KEY: obligatoria en producción para analizar tickets (D-T1)',
    );
  }

  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    databaseUrl: values.DATABASE_URL,
    appBaseUrl: values.APP_BASE_URL,
    appOrigin,
    trustProxyHops: values.TRUST_PROXY_HOPS,
    cookieSecure,
    session: {
      persistentIdleSeconds: values.SESSION_PERSISTENT_IDLE_SECONDS,
      persistentAbsoluteSeconds: values.SESSION_PERSISTENT_ABSOLUTE_SECONDS,
      temporaryIdleSeconds: values.SESSION_TEMPORARY_IDLE_SECONDS,
      temporaryAbsoluteSeconds: values.SESSION_TEMPORARY_ABSOLUTE_SECONDS,
      touchIntervalSeconds: values.SESSION_TOUCH_INTERVAL_SECONDS,
    },
    lockout: {
      maxFailures: values.LOCKOUT_MAX_FAILURES,
      windowSeconds: values.LOCKOUT_WINDOW_SECONDS,
      durationSeconds: values.LOCKOUT_DURATION_SECONDS,
    },
    passwordReset: {
      ttlSeconds: values.PASSWORD_RESET_TTL_SECONDS,
      maxPerHour: values.PASSWORD_RESET_MAX_PER_HOUR,
    },
    reauthWindowSeconds: values.REAUTH_WINDOW_SECONDS,
    argon2: {
      memoryKib: values.ARGON2_MEMORY_KIB,
      passes: values.ARGON2_PASSES,
      parallelism: values.ARGON2_PARALLELISM,
    },
    throttle: {
      enabled: values.THROTTLE_ENABLED,
      limit: values.THROTTLE_LIMIT,
      ttlMs: values.THROTTLE_TTL_SECONDS * 1000,
      authLimit: values.THROTTLE_AUTH_LIMIT,
      authTtlMs: values.THROTTLE_AUTH_TTL_SECONDS * 1000,
    },
    mail: { outboxDir: values.MAIL_OUTBOX_DIR },
    backup: {
      dir: values.BACKUP_DIR,
      retentionCount: values.BACKUP_RETENTION_COUNT,
      checkIntervalSeconds: values.BACKUP_CHECK_INTERVAL_SECONDS,
      scheduleHourUtc: values.BACKUP_SCHEDULE_HOUR_UTC,
      schedulerEnabled: values.BACKUP_SCHEDULER_ENABLED,
      pgDumpPath: values.PG_DUMP_PATH,
      pgRestorePath: values.PG_RESTORE_PATH,
      tarPath: values.TAR_PATH,
    },
    maintenance: {
      retentionDays: values.MAINTENANCE_RETENTION_DAYS,
      checkIntervalSeconds: values.MAINTENANCE_CHECK_INTERVAL_SECONDS,
      scheduleHourUtc: values.MAINTENANCE_SCHEDULE_HOUR_UTC,
      schedulerEnabled: values.MAINTENANCE_SCHEDULER_ENABLED,
    },
    tickets: {
      dir: values.TICKETS_DIR,
      anthropicApiKey: values.ANTHROPIC_API_KEY,
      anthropicModel: values.ANTHROPIC_MODEL,
      maxAnalysesPerTicket: values.AI_MAX_ANALYSES_PER_TICKET,
      maxAnalysesPerProjectDay: values.AI_MAX_ANALYSES_PER_PROJECT_DAY,
    },
  };
}

/**
 * Carga el archivo `.env` (si existe) en `process.env` sin sobrescribir variables ya definidas.
 * Busca en el directorio actual y en la raíz del monorepo (los workspaces se ejecutan en `apps/api`).
 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
    }
  }
}
