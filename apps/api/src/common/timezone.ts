/**
 * El límite diario de eliminaciones del Colaborador (§26, §88) se calcula con la zona horaria
 * configurada del proyecto (§93), no en UTC ni en la del servidor. Sin dependencia externa:
 * Node incluye soporte IANA en `Intl`.
 */

/**
 * Instante (en UTC) que corresponde a la medianoche del día de `instant`, en `timeZone`.
 *
 * Técnica estándar sin librería: se formatea `instant` en `timeZone` y esa misma lectura de
 * reloj se reinterpreta como si fuera UTC; la diferencia entre ambas es el desfase horario de
 * la zona en ese instante. Aplicar ese desfase a la medianoche (en la lectura local) da la
 * medianoche real expresada en UTC.
 */
export function startOfDayInTimeZone(instant: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  const year = Number(parts['year']);
  const month = Number(parts['month']);
  const day = Number(parts['day']);
  const readAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  const offsetMs = readAsUtc - instant.getTime();
  const midnightReadAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  return new Date(midnightReadAsUtc - offsetMs);
}

/** Fecha calendario (`YYYY-MM-DD`) de `instant`, leída en `timeZone` (D-X10: "misma fecha"). */
export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(instant); // en-CA formatea como YYYY-MM-DD.
}

/**
 * Instante (en UTC) de las 12:00 del día calendario `year`-`month`-`day`, en `timeZone` (§113.4,
 * D-X23): el instante técnico de una importación cuando solo se conoce la fecha, nunca la hora.
 * No es el mismo cálculo que {@link startOfDayInTimeZone} al revés (esa parte de un instante ya
 * conocido; esta construye uno desde un día calendario que todavía no tiene hora ninguna), pero usa
 * la misma técnica: una conjetura en UTC y el desfase real de la zona en ese momento del año.
 */
export function noonInTimeZone(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(guess).map((p) => [p.type, p.value]));
  const readAsUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  const offsetMs = readAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}
