import type {
  TicketReader,
  TicketReaderInput,
  TicketReaderResult,
} from '../../src/ai/ticket-reader.js';

/**
 * `TicketReader` falso para pruebas (D-T1, ADR 0017): ninguna prueba debe llamar a la API real
 * de Anthropic (coste, red, no determinismo). Se sustituye por defecto en `createTestApp`, igual
 * que `Clock`/`MailService`; cada prueba puede encolar una respuesta concreta o forzar un fallo.
 */
export class FakeTicketReader implements TicketReader {
  private queue: TicketReaderResult[] = [];
  private nextError: string | undefined;
  calls: TicketReaderInput[] = [];

  /** La próxima llamada a `analyze()` devolverá este resultado (o uno por defecto si no hay ninguno). */
  enqueue(result: Partial<TicketReaderResult>): void {
    this.queue.push({
      provider: 'fake',
      model: 'fake-model',
      extraction: {},
      confidenceByField: null,
      ...result,
    });
  }

  /** La próxima llamada a `analyze()` lanzará, simulando un proveedor caído. */
  failNext(message = 'fallo simulado del proveedor de IA'): void {
    this.nextError = message;
  }

  analyze(input: TicketReaderInput): Promise<TicketReaderResult> {
    this.calls.push(input);
    if (this.nextError) {
      const message = this.nextError;
      this.nextError = undefined;
      return Promise.reject(new Error(message));
    }
    return Promise.resolve(
      this.queue.shift() ?? {
        provider: 'fake',
        model: 'fake-model',
        extraction: { house: 'Casa de prueba' },
        confidenceByField: { house: 0.9 },
      },
    );
  }

  reset(): void {
    this.queue = [];
    this.nextError = undefined;
    this.calls = [];
  }
}
