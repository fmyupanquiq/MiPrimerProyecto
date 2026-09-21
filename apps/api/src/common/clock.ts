import { Injectable } from '@nestjs/common';

/**
 * Fuente de tiempo inyectable. Toda lógica que dependa del tiempo (expiración de sesiones,
 * bloqueos, tokens) usa `Clock` para poder probarse de forma determinista con un reloj falso.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }
}
