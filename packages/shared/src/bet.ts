import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { moneyInputSchema, type MoneyString } from './money.js';
import { oddsInputSchema, type OddsString } from './odds.js';

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
 * Liquida una apuesta pendiente (§21, §77, §78). `officialRealizedReturn` es obligatorio salvo
 * en `LOST` (D-B2: una pérdida no tiene retorno, se determina por su ausencia).
 * `officialAmount` permite confirmar/corregir el monto en el mismo paso si aún no era oficial.
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
    if (value.officialRealizedReturn === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['officialRealizedReturn'],
        message: 'Indica el retorno oficial realizado.',
      });
    }
  });
export type SettleBetInput = z.infer<typeof settleBetSchema>;

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
 * Fuente del monto/retorno efectivos (§76, §77): `CONFIRMED` cuando hay un valor oficial;
 * `CALCULATED` cuando LetFer lo deriva (`stake × unidad`, o ausente mientras no se liquida).
 * Se deriva de los valores, nunca se guarda (D-B7).
 */
export type AmountSource = 'CALCULATED' | 'CONFIRMED';

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
  /** `retorno oficial ÷ monto efectivo`; solo cuando hay un retorno positivo conocido (§22). */
  effectiveOdds: OddsString | null;
  /** `null` mientras está `PENDING`; en los demás casos, ganancia/pérdida derivada (§107.5). */
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
}
