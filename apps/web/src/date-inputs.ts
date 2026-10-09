import { zonedInstant, zonedParts } from './time-zone.js';

/**
 * Valores de los campos de fecha y hora de los formularios (convención de la Fase 10.3):
 *
 * - **Crear** un registro o ejecutar una **operación** que ocurre ahora: el campo empieza con el
 *   momento actual (`nowLocalInput`, `nowDateTimeParts`) y sigue siendo editable.
 * - **Editar** un registro existente: el campo empieza con el valor guardado (`toLocalInput`,
 *   `toDateTimeParts`), nunca con la hora actual.
 *
 * Zona horaria (§93, H-20): fecha y hora se leen y se escriben en la **zona del proyecto** (la de
 * presentación, `time-zone.ts`), no en la del navegador. Así lo que se ve en la lista, lo que se
 * escribe en el formulario y lo que la API agrupa por día coinciden siempre.
 */

/** Fecha y hora por separado, en el formato de `<input type="date">` y `<input type="time">`. */
export interface DateTimeParts {
  date: string; // AAAA-MM-DD
  time: string; // HH:mm
}

/** `datetime-local` (zona del proyecto) a partir de un instante ISO; vacío si no hay valor. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const { date, time } = zonedParts(new Date(iso));
  return `${date}T${time}`;
}

/** `datetime-local` con el momento actual. */
export const nowLocalInput = (): string => toLocalInput(new Date().toISOString());

/** Instante ISO a partir de un valor `datetime-local` (zona del proyecto); `null` si no es válido. */
export function fromLocalInput(value: string): string | null {
  const [date = '', time = ''] = value.split('T');
  return zonedInstant(date, time)?.toISOString() ?? null;
}

/** Fecha y hora guardadas (edición); vacías si no hay valor. */
export function toDateTimeParts(iso: string | null): DateTimeParts {
  return iso ? zonedParts(new Date(iso)) : { date: '', time: '' };
}

/** Fecha y hora actuales (creación u operación). */
export const nowDateTimeParts = (): DateTimeParts => zonedParts(new Date());

/** Instante ISO a partir de una fecha y una hora del proyecto; `null` si falta alguna o no es válida. */
export function fromDateTimeParts({ date, time }: DateTimeParts): string | null {
  if (date === '' || time === '') return null;
  return zonedInstant(date, time)?.toISOString() ?? null;
}

/** Primer instante del día `date` (`AAAA-MM-DD`) del proyecto: filtros "Desde". */
export const startOfDayInstant = (date: string): string | undefined =>
  zonedInstant(date, '00:00:00.000')?.toISOString();

/** Último instante del día `date` (`AAAA-MM-DD`) del proyecto: filtros "Hasta". */
export const endOfDayInstant = (date: string): string | undefined =>
  zonedInstant(date, '23:59:59.999')?.toISOString();

/** Día (`AAAA-MM-DD`) del proyecto al que pertenece un instante ISO; vacío si no hay valor. */
export const dayOfInstant = (iso: string | undefined): string =>
  iso ? zonedParts(new Date(iso)).date : '';
