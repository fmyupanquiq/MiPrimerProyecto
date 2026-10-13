import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { FileOutboxMailService, MailService, UnavailableMailService } from './mail.service.js';
import { SmtpMailService } from './smtp-mail.service.js';

/**
 * Con SMTP configurado se envía de verdad. Sin SMTP: en desarrollo, a la carpeta outbox; en
 * producción, el correo queda "no disponible" (nada se envía ni se simula).
 */
@Global()
@Module({
  providers: [
    {
      provide: MailService,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MailService =>
        config.mail.smtp
          ? new SmtpMailService(config)
          : config.nodeEnv === 'production'
            ? new UnavailableMailService()
            : new FileOutboxMailService(config),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
