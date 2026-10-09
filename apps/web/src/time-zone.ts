/**
 * Zona horaria de presentación (§93, ADR 0005; H-20 de la Fase 10): los instantes se guardan en
 * UTC y se **presentan en la zona del proyecto**. Lo mismo hace la API para el límite diario
 * (§88), la agrupación por periodo del dashboard (§108.7) y las fechas de una importación
 * (§113.4). Fuera de un proyecto (cuenta, administración) no hay zona de proyecto: se usa la del
 * navegador.
 *
 * `ProjectLayout` fija la zona al cargar el proyecto y `AppShell` la devuelve a la del navegador
 * fuera de él; formatear y convertir fechas lee siempre esta zona, así ningún componente tiene que
 * recibirla por props. Misma técnica que `apps/api/src/common/timezone.ts`, sin librerías.
 */

let displayTimeZone: string | undefined;

/** Fija la zona de presentación (la del proyecto) o vuelve a la del navegador (`undefined`). */
export function setDisplayTimeZone(timeZone: string | undefined): void {
  displayTimeZone = timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;
}

/** Zona en la que se presentan y se escriben las fechas ahora mismo (`undefined` = navegador). */
export function getDisplayTimeZone(): string | undefined {
  return displayTimeZone;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

interface ClockReading {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Lo que marca el reloj de `timeZone` en `instant`. */
function readClock(instant: number, timeZone: string | undefined): ClockReading {
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
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
  };
}

/** Desfase de `timeZone` respecto de UTC en `instant`, en milisegundos. */
function offsetAt(instant: number, timeZone: string | undefined): number {
  const r = readClock(instant, timeZone);
  const readAsUtc = Date.UTC(r.year, r.month - 1, r.day, r.hour, r.minute, r.second);
  return readAsUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/** Fecha (`AAAA-MM-DD`) y hora (`HH:mm`) de `instant` en la zona indicada. */
export function zonedParts(
  instant: Date,
  timeZone: string | undefined = displayTimeZone,
): { date: string; time: string } {
  const r = readClock(instant.getTime(), timeZone);
  return {
    date: `${pad(r.year, 4)}-${pad(r.month)}-${pad(r.day)}`,
    time: `${pad(r.hour)}:${pad(r.minute)}`,
  };
}

/**
 * Instante que corresponde a la fecha `date` (`AAAA-MM-DD`) y la hora `time` (`HH:mm`,
 * `HH:mm:ss` o `HH:mm:ss.SSS`) leídas en la zona indicada; `null` si no son válidas. Dos pasadas
 * para acertar también en los días de cambio de horario.
 */
export function zonedInstant(
  date: string,
  time: string,
  timeZone: string | undefined = displayTimeZone,
): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute, second] = [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)];
  const ms = Number((t[4] ?? '0').padEnd(3, '0'));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // La fecha debe existir tal cual (p. ej. no 31 de febrero).
  const check = new Date(naive);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  let instant = naive - offsetAt(naive, timeZone);
  instant = naive - offsetAt(instant, timeZone);
  return new Date(instant);
}

/** Fecha de hoy (`AAAA-MM-DD`) en la zona indicada. */
export const todayInZone = (timeZone: string | undefined = displayTimeZone): string =>
  zonedParts(new Date(), timeZone).date;

/** Suma `days` días a una fecha calendario `AAAA-MM-DD` (sin horas de por medio). */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
