import { Decimal } from 'decimal.js';
import { z } from 'zod';
import type { BetCorrectionKind } from './bet-correction.js';
import type { MovementType } from './financial-movement.js';
import { moneyInputSchema, type MoneyString } from './money.js';
import { oddsInputSchema, type OddsString } from './odds.js';
import type { TicketSummary } from './ticket.js';

/** Clasificación de una apuesta, derivada de su estructura real (§20, §90). */
export const BET_TYPES = ['SIMPLE', 'CREATED', 'MULTIPLE'] as const;
export type BetType = (typeof BET_TYPES)[number];

/**
 * Estados de liquidación (§21, §78, §107.2). `VOID` cubre tanto "Anulada" como "Cancelada"
 * (D-B1): financieramente son la misma cosa, una apuesta inválida sin ganancia ni pérdida.
 */
export const BET_STATUSES = ['PENDING', 'WON', 'LOST', 'VOID', 'CASHOUT'] as const;
export type BetStatus = (typeof BET_STATUSES)[number];

/** Filtro de listado: los estados reales más `TRASHED` (papelera; no es un `BetStatus`). */
export const BET_LIST_STATUSES = [...BET_STATUSES, 'TRASHED'] as const;
export type BetListStatus = (typeof BET_LIST_STATUSES)[number];

/** Límites operativos del Colaborador en la papelera (§26, §88, D-B6): sin tabla de contadores. */
export const BET_TRASH_LIMITS = { maxPerBulkAction: 5, maxPerDay: 10 } as const;

const STAKE_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;
const StakeDecimal = Decimal.clone({ precision: 40 });

/** El stake es un multiplicador numérico, nunca un porcentaje (regla crítica 1, §12). */
export function isStakeString(value: string): boolean {
  if (!STAKE_PATTERN.test(value)) return false;
  try {
    // `Decimal.isPositive()` de decimal.js es "no negativo" (`true` para 0): hay que
    // descartar el cero explícitamente (mismo cuidado que `isPositiveMoney` en `money.ts`).
    const decimal = new StakeDecimal(value);
    return decimal.isPositive() && !decimal.isZero();
  } catch {
    return false;
  }
}

const stakeInputSchema = z.string().trim().refine(isStakeString, {
  message: 'Ingresa un stake válido, mayor que cero (hasta 4 decimales).',
});

const REASON_MAX_LENGTH = 500;
const TEXT_MAX_LENGTH = 200;
const SPORT_MAX_LENGTH = 100;

const selectionInputSchema = z.object({
  /** Selecciones con el mismo `eventGroup` pertenecen al mismo evento (§19, §20, D-B3). */
  eventGroup: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  sport: z.string().trim().max(SPORT_MAX_LENGTH).optional(),
  event: z.string().trim().min(1).max(TEXT_MAX_LENGTH),
  market: z.string().trim().max(TEXT_MAX_LENGTH).optional(),
  selection: z.string().trim().min(1).max(TEXT_MAX_LENGTH),
  visibleOdds: oddsInputSchema(),
});
export type BetSelectionInput = z.infer<typeof selectionInputSchema>;

const dateTimeSchema = z.iso.datetime({ offset: true });

/**
 * Registra una apuesta manual (§18-§20). `stageId` es opcional: si falta, se usa la etapa activa
 * del proyecto (§93). El backend deriva/valida `betType` a partir de la estructura real de
 * `selections` (§90); no se confía en lo que declare el cliente.
 */
export const createBetSchema = z.object({
  houseId: z.uuid(),
  stageId: z.uuid().optional(),
  stake: stakeInputSchema,
  /** Monto oficial confirmado (ticket/casa); si falta, se calcula `stake × unidad` (§76). */
  officialAmount: moneyInputSchema({ positive: true }).optional(),
  visibleTotalOdds: oddsInputSchema(),
  officialPotentialReturn: moneyInputSchema().optional(),
  placedAt: dateTimeSchema,
  /** `false` si solo se conoce la fecha, no la hora exacta (§93, D-B4). */
  placedTimeKnown: z.boolean().default(true),
  reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
  selections: z.array(selectionInputSchema).min(1),
  /**
   * Vincula un ticket ya subido (§110.3): el backend comprueba que exista, pertenezca al
   * proyecto y no esté ya vinculado a otra apuesta, dentro de la misma transacción — nunca un
   * segundo flujo de escritura para tickets/IA (§51).
   */
  ticketId: z.uuid().optional(),
});
export type CreateBetInput = z.infer<typeof createBetSchema>;

