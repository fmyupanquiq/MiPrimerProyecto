import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './app-config.js';

const baseEnv = { DATABASE_URL: 'postgresql://user:secret-pass@localhost:5432/db' };

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
    });
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

  it('rechaza números inválidos', () => {
    expect(() => loadConfig({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...baseEnv, LOCKOUT_MAX_FAILURES: '0' })).toThrow(
      /LOCKOUT_MAX_FAILURES/,
    );
  });

  it('en producción exige HTTPS y cookie Secure (§41)', () => {
    const production = { ...baseEnv, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...production, APP_BASE_URL: 'http://letfer.example' })).toThrow(
      /HTTPS/,
    );
    expect(() =>
      loadConfig({ ...production, APP_BASE_URL: 'https://letfer.example', COOKIE_SECURE: 'false' }),
    ).toThrow(/Secure/);

    const ok = loadConfig({ ...production, APP_BASE_URL: 'https://letfer.example' });
    expect(ok.cookieSecure).toBe(true);
  });
});
