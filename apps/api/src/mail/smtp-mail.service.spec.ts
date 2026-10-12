import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/app-config.js';
import { SmtpMailService, smtpTransportOptions } from './smtp-mail.service.js';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }) }));

const env = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SMTP_HOST: 'smtp.letfer.example',
  SMTP_USER: 'letfer',
  SMTP_PASSWORD: 'smtp-secret',
  MAIL_FROM: 'LetFer <no-reply@letfer.example>',
};

describe('SmtpMailService (ADR 0021)', () => {
  beforeEach(() => {
    sendMail.mockReset();
  });

  it('exige STARTTLS cuando no es TLS directo y TLS directo con SMTP_SECURE', () => {
    const starttls = smtpTransportOptions(loadConfig(env).mail.smtp!);
    expect(starttls).toMatchObject({
      host: 'smtp.letfer.example',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'letfer', pass: 'smtp-secret' },
    });
    const tls = smtpTransportOptions(
      loadConfig({ ...env, SMTP_PORT: '465', SMTP_SECURE: 'true' }).mail.smtp!,
    );
    expect(tls).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it('sin usuario no envía credenciales', () => {
    const anonymous = { ...env, SMTP_USER: undefined, SMTP_PASSWORD: undefined };
    expect(smtpTransportOptions(loadConfig(anonymous).mail.smtp!)).not.toHaveProperty('auth');
  });

  it('envía con el remitente configurado y propaga los fallos del proveedor', async () => {
    const service = new SmtpMailService(loadConfig(env));
    sendMail.mockResolvedValueOnce({});
    await service.send({ to: 'ana@letfer.example', subject: 'Asunto', text: 'Cuerpo' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'LetFer <no-reply@letfer.example>',
      to: 'ana@letfer.example',
      subject: 'Asunto',
      text: 'Cuerpo',
    });

    sendMail.mockRejectedValueOnce(new Error('550 rechazado'));
    await expect(
      service.send({ to: 'ana@letfer.example', subject: 'Asunto', text: 'Cuerpo' }),
    ).rejects.toThrow('550');
  });

  it('no se construye sin configuración SMTP', () => {
    const withoutSmtp = loadConfig({ ...env, SMTP_HOST: undefined });
    expect(() => new SmtpMailService(withoutSmtp)).toThrow(/SMTP_HOST/);
  });
});