/**
 * Edita una apuesta (§24). El backend decide qué campos son editables según su estado: una
 * apuesta `PENDING` admite todo; una ya liquidada, solo los campos no financieros (§107.9).
 */
export const updateBetSchema = createBetSchema
  .partial()
  .extend({ version: z.number().int().positive() });
export type UpdateBetInput = z.infer<typeof updateBetSchema>;

/**
 * Liquida una apuesta pendiente (§21, §77, §78, §112.2). El retorno depende del estado:
 * - `WON`: `officialRealizedReturn` es opcional; sin él se liquida con un retorno **calculado no
 *   confirmado** (`monto × cuota visible`) que luego se confirma con `confirm-return`.
 * - `VOID`: opcional; sin él, el retorno es el monto y queda confirmado (§21.4).
 * - `CASHOUT`: obligatorio (no hay manera de calcularlo).
 * - `LOST`: no lleva retorno (D-B2: se determina por su ausencia).
 * `officialAmount` confirma el monto en el mismo paso si aún no era oficial (§76).
 */
export const settleBetSchema = z
  .object({
    status: z.enum(['WON', 'LOST', 'VOID', 'CASHOUT']),
    officialRealizedReturn: moneyInputSchema().optional(),
    officialAmount: moneyInputSchema({ positive: true }).optional(),
    settledAt: dateTimeSchema,
    settledTimeKnown: z.boolean().default(true),
    version: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'LOST') {
      if (value.officialRealizedReturn !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['officialRealizedReturn'],
          message: 'Una apuesta perdida no tiene retorno: no indiques un monto.',
        });
      }
      return;
    }
    if (value.status === 'CASHOUT' && value.officialRealizedReturn === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['officialRealizedReturn'],
        message: 'Un cash out exige el retorno oficial realizado.',
      });
    }
  });
export type SettleBetInput = z.infer<typeof settleBetSchema>;

/**
 * Confirma el retorno oficial de una apuesta ganada liquidada con retorno calculado (§77, §112.2).
 * Si difiere del calculado, la API responde 409 `RETURN_MISMATCH` hasta que llegue
 * `acknowledgeDifference: true`, que además exige reautenticación reciente (D-A12).
 */
export const confirmBetReturnSchema = z.object({
  officialRealizedReturn: moneyInputSchema({ positive: true }),
  acknowledgeDifference: z.boolean().default(false),
  reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
  version: z.number().int().positive(),
});
export type ConfirmBetReturnInput = z.infer<typeof confirmBetReturnSchema>;

/** Detalle de un 409 `RETURN_MISMATCH`: los tres valores que la persona debe ver antes de confirmar. */
export interface ReturnMismatchDetails {
  calculated: MoneyString;
  official: MoneyString;
  /** `official − calculated`. */
  delta: MoneyString;
}

const requiredReasonSchema = z.string().trim().min(1, 'Indica el motivo.').max(REASON_MAX_LENGTH);

/**
 * Corrige una apuesta ya liquidada (§112.3, D-A8): estado, monto oficial, retorno oficial y fechas.
 * Reescribe su efecto en el ledger con reversiones. Motivo obligatorio, versión y reautenticación.
 * Cambiar de casa, etapa, selecciones o cuota se hace reabriéndola. El retorno no se indica en una
 * perdida; en un cash out debe existir (el actual o el indicado).
 */
export const correctSettlementSchema = z
  .object({
    status: z.enum(['WON', 'LOST', 'VOID', 'CASHOUT']).optional(),
    officialAmount: moneyInputSchema({ positive: true }).optional(),
    officialRealizedReturn: moneyInputSchema().optional(),
    settledAt: dateTimeSchema.optional(),
    settledTimeKnown: z.boolean().optional(),
    placedAt: dateTimeSchema.optional(),
    placedTimeKnown: z.boolean().optional(),
    reason: requiredReasonSchema,
    version: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    const changes = [
      value.status,
      value.officialAmount,
      value.officialRealizedReturn,
      value.settledAt,
      value.settledTimeKnown,
      value.placedAt,
      value.placedTimeKnown,
    ];
    if (changes.every((entry) => entry === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Indica al menos un cambio.' });
    }
    if (value.status === 'LOST' && value.officialRealizedReturn !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['officialRealizedReturn'],
        message: 'Una apuesta perdida no tiene retorno: no indiques un monto.',
      });
    }
  });
export type CorrectSettlementInput = z.infer<typeof correctSettlementSchema>;

