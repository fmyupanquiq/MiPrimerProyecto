import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { FileOutboxMailService, MailService } from './mail.service.js';
import { SmtpMailService } from './smtp-mail.service.js';

/** Con SMTP configurado (obligatorio en producción) se envía de verdad; si no, a la carpeta outbox. */
@Global()
@Module({
  providers: [
    {
      provide: MailService,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MailService =>
        config.mail.smtp ? new SmtpMailService(config) : new FileOutboxMailService(config),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
