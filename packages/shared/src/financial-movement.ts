import { z } from 'zod';
import { moneyInputSchema, type MoneyString } from './money.js';

/** Tipos de movimiento del ledger unificado (§16, §72). */
export const MOVEMENT_TYPES = [
  'INITIAL_CAPITAL',
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'EXTRAORDINARY',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Sentido del efecto sobre el saldo de la casa. En capital inicial y depósitos siempre es
 * `CREDIT`; en retiros, siempre `DEBIT`; en extraordinarios lo decide quien lo registra
 * (§16.4: puede ser un cashback que suma o una comisión que resta). Las transferencias no
 * usan `direction`: su efecto lo define el par `fromHouseId`/`toHouseId`.
 */
export const MOVEMENT_DIRECTIONS = ['CREDIT', 'DEBIT'] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

const REASON_MAX_LENGTH = 500;
const reasonSchema = z.string().trim().min(1).max(REASON_MAX_LENGTH);
const optionalReasonSchema = z.string().trim().max(REASON_MAX_LENGTH).optional();

/** Registra un depósito (§16.1): dinero externo que entra al proyecto. */
export const createDepositSchema = z.object({
  houseId: z.uuid(),
  amount: moneyInputSchema({ positive: true }),
  reason: optionalReasonSchema,
});
export type CreateDepositInput = z.infer<typeof createDepositSchema>;

/** Registra una transferencia interna (§16.3): atómica, no altera el capital total. */
export const createTransferSchema = z
  .object({
    fromHouseId: z.uuid(),
    toHouseId: z.uuid(),
    amount: moneyInputSchema({ positive: true }),
    reason: optionalReasonSchema,
  })
  .refine((value) => value.fromHouseId !== value.toHouseId, {
    message: 'La casa de origen y la de destino deben ser distintas.',
    path: ['toHouseId'],
  });
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

/**
 * Registra un movimiento extraordinario real (§16.4): cashback, bonificación, comisión o
 * corrección oficial. Nunca es un "ajuste de saldo" genérico, por eso el motivo es obligatorio.
 */
export const createExtraordinaryMovementSchema = z.object({
  houseId: z.uuid(),
  amount: moneyInputSchema({ positive: true }),
  direction: z.enum(MOVEMENT_DIRECTIONS),
  reason: reasonSchema,
});
export type CreateExtraordinaryMovementInput = z.infer<typeof createExtraordinaryMovementSchema>;

export interface MovementSummary {
  id: string;
  operationId: string;
  projectId: string;
  stageId: string;
  type: MovementType;
  direction: MovementDirection | null;
  houseId: string | null;
  houseName: string | null;
  fromHouseId: string | null;
  fromHouseName: string | null;
  toHouseId: string | null;
  toHouseName: string | null;
  amount: MoneyString;
  reason: string | null;
  occurredAt: string;
  createdAt: string;
  createdBy: { id: string; name: string };
}