/** Reabre una apuesta liquidada a `PENDING` (D-A4): revierte su efecto en el ledger. */
export const reopenBetSchema = z.object({
  reason: requiredReasonSchema,
  version: z.number().int().positive(),
});
export type ReopenBetInput = z.infer<typeof reopenBetSchema>;

/**
 * Restaura una apuesta de la papelera (§26). El motivo es obligatorio solo si estaba liquidada
 * (D-A11): el servidor lo exige; una pendiente lo ignora.
 */
export const restoreBetSchema = z.preprocess(
  (value) => value ?? {},
  z.object({ reason: z.string().trim().max(REASON_MAX_LENGTH).optional() }),
);
export type RestoreBetInput = { reason?: string | undefined };

/** Mueve una apuesta a otra etapa del proyecto (§25: solo administradores autorizados). */
export const moveBetStageSchema = z.object({
  stageId: z.uuid(),
  version: z.number().int().positive(),
});
export type MoveBetStageInput = z.infer<typeof moveBetStageSchema>;

/** Envía una apuesta a la papelera (§26); el motivo es opcional. */
export const trashBetSchema = z.object({
  reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
});
export type TrashBetInput = z.infer<typeof trashBetSchema>;

/** Filtros de listado: sin ninguno, todo lo visible salvo la papelera. */
export const listBetsQuerySchema = z.object({
  stageId: z.uuid().optional(),
  houseId: z.uuid().optional(),
  status: z.enum(BET_LIST_STATUSES).optional(),
});
export type ListBetsQuery = z.infer<typeof listBetsQuerySchema>;

export interface BetSelectionSummary {
  id: string;
  eventGroup: number;
  position: number;
  sport: string | null;
  event: string;
  market: string | null;
  selection: string;
  visibleOdds: OddsString;
}

/**
 * Fuente del monto efectivo (§76): `CONFIRMED` solo cuando un ticket, la casa o una persona lo
 * confirmó (`amount_confirmed`); `CALCULATED` cuando lo derivó LetFer (`stake × unidad`), aunque
 * quedara congelado en `official_amount` al liquidar. Nunca es una "aceptación" del cálculo.
 */
export type AmountSource = 'CALCULATED' | 'CONFIRMED';

/**
 * Fuente del retorno efectivo (§77, §112.2): `OFFICIAL` cuando hay retorno oficial; `CALCULATED`
 * cuando solo hay el calculado no confirmado (ganada provisional); `null` si no hay retorno
 * (pendiente o perdida).
 */
export type ReturnSource = 'OFFICIAL' | 'CALCULATED';

export interface BetSummary {
  id: string;
  projectId: string;
  stageId: string;
  stageName: string;
  houseId: string;
  houseName: string;
  betType: BetType;
  stake: string;
  officialAmount: MoneyString | null;
  /** `officialAmount` si existe; si no, `stake × unidad` de la etapa (§76). Calculado, no guardado. */
  effectiveAmount: MoneyString;
  amountSource: AmountSource;
  visibleTotalOdds: OddsString;
  officialPotentialReturn: MoneyString | null;
  officialRealizedReturn: MoneyString | null;
  /** Retorno calculado no confirmado (`monto × cuota visible`); solo en una ganada (§112.2). */
  calculatedRealizedReturn: MoneyString | null;
  /** Retorno efectivo: el oficial si existe; si no, el calculado (§107.5). */
  effectiveReturn: MoneyString | null;
  returnSource: ReturnSource | null;
  /** `retorno efectivo ÷ monto efectivo`; solo cuando hay un retorno positivo conocido (§22). */
  effectiveOdds: OddsString | null;
  /**
   * `null` mientras está `PENDING`; en los demás casos, ganancia/pérdida derivada (§107.5) con el
   * retorno efectivo: si `returnSource` es `CALCULATED`, es provisional.
   */
  profitLoss: MoneyString | null;
  status: BetStatus;
  placedAt: string;
  placedTimeKnown: boolean;
  settledAt: string | null;
  settledTimeKnown: boolean;
  reason: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeEligibleAt: string | null;
  version: number;
}

export interface BetDetail extends BetSummary {
  selections: BetSelectionSummary[];
  /** Tickets vinculados a esta apuesta (§110), más recientes primero. */
  tickets: TicketSummary[];
}

