/**
 * Tipos de corrección financiera de una apuesta (§112, ADR 0019). Cada corrección deja un
 * registro inmutable en `bet_corrections` con los valores anteriores y nuevos, quién la hizo y el
 * motivo.
 */
export const BET_CORRECTION_KINDS = [
  /** Confirmación del retorno oficial frente al calculado (§112.2). */
  'RETURN_CONFIRMATION',
  /** Corrección de estado, montos o fechas de una apuesta liquidada (§112.3). */
  'SETTLEMENT_CORRECTION',
  /** Reabrir una apuesta liquidada a `PENDING` (D-A4). */
  'REOPEN',
  /** Enviar a la papelera una apuesta liquidada: reversión completa (D-A7). */
  'TRASH_REVERSAL',
  /** Restaurar una apuesta liquidada de la papelera: re-registro (D-A7). */
  'RESTORE_REPOST',
] as const;
export type BetCorrectionKind = (typeof BET_CORRECTION_KINDS)[number];
