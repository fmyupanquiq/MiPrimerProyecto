import { MailService, type MailMessage } from '../../src/mail/mail.service.js';

/** Correo en memoria para las pruebas: guarda los mensajes en vez de enviarlos. */
export class InMemoryMailService extends MailService {
  readonly sent: MailMessage[] = [];
  /** Si es `true`, `send` falla (para comprobar que un error de correo no rompe la operación). */
  failing = false;

  override send(message: MailMessage): Promise<void> {
    if (this.failing) return Promise.reject(new Error('el proveedor de correo no responde'));
    this.sent.push(message);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
    this.failing = false;
  }
}