/** Una ganada cuyo retorno oficial aún no se ha confirmado (§77, §112.2). */
export interface UnconfirmedReturnItem {
  betId: string;
  houseName: string;
  stageName: string;
  settledAt: string;
  effectiveAmount: MoneyString;
  calculatedRealizedReturn: MoneyString;
  /** Ganancia provisional (retorno calculado − monto). */
  provisionalProfit: MoneyString;
}

/** Una ganada con retorno calculado y oficial, para comparar ambos (§77, evidencia de D-B8). */
export interface ReturnDifferenceItem {
  betId: string;
  houseId: string;
  houseName: string;
  betType: BetType;
  settledAt: string;
  effectiveAmount: MoneyString;
  visibleTotalOdds: OddsString;
  calculatedRealizedReturn: MoneyString;
  officialRealizedReturn: MoneyString;
  /** `oficial − calculado`. */
  delta: MoneyString;
}

export interface ReturnDifferencesByHouse {
  houseId: string;
  houseName: string;
  compared: number;
  differing: number;
  totalDelta: MoneyString;
}

/**
 * Comparación de retornos calculados y oficiales de las apuestas ganadas del proyecto. Reúne la
 * evidencia para decidir la política de redondeo (D-B8) sin decidirla.
 */
export interface ReturnDifferencesReport {
  compared: number;
  differing: number;
  totalDelta: MoneyString;
  byHouse: ReturnDifferencesByHouse[];
  /** Solo las que difieren, las más recientes primero (máximo 200). */
  items: ReturnDifferenceItem[];
}

/** Una fila del ledger que una corrección escribiría (o revertiría). */
export interface CorrectionLine {
  type: 'BET_PLACEMENT' | 'BET_SETTLEMENT' | 'REVERSAL';
  direction: 'CREDIT' | 'DEBIT';
  houseId: string;
  houseName: string;
  amount: MoneyString;
  /** Fecha efectiva; en una reversión, la de la fila que anula (D-A2). */
  occurredAt: string;
  /** Solo en una reversión: el tipo de la fila que anula. */
  reverses?: 'BET_PLACEMENT' | 'BET_SETTLEMENT';
}

export interface CorrectionBalanceImpact {
  houseId: string;
  houseName: string;
  balanceBefore: MoneyString;
  balanceAfter: MoneyString;
  availableBefore: MoneyString;
  availableAfter: MoneyString;
}

export interface CorrectionCheckpointImpact {
  id: string;
  houseId: string;
  houseName: string;
  occurredAt: string;
}

/** Un saldo bruto negativo que la corrección provocaría en el historial (§74, D-A5). */
export interface CorrectionConflictInfo {
  houseId: string;
  houseName: string;
  occurredAt: string;
  balance: MoneyString;
  /** Filas reales del ledger que actúan en ese instante. */
  movementIds: string[];
  /** Apuestas o retiros pendientes cuya reserva pesa en ese instante (comprometido histórico). */
  pendingIds: string[];
}

/**
 * Vista previa de una corrección, sin efectos (§112.3): el mismo código que la aplica, ejecutado y
 * revertido. `valid` es falso si la corrección se rechazaría (`conflicts` o `availabilityProblems`).
 */
export interface CorrectionPreview {
  kind: BetCorrectionKind;
  valid: boolean;
  /** `false` si el ledger ya refleja el efecto deseado (no habría filas nuevas). */
  ledgerChanged: boolean;
  reversals: CorrectionLine[];
  inserts: CorrectionLine[];
  balances: CorrectionBalanceImpact[];
  checkpointsToInvalidate: CorrectionCheckpointImpact[];
  conflicts: CorrectionConflictInfo[];
  availabilityProblems: { houseId: string; houseName: string; available: MoneyString }[];
  profitLossBefore: MoneyString | null;
  profitLossAfter: MoneyString | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface BetLedgerEntry {
  id: string;
  type: MovementType;
  direction: 'CREDIT' | 'DEBIT' | null;
  houseId: string | null;
  houseName: string | null;
  amount: MoneyString;
  occurredAt: string;
  createdAt: string;
  reversesMovementId: string | null;
  correctionId: string | null;
  /** `true` mientras ninguna reversión la haya anulado (las reversiones nunca son vigentes). */
  live: boolean;
}

export interface BetCorrectionEntry {
  id: string;
  kind: BetCorrectionKind;
  /** Campos financieros antes y después: aquí se conserva el retorno calculado y el oficial previos. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

/** Historial financiero de una apuesta: filas del ledger (con reversiones) y correcciones. */
export interface BetLedgerHistory {
  movements: BetLedgerEntry[];
  corrections: BetCorrectionEntry[];
}
