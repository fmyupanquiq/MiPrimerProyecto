import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './app-config.js';

const baseEnv = { DATABASE_URL: 'postgresql://user:secret-pass@localhost:5432/db' };

/** Lo que producción exige además de HTTPS y la clave de Anthropic (ADR 0021). */
const productionInfra = {
  TICKETS_DIR: '/var/lib/letfer/tickets',
  BACKUP_DIR: '/var/lib/letfer/backups',
  SMTP_HOST: 'smtp.letfer.example',
  MAIL_FROM: 'LetFer <no-reply@letfer.example>',
};

describe('loadConfig', () => {
  it('aplica los valores por defecto aprobados en la especificación (§104)', () => {
    const config = loadConfig(baseEnv);

    expect(config.session).toEqual({
      persistentIdleSeconds: 30 * 86400,
      persistentAbsoluteSeconds: 90 * 86400,
      temporaryIdleSeconds: 3600,
      temporaryAbsoluteSeconds: 12 * 3600,
      touchIntervalSeconds: 60,
    });
    expect(config.lockout).toEqual({ maxFailures: 5, windowSeconds: 900, durationSeconds: 900 });
    expect(config.passwordReset).toEqual({ ttlSeconds: 3600, maxPerHour: 3 });
    expect(config.reauthWindowSeconds).toBe(300);
    expect(config.appOrigin).toBe('http://localhost:5173');
    expect(config.cookieSecure).toBe(false);
    expect(config.backup).toEqual({
      dir: '.data/backups',
      retentionCount: 30,
      checkIntervalSeconds: 3600,
      scheduleHourUtc: 3,
      schedulerEnabled: true,
      pgDumpPath: 'pg_dump',
      pgRestorePath: 'pg_restore',
      tarPath: 'tar',
    });
    expect(config.tickets).toEqual({
      dir: '.data/tickets',
      anthropicApiKey: undefined,
      anthropicModel: 'claude-sonnet-5-5',
      aiEnabled: true,
      maxAnalysesPerTicket: 5,
      maxAnalysesPerProjectDay: 50,
      aiTimeoutMs: 60_000,
      aiMaxRetries: 1,
    });
  });

  it('el modelo de Anthropic y el interruptor de IA son configurables (Fase 10.6)', () => {
    const config = loadConfig({
      ...baseEnv,
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      AI_TICKETS_ENABLED: 'false',
    });
    expect(config.tickets.anthropicModel).toBe('claude-opus-5-5');
    expect(config.tickets.aiEnabled).toBe(false);
  });

  it('permite sobrescribir parámetros mediante variables de entorno', () => {
    const config = loadConfig({ ...baseEnv, LOCKOUT_MAX_FAILURES: '3', PORT: '4000' });
    expect(config.lockout.maxFailures).toBe(3);
    expect(config.port).toBe(4000);
  });

  it('falla si falta DATABASE_URL y nombra la variable', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('no revela el valor de las variables inválidas', () => {
    const attempt = () => loadConfig({ DATABASE_URL: 'mysql://user:secret-pass@host/db' });
    expect(attempt).toThrow(ConfigError);
    expect(attempt).not.toThrow(/secret-pass/);
  });

  it('exige un mínimo de 7 días de retención del mantenimiento (L5)', () => {
    expect(loadConfig(baseEnv).maintenance.retentionDays).toBe(30);
    expect(
      loadConfig({ ...baseEnv, MAINTENANCE_RETENTION_DAYS: '7' }).maintenance.retentionDays,
    ).toBe(7);
    for (const value of ['0', '1', '6', '-3', 'abc']) {
      expect(() => loadConfig({ ...baseEnv, MAINTENANCE_RETENTION_DAYS: value })).toThrow(
        /MAINTENANCE_RETENTION_DAYS/,
      );
    }
  });

  it('rechaza números inválidos', () => {
    expect(() => loadConfig({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...baseEnv, LOCKOUT_MAX_FAILURES: '0' })).toThrow(
      /LOCKOUT_MAX_FAILURES/,
    );
  });

  it('en producción exige HTTPS y cookie Secure (§41)', () => {
    const production = {
      ...baseEnv,
      ...productionInfra,
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    };
    expect(() => loadConfig({ ...production, APP_BASE_URL: 'http://letfer.example' })).toThrow(
      /HTTPS/,
    );
    expect(() =>
      loadConfig({ ...production, APP_BASE_URL: 'https://letfer.example', COOKIE_SECURE: 'false' }),
    ).toThrow(/Secure/);

    const ok = loadConfig({ ...production, APP_BASE_URL: 'https://letfer.example' });
    expect(ok.cookieSecure).toBe(true);
  });

  describe('IA de tickets en producción: la clave depende de AI_TICKETS_ENABLED (D-T1)', () => {
    const production = {
      ...baseEnv,
      ...productionInfra,
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://letfer.example',
    };

    it('IA desactivada y sin clave: la configuración es válida', () => {
      const config = loadConfig({ ...production, AI_TICKETS_ENABLED: 'false' });
      expect(config.tickets.aiEnabled).toBe(false);
      expect(config.tickets.anthropicApiKey).toBeUndefined();
    });

    it('IA activada con clave: la configuración es válida', () => {
      const config = loadConfig({
        ...production,
        AI_TICKETS_ENABLED: 'true',
        ANTHROPIC_API_KEY: 'sk-ant-test',
      });
      expect(config.tickets.aiEnabled).toBe(true);
      expect(config.tickets.anthropicApiKey).toBe('sk-ant-test');
    });

    it('IA activada explícitamente y sin clave: error que no revela valores', () => {
      const env = { ...production, AI_TICKETS_ENABLED: 'true' };
      expect(() => loadConfig(env)).toThrow(/ANTHROPIC_API_KEY/);
      expect(() => loadConfig(env)).toThrow(ConfigError);
      try {
        loadConfig(env);
      } catch (error) {
        expect(String((error as Error).message)).not.toContain('secret-pass');
      }
    });

    it('AI_TICKETS_ENABLED ausente: en producción la IA queda desactivada y no pide clave', () => {
      const config = loadConfig(production);
      expect(config.tickets.aiEnabled).toBe(false);
      expect(config.tickets.anthropicApiKey).toBeUndefined();
    });

    it('AI_TICKETS_ENABLED ausente: en desarrollo y pruebas la IA sigue activa', () => {
      expect(loadConfig(baseEnv).tickets.aiEnabled).toBe(true);
      expect(loadConfig({ ...baseEnv, NODE_ENV: 'test' }).tickets.aiEnabled).toBe(true);
      expect(loadConfig({ ...baseEnv, NODE_ENV: 'development' }).tickets.aiEnabled).toBe(true);
    });

    it('una clave presente no activa la IA en producción si no se pide explícitamente', () => {
      const config = loadConfig({ ...production, ANTHROPIC_API_KEY: 'sk-ant-test' });
      expect(config.tickets.aiEnabled).toBe(false);
    });

    it('fuera de producción la clave sigue siendo opcional', () => {
      expect(() => loadConfig(baseEnv)).not.toThrow();
      expect(() => loadConfig({ ...baseEnv, AI_TICKETS_ENABLED: 'true' })).not.toThrow();
    });

    it('timeout y reintentos de Anthropic son configurables y están acotados', () => {
      const config = loadConfig({ ...baseEnv, AI_TIMEOUT_SECONDS: '30', AI_MAX_RETRIES: '0' });
      expect(config.tickets.aiTimeoutMs).toBe(30_000);
      expect(config.tickets.aiMaxRetries).toBe(0);
      expect(() => loadConfig({ ...baseEnv, AI_MAX_RETRIES: '4' })).toThrow(/AI_MAX_RETRIES/);
      expect(() => loadConfig({ ...baseEnv, AI_TIMEOUT_SECONDS: '0' })).toThrow(
        /AI_TIMEOUT_SECONDS/,
      );
    });
  });

  describe('producción: nunca una base de desarrollo, pruebas o ensayo', () => {
    const production = {
      ...productionInfra,
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://letfer.example',
      AI_TICKETS_ENABLED: 'false',
    };
    const url = (database: string) => ({
      DATABASE_URL: `postgresql://user:secret-pass@localhost:5432/${database}`,
    });

    it.each(['letfer_dev', 'letfer_test', 'letfer_trial'])('rechaza %s', (database) => {
      const attempt = () => loadConfig({ ...production, ...url(database) });
      expect(attempt).toThrow(ConfigError);
      expect(attempt).toThrow(new RegExp(database));
      try {
        attempt();
      } catch (error) {
        expect((error as Error).message).not.toContain('secret-pass');
      }
    });

    it('permite una base de producción, incluso si el nombre contiene esas palabras', () => {
      for (const database of ['letfer_prod', 'letfer', 'letfer_trial_archivo', 'prod_letfer_dev']) {
        expect(loadConfig({ ...production, ...url(database) }).databaseUrl).toContain(database);
      }
    });

    it('fuera de producción permite letfer_trial, letfer_dev y letfer_test', () => {
      for (const database of ['letfer_trial', 'letfer_dev', 'letfer_test']) {
        expect(() => loadConfig(url(database))).not.toThrow();
      }
    });
  });

  describe('producción: rutas persistentes y correo (ADR 0021)', () => {
    const production = {
      ...baseEnv,
      ...productionInfra,
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://letfer.example',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    };

    it('acepta la configuración completa de producción', () => {
      const config = loadConfig(production);
      expect(config.tickets.dir).toBe('/var/lib/letfer/tickets');
      expect(config.backup.dir).toBe('/var/lib/letfer/backups');
      expect(config.mail.smtp).toEqual({
        host: 'smtp.letfer.example',
        port: 587,
        secure: false,
        user: undefined,
        password: undefined,
        from: 'LetFer <no-reply@letfer.example>',
      });
    });

    it('exige rutas absolutas para TICKETS_DIR y BACKUP_DIR', () => {
      expect(() => loadConfig({ ...production, TICKETS_DIR: '.data/tickets' })).toThrow(
        /TICKETS_DIR/,
      );
      expect(() => loadConfig({ ...production, BACKUP_DIR: 'backups' })).toThrow(/BACKUP_DIR/);
      // Por defecto (relativas) también falla: nunca se usan en producción sin decidirlo.
      expect(() => loadConfig({ ...production, TICKETS_DIR: undefined })).toThrow(/TICKETS_DIR/);
    });

    it('exige SMTP_HOST y MAIL_FROM', () => {
      expect(() => loadConfig({ ...production, SMTP_HOST: undefined })).toThrow(/SMTP_HOST/);
      expect(() => loadConfig({ ...production, MAIL_FROM: undefined })).toThrow(/MAIL_FROM/);
    });

    it('no revela la contraseña SMTP al fallar', () => {
      const attempt = () => loadConfig({ ...production, SMTP_PASSWORD: 'smtp-secret-value' });
      expect(attempt).toThrow(/SMTP_USER y SMTP_PASSWORD/);
      expect(attempt).not.toThrow(/smtp-secret-value/);
    });
  });

  it('fuera de producción el correo SMTP es opcional y coherente', () => {
    expect(loadConfig(baseEnv).mail.smtp).toBeNull();
    expect(() => loadConfig({ ...baseEnv, SMTP_HOST: 'smtp.local' })).toThrow(/MAIL_FROM/);
    const config = loadConfig({
      ...baseEnv,
      SMTP_HOST: 'smtp.local',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'letfer',
      SMTP_PASSWORD: 'x',
      MAIL_FROM: 'no-reply@local',
    });
    expect(config.mail.smtp).toMatchObject({ port: 465, secure: true, user: 'letfer' });
  });
});
