import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig, type SmtpConfig } from '../config/app-config.js';
import { MailService, type MailMessage } from './mail.service.js';

/** Opciones de transporte de nodemailer derivadas de la configuración SMTP. */
export function smtpTransportOptions(smtp: SmtpConfig) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // Sin TLS directo se exige STARTTLS: nunca se envían credenciales ni enlaces en claro.
    requireTLS: !smtp.secure,
    ...(smtp.user && { auth: { user: smtp.user, pass: smtp.password } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/**
 * Adaptador de PRODUCCIÓN (§84, ADR 0021): envía por SMTP, válido para cualquier proveedor que lo
 * ofrezca. Igual que el de desarrollo, nunca registra el cuerpo (puede contener enlaces con tokens).
 */
@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    const smtp = config.mail.smtp;
    if (!smtp) throw new Error('SmtpMailService requiere SMTP_HOST y MAIL_FROM.');
    this.transporter = createTransport(smtpTransportOptions(smtp));
    this.from = smtp.from;
  }

  override async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    this.logger.log(`Correo enviado (${message.subject})`);
  }
}
