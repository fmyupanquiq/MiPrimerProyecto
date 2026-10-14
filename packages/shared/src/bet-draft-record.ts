import { z } from 'zod';
import { BET_TYPES, TOTAL_ODDS_SOURCES } from './bet.js';

/*
 * Borradores de "Añadir apuesta" (ADR 0024). Un borrador es el estado del formulario guardado para
 * retomarlo: NO es una apuesta, no crea movimientos, no reserva saldo y no figura en ningún informe.
 * El contenido son los textos tal como están en el formulario (cadenas), nunca cifras ya
 * interpretadas: al registrar, la apuesta se valida desde cero con `createBetSchema`.
 */

const text = (max: number) => z.string().max(max);
const dateTimeParts = z.object({ date: text(10), time: text(5) });
const visibleResult = z.enum(['', 'WON', 'LOST', 'VOID', 'PENDING']);

export const BET_DRAFT_MAX_SELECTIONS = 60;

/** Origen del registro en "Añadir apuesta": ticket leído con IA o datos introducidos a mano. */
export const BET_ENTRY_MODES = ['AI', 'MANUAL'] as const;
export type BetEntryMode = (typeof BET_ENTRY_MODES)[number];
export const BET_DRAFT_SUMMARY_MAX_LENGTH = 200;

export const betDraftSelectionSchema = z.object({
  eventGroup: z.number().int().min(0).max(100),
  position: z.number().int().min(0).max(20),
  sport: text(100),
  event: text(500),
  market: text(500),
  selection: text(500),
  visibleOdds: text(20),
  legScore: text(30),
  legResult: visibleResult,
  conditionStatus: visibleResult,
});

export const betDraftPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  format: z.enum(BET_TYPES),
  houseId: text(40),
  placed: dateTimeParts,
  placedTimeKnown: z.boolean(),
  selections: z.array(betDraftSelectionSchema).min(1).max(BET_DRAFT_MAX_SELECTIONS),
  totalOdds: text(20),
  oddsKindChoice: z
    .enum(TOTAL_ODDS_SOURCES.filter((s) => s !== 'UNKNOWN') as ['OFFICIAL', 'CALCULATED'])
    .nullable(),
  calculatedOdds: z.object({ value: text(20), note: text(600) }).nullable(),
  stake: text(20),
  customStake: z.boolean(),
  status: z.enum(['PENDING', 'WON', 'LOST', 'VOID', 'CASHOUT']),
  statusChosen: z.boolean(),
  /** El resultado vino de una lectura de IA (nunca se afirma "detectado por IA" si lo escribió la persona). */
  statusFromAi: z.boolean(),
  settled: dateTimeParts,
  profitOverride: text(20).nullable(),
  officialAmount: text(20),
  officialPotentialReturn: text(20),
  reason: text(1000),
  /** Ticket ya subido (sin vincular a ninguna apuesta todavía). */
  ticketId: z.uuid().nullable(),
  /** Hubo una lectura de IA aplicada al formulario. */
  aiApplied: z.boolean(),
  /**
   * Origen elegido en el Paso 1 del asistente: ticket leído con IA o registro manual. Opcional para
   * que los borradores guardados antes de existir sigan siendo válidos (se deduce con
   * `draftEntryMode`). No tiene ningún efecto financiero.
   */
  entryMode: z.enum(BET_ENTRY_MODES).optional(),
});
export type BetDraftPayload = z.infer<typeof betDraftPayloadSchema>;

/**
 * Origen de un borrador: el guardado o, en un borrador anterior a `entryMode`, el deducido de lo que
 * contiene (una lectura de IA aplicada o un ticket adjunto lo hacen "con IA"; si no, manual).
 */
export function draftEntryMode(
  payload: Pick<BetDraftPayload, 'entryMode' | 'aiApplied' | 'ticketId'>,
): BetEntryMode {
  if (payload.entryMode) return payload.entryMode;
  return payload.aiApplied || payload.ticketId !== null ? 'AI' : 'MANUAL';
}

export const saveBetDraftSchema = z.object({
  payload: betDraftPayloadSchema,
  /** Texto corto para la lista ("Betano · Liverpool FC - Manchester City…"); lo arma el cliente. */
  summary: text(BET_DRAFT_SUMMARY_MAX_LENGTH).default(''),
});
export type SaveBetDraftInput = z.infer<typeof saveBetDraftSchema>;

export const updateBetDraftSchema = saveBetDraftSchema.extend({
  /** Versión leída por el cliente (control de concurrencia optimista). */
  version: z.number().int().positive(),
});
export type UpdateBetDraftInput = z.infer<typeof updateBetDraftSchema>;

export interface BetDraftSummary {
  id: string;
  summary: string;
  ticketId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface BetDraftDetail extends BetDraftSummary {
  payload: BetDraftPayload;
}
