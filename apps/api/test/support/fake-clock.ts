import { Clock } from '../../src/common/clock.js';

/** Reloj controlable para probar expiraciones, bloqueos y ventanas sin esperar. */
export class FakeClock extends Clock {
  private current: Date;

  constructor(start: Date | string = '2026-06-01T12:00:00.000Z') {
    super();
    this.current = new Date(start);
  }

  override now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }
}
