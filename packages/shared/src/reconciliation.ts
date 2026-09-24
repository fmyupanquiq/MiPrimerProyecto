import { z } from 'zod';
import { moneyInputSchema, type MoneyString } from './money.js';

/**
 * Conciliación (§32, §80, §109.1). Un checkpoint es un registro histórico de comparación, nunca
 * un ajuste financiero (D-C1): no modifica saldos, no crea movimientos, no corrige datos. Se
 * registra tanto si coincide (`MATCHED`) como si no (`DISCREPANCY`); `INVALIDATED` lo aplica el
 * sistema después (§109.1.3), nunca quien concilia.
 */
export const RECONCILIATION_STATUSES = ['MATCHED', 'DISCREPANCY', 'INVALIDATED'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

const NOTE_MAX_LENGTH = 500;

/** Declara el saldo disponible oficial de la casa en este instante (D-C1, D-C2: un solo paso). */
export const confirmReconciliationSchema = z.object({
  officialAvailable: moneyInputSchema(),
  note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
});
export type ConfirmReconciliationInput = z.infer<typeof confirmReconciliationSchema>;

export interface ReconciliationCheckpointSummary {
  id: string;
  projectId: string;
  houseId: string;
  houseName: string;
  occurredAt: string;
  /** `available` calculado por LetFer en ese instante (D3), igual que en el resto de la app. */
  letferAvailable: MoneyString;
  officialAvailable: MoneyString;
  /** Diagnóstico: no participa en la comparación (D-C3, §80). */
  committed: MoneyString;
  /** `officialAvailable - letferAvailable`. */
  difference: MoneyString;
  status: ReconciliationStatus;
  performedBy: { id: string; name: string };
  note: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  createdAt: string;
}

/** `GET .../reconciliations/status`: última fotografía válida y si hace falta una nueva. */
export interface ReconciliationHouseStatus {
  houseId: string;
  /** Derivado en vivo (§109.1.3): sin `MATCHED` no invalidado, o el más reciente lo está. */
  requiresReconciliation: boolean;
  lastMatchedCheckpoint: ReconciliationCheckpointSummary | null;
}

/** `GET .../reconciliations/review` ("Revisar desde última conciliación", §32.2). */
export interface ReconciliationReviewBet {
  id: string;
  betType: string;
  status: string;
  placedAt: string;
  settledAt: string | null;
  effectiveAmount: MoneyString;
  profitLoss: MoneyString | null;
}
export interface ReconciliationReviewMovement {
  id: string;
  type: string;
  direction: string | null;
  amount: MoneyString;
  occurredAt: string;
}
export interface ReconciliationReview {
  /** `null` si nunca hubo un checkpoint `MATCHED` no invalidado para esta casa. */
  since: string | null;
  bets: ReconciliationReviewBet[];
  movements: ReconciliationReviewMovement[];
}
