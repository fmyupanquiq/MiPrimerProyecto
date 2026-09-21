import { Global, Module } from '@nestjs/common';
import { FileOutboxMailService, MailService } from './mail.service.js';

@Global()
@Module({
  providers: [{ provide: MailService, useClass: FileOutboxMailService }],
  exports: [MailService],
})
export class MailModule {}
