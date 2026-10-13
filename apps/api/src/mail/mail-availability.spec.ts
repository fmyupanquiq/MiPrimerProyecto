import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@letfer/shared';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { AppError } from '../common/app-error.js';
import { APP_CONFIG, loadConfig } from '../config/app-config.js';
import { MailModule } from './mail.module.js';
import {
  FileOutboxMailService,
  MailService,
  MailUnavailableError,
  UnavailableMailService,
} from './mail.service.js';
import { SmtpMailService } from './smtp-mail.service.js';

const base = { DATABASE_URL: 'postgresql://user:secret-pass@localhost:5432/letfer_prod' };
const production = {
  ...base,
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://letfer.example',
  TICKETS_DIR: '/var/lib/letfer/tickets',
  BACKUP_DIR: '/var/lib/letfer/backups',
};

async function resolveMail(env: Record<string, string>): Promise<MailService> {
  @Global()
  @Module({
    providers: [{ provide: APP_CONFIG, useValue: loadConfig(env) }],
    exports: [APP_CONFIG],
  })
  class TestConfigModule {}
  const moduleRef = await Test.createTestingModule({
    imports: [TestConfigModule, MailModule],
  }).compile();
  return moduleRef.get(MailService);
}

describe('adaptador de correo según entorno', () => {
  it('producción sin SMTP: correo no disponible, nunca finge enviar', async () => {
    const mail = await resolveMail(production);
    expect(mail).toBeInstanceOf(UnavailableMailService);
    expect(mail.available).toBe(false);
    await expect(
      mail.send({ to: 'a@b.c', subject: 's', text: 'enlace-secreto' }),
    ).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(
      mail.send({ to: 'a@b.c', subject: 's', text: 'enlace-secreto' }),
    ).rejects.not.toThrow(/enlace-secreto|secret-pass/);
  });

  it('producción con SMTP: se usa el adaptador SMTP', async () => {
    const mail = await resolveMail({
      ...production,
      SMTP_HOST: 'smtp.letfer.example',
      MAIL_FROM: 'LetFer <no-reply@letfer.example>',
    });
    expect(mail).toBeInstanceOf(SmtpMailService);
    expect(mail.available).toBe(true);
  });

  it('desarrollo sin SMTP: se conserva el adaptador de carpeta outbox', async () => {
    const mail = await resolveMail(base);
    expect(mail).toBeInstanceOf(FileOutboxMailService);
    expect(mail.available).toBe(true);
  });
});

describe('recuperación de contraseña sin correo', () => {
  it('responde un 409 claro, igual para cualquier correo, sin tocar la base', async () => {
    const service = new PasswordResetService(
      ...([null, null, null, null, null, null] as unknown as [
        never,
        never,
        never,
        never,
        never,
        never,
      ]),
      new UnavailableMailService(),
      ...([null, null] as unknown as [never, never]),
    );
    for (const email of ['existe@letfer.example', 'no-existe@letfer.example']) {
      const error = await service.requestReset(email).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).getStatus()).toBe(409);
      expect((error as AppError).getResponse()).toMatchObject({ code: ErrorCode.INVALID_STATE });
    }
  });
});
