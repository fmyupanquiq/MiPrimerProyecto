import { z } from 'zod';
import { moneyInputSchema, type MoneyString } from './money.js';

/**
 * Ciclo de vida de una solicitud de retiro (§79, D5). Solo al aprobarse genera el movimiento
 * definitivo en el ledger; rechazar o cancelar libera la reserva sin dejar rastro financiero.
 */
export const WITHDRAWAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

const REASON_MAX_LENGTH = 500;

/** Solicita un retiro (§16.2): reserva el monto de inmediato y exige motivo. */
export const requestWithdrawalSchema = z.object({
  houseId: z.uuid(),
  amount: moneyInputSchema({ positive: true }),
  reason: z.string().trim().min(1).max(REASON_MAX_LENGTH),
});
export type RequestWithdrawalInput = z.infer<typeof requestWithdrawalSchema>;

/** `version` es la de la solicitud leída por el cliente (control de concurrencia optimista, §96). */
export const decideWithdrawalSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
});
export type DecideWithdrawalInput = z.infer<typeof decideWithdrawalSchema>;

export interface WithdrawalRequestSummary {
  id: string;
  projectId: string;
  stageId: string;
  houseId: string;
  houseName: string;
  amount: MoneyString;
  reason: string;
  status: WithdrawalStatus;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** Solo cuando `status` es `APPROVED`: el movimiento definitivo que generó. */
  movementId: string | null;
  version: number;
}
