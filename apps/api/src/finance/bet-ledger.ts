import {
  ErrorCode,
  ZERO_MONEY,
  compareMoney,
  isPositiveMoney,
  multiplyMoney,
  subtractMoney,
  type BetCorrectionKind,
  type MoneyString,
} from '@letfer/shared';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error.js';
import type { DbExecutor } from '../database/database.types.js';
import {
  betCorrections,
  bets,
  financialMovements,
  stages,
  withdrawalRequests,
  type BetCorrectionRow,
  type BetRow,
  type FinancialMovementRow,
  type StageRow,
} from '../database/schema/index.js';
import { computeHouseBalances } from './balances.js';
import {
  newTimelineConflicts,
  type TimelineConflict,
  type TimelineEntry,
} from './bet-ledger-timeline.js';

/**
 * Motor de efecto financiero de una apuesta (§112.1, ADR 0019, D-A1, D-A2, D-A5).
 *
 * El ledger es inmutable (D2): cambiar el efecto de una apuesta no edita filas, sino que compara lo
 * que el ledger dice hoy (las filas vigentes, es decir, las que nadie ha revertido) con lo que
 * debería decir (el efecto deseado, calculado desde la apuesta) y escribe solo la diferencia:
 * una fila `REVERSAL` por cada fila vigente que ya no corresponde y una fila nueva por cada línea
 * deseada que aún no existe. Lo que ya coincide no se toca, así que una corrección sin cambio
 * financiero real no genera ninguna fila.
 *
 * Cada `REVERSAL` conserva la fecha efectiva de la fila que anula (D-A2): la serie histórica de
 * saldos queda verdadera; `created_at` dice cuándo se escribió la corrección.
 *
 * Uso: quien llama ya tiene la transacción y el bloqueo `finance:<proyecto>`; `planBetLedgerChange`
 * no escribe nada (sirve también para la vista previa) y `applyBetLedgerPlan` escribe el plan
 * validado. Tras actualizar la apuesta, `assertAvailableNotNegative` comprueba el disponible.
 */

export type BetLedgerLineType = 'BET_PLACEMENT' | 'BET_SETTLEMENT';

/** Una fila del ledger que el efecto deseado de la apuesta debería tener vigente. */
export interface BetLedgerLine {
  type: BetLedgerLineType;
  direction: 'CREDIT' | 'DEBIT';
  houseId: string;
  amount: MoneyString;
  occurredAt: Date;
}

/** Monto efectivo de una apuesta (§76): el oficial si existe; si no, `stake × unidad`. */
export const effectiveBetAmount = (bet: BetRow, stage: Pick<StageRow, 'unitStake'>): MoneyString =>
  bet.officialAmount ?? multiplyMoney(stage.unitStake, bet.stakeAmount);

/** Retorno efectivo (§107.5, §112.2): el oficial si existe; si no, el calculado no confirmado. */
export const effectiveBetReturn = (
  bet: Pick<BetRow, 'officialRealizedReturn' | 'calculatedRealizedReturn'>,
): MoneyString | null => bet.officialRealizedReturn ?? bet.calculatedRealizedReturn ?? null;

/**
 * Ganancia o pérdida derivada (§107.5): `null` si está pendiente, en la papelera o sin retorno
 * conocido; una perdida es `−monto`; el resto, `retorno efectivo − monto`. Es lo que el dashboard
 * suma y lo que el efecto neto de la apuesta en el ledger debe igualar (§112.6).
 */
export function derivedProfitLoss(
  bet: BetRow,
  stage: Pick<StageRow, 'unitStake'>,
): MoneyString | null {
  if (bet.status === 'PENDING' || bet.deletedAt !== null) return null;
  const amount = effectiveBetAmount(bet, stage);
  if (bet.status === 'LOST') return subtractMoney(ZERO_MONEY, amount);
  const realized = effectiveBetReturn(bet);
  return realized === null ? null : subtractMoney(realized, amount);
}

/**
 * Efecto que el ledger debe tener para la apuesta (§107.2, §107.3, D-B2): ninguno mientras está
 * `PENDING` o en la papelera; colocación (débito) al liquidar, y liquidación (crédito) solo con
 * retorno positivo (una perdida no genera fila de liquidación).
 */
export function desiredBetLedgerLines(
  bet: BetRow,
  stage: Pick<StageRow, 'unitStake'>,
): BetLedgerLine[] {
  if (bet.status === 'PENDING' || bet.deletedAt !== null || bet.settledAt === null) return [];
  const lines: BetLedgerLine[] = [
    {
      type: 'BET_PLACEMENT',
      direction: 'DEBIT',
      houseId: bet.houseId,
      amount: effectiveBetAmount(bet, stage),
      occurredAt: bet.placedAt,
    },
  ];
  const realized = bet.status === 'LOST' ? null : effectiveBetReturn(bet);
  if (realized !== null && isPositiveMoney(realized)) {
    lines.push({
      type: 'BET_SETTLEMENT',
      direction: 'CREDIT',
      houseId: bet.houseId,
      amount: realized,
      occurredAt: bet.settledAt,
    });
  }
  return lines;
}

/**
 * Reserva histórica de una apuesta pendiente (D-A5, comprometido histórico). El comprometido no
 * tiene línea temporal propia: se calcula en vivo. Para validar el pasado, una apuesta pendiente se
 * modela como un débito desde su fecha de colocación (la reserva que ya ocupaba), igual que su
 * `BET_PLACEMENT` cuando se liquida; así reabrirla o restaurarla no "libera" retroactivamente un
 * dinero que estaba comprometido cuando se hicieron los retiros posteriores.
 */
export interface BetHold {
  houseId: string;
  amount: MoneyString;
  occurredAt: Date;
}

/** Reserva que una apuesta ocupa en su estado actual: solo si está pendiente y no en la papelera. */
export function betHold(bet: BetRow, stage: Pick<StageRow, 'unitStake'>): BetHold | null {
  if (bet.status !== 'PENDING' || bet.deletedAt !== null) return null;
  return {
    houseId: bet.houseId,
    amount: effectiveBetAmount(bet, stage),
    occurredAt: bet.placedAt,
  };
}

const holdEntry = (id: string, hold: BetHold): TimelineEntry => ({
  id,
  occurredAt: hold.occurredAt,
  effects: [{ houseId: hold.houseId, direction: 'DEBIT', amount: hold.amount }],
});

/** Campos financieros de la apuesta para `bet_corrections.before`/`after` y la auditoría. */
export function betFinancialSnapshot(bet: BetRow): Record<string, unknown> {
  return {
    houseId: bet.houseId,
    stageId: bet.stageId,
    status: bet.status,
    stake: bet.stakeAmount,
    officialAmount: bet.officialAmount,
    amountConfirmed: bet.amountConfirmed,
    calculatedRealizedReturn: bet.calculatedRealizedReturn,
    officialRealizedReturn: bet.officialRealizedReturn,
    placedAt: bet.placedAt.toISOString(),
    settledAt: bet.settledAt ? bet.settledAt.toISOString() : null,
    trashed: bet.deletedAt !== null,
  };
}

/**
 * Filas del ledger de la apuesta que siguen vigentes: colocación y liquidación que ninguna
 * `REVERSAL` ha anulado, en orden cronológico. Las reversiones no cuentan como vigentes.
 */
export async function liveBetLedgerRows(
  executor: DbExecutor,
  projectId: string,
  betId: string,
): Promise<FinancialMovementRow[]> {
  const reversal = alias(financialMovements, 'reversal');
  const rows = await executor
    .select({ row: financialMovements })
    .from(financialMovements)
    .leftJoin(reversal, eq(reversal.reversesMovementId, financialMovements.id))
    .where(
      and(
        eq(financialMovements.projectId, projectId),
        eq(financialMovements.operationId, betId),
        inArray(financialMovements.type, ['BET_PLACEMENT', 'BET_SETTLEMENT']),
        isNull(reversal.id),
      ),
    );
  return rows
    .map(({ row }) => row)
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

export interface BetLedgerPlan {
  projectId: string;
  betId: string;
  /** Filas vigentes que ya no corresponden y se revertirán. */
  reversals: FinancialMovementRow[];
  /** Líneas deseadas que aún no existen y se insertarán. */
  inserts: BetLedgerLine[];
  /** Filas vigentes que ya coinciden con lo deseado (no se tocan). */
  kept: FinancialMovementRow[];
  /** `false` cuando el ledger ya refleja el efecto deseado: no habrá ninguna fila nueva. */
  changed: boolean;
  /** Casas cuyo saldo cambia (con `REVERSAL` o con filas nuevas). */
  affectedHouseIds: string[];
  /** Fecha efectiva más antigua de las filas anuladas y nuevas; base de la invalidación (§112.5). */
  earliestAffectedAt: Date | null;
  /** Conflictos históricos que la corrección introduciría (D-A5); vacío si es válida. */
  conflicts: TimelineConflict[];
}

const lineKey = (line: {
  type: string;
  direction: string | null;
  houseId: string | null;
  amount: MoneyString;
  occurredAt: Date;
}): string =>
  [line.type, line.direction, line.houseId, line.amount, line.occurredAt.getTime()].join('|');

const signedEntry = (
  id: string,
  row: {
    houseId: string | null;
    fromHouseId?: string | null;
    toHouseId?: string | null;
    direction: 'CREDIT' | 'DEBIT' | null;
    amount: MoneyString;
    occurredAt: Date;
  },
  invert = false,
): TimelineEntry => {
  const flip = (direction: 'CREDIT' | 'DEBIT'): 'CREDIT' | 'DEBIT' =>
    invert ? (direction === 'CREDIT' ? 'DEBIT' : 'CREDIT') : direction;
  if (row.houseId && row.direction) {
    return {
      id,
      occurredAt: row.occurredAt,
      effects: [{ houseId: row.houseId, direction: flip(row.direction), amount: row.amount }],
    };
  }
  // Transferencia: débito en el origen y crédito en el destino.
  return {
    id,
    occurredAt: row.occurredAt,
    effects: [
      { houseId: row.fromHouseId!, direction: flip('DEBIT'), amount: row.amount },
      { houseId: row.toHouseId!, direction: flip('CREDIT'), amount: row.amount },
    ],
  };
};

/**
 * Calcula, sin escribir nada, qué filas hay que revertir y añadir para que el ledger refleje el
 * efecto deseado, y si esa corrección dejaría alguna casa con saldo bruto negativo en algún
 * momento (D-A5). Debe llamarse dentro de la transacción y con el bloqueo financiero del proyecto.
 */
export async function planBetLedgerChange(
  executor: DbExecutor,
  input: {
    projectId: string;
    betId: string;
    desired: readonly BetLedgerLine[];
    /** Instante de la corrección (`created_at` simulado de las filas nuevas). */
    now: Date;
    /**
     * Reserva de la propia apuesta antes y después del cambio (`betHold`): al reabrir pasa de nula
     * a activa; al liquidar, de activa a nula (su lugar lo toma la colocación real del ledger).
     */
    subject?: { before: BetHold | null; after: BetHold | null };
  },
): Promise<BetLedgerPlan> {
  const live = await liveBetLedgerRows(executor, input.projectId, input.betId);

  // Se empareja por (tipo, dirección, casa, monto, fecha): lo que coincide se conserva.
  const remaining = new Map<string, FinancialMovementRow[]>();
  for (const row of live) {
    const key = lineKey(row);
    remaining.set(key, [...(remaining.get(key) ?? []), row]);
  }
  const kept: FinancialMovementRow[] = [];
  const inserts: BetLedgerLine[] = [];
  for (const line of input.desired) {
    const bucket = remaining.get(lineKey(line));
    const match = bucket?.shift();
    if (match) kept.push(match);
    else inserts.push(line);
  }
  const reversals = [...remaining.values()].flat();

  const changed = reversals.length > 0 || inserts.length > 0;
  const houses = new Set<string>();
  const dates: number[] = [];
  for (const row of reversals) {
    if (row.houseId) houses.add(row.houseId);
    dates.push(row.occurredAt.getTime());
  }
  for (const line of inserts) {
    houses.add(line.houseId);
    dates.push(line.occurredAt.getTime());
  }

  let conflicts: TimelineConflict[] = [];
  if (changed) {
    const houseIds = [...houses];
    const rows = await executor
      .select()
      .from(financialMovements)
      .where(
        and(
          eq(financialMovements.projectId, input.projectId),
          or(
            inArray(financialMovements.houseId, houseIds),
            inArray(financialMovements.fromHouseId, houseIds),
            inArray(financialMovements.toHouseId, houseIds),
          ),
        ),
      );
    // Reservas de las demás apuestas y retiros pendientes de esas casas (comprometido histórico).
    const pendingBets = await executor
      .select({
        id: bets.id,
        houseId: bets.houseId,
        officialAmount: bets.officialAmount,
        stake: bets.stakeAmount,
        unitStake: stages.unitStake,
        placedAt: bets.placedAt,
      })
      .from(bets)
      .innerJoin(stages, eq(stages.id, bets.stageId))
      .where(
        and(
          eq(bets.projectId, input.projectId),
          eq(bets.status, 'PENDING'),
          isNull(bets.deletedAt),
          inArray(bets.houseId, houseIds),
          ne(bets.id, input.betId),
        ),
      );
    const pendingWithdrawals = await executor
      .select({
        id: withdrawalRequests.id,
        houseId: withdrawalRequests.houseId,
        amount: withdrawalRequests.amount,
        createdAt: withdrawalRequests.createdAt,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.projectId, input.projectId),
          eq(withdrawalRequests.status, 'PENDING'),
          inArray(withdrawalRequests.houseId, houseIds),
        ),
      );
    const holds: TimelineEntry[] = [
      ...pendingBets.map((bet) =>
        holdEntry(`hold:bet:${bet.id}`, {
          houseId: bet.houseId,
          amount: bet.officialAmount ?? multiplyMoney(bet.unitStake, bet.stake),
          occurredAt: bet.placedAt,
        }),
      ),
      ...pendingWithdrawals.map((request) =>
        holdEntry(`hold:withdrawal:${request.id}`, {
          houseId: request.houseId,
          amount: request.amount,
          occurredAt: request.createdAt,
        }),
      ),
    ];
    const subjectId = `hold:bet:${input.betId}`;
    const before = [
      ...rows.map((row) => signedEntry(row.id, row)),
      ...holds,
      ...(input.subject?.before ? [holdEntry(subjectId, input.subject.before)] : []),
    ];
    const after: TimelineEntry[] = [
      ...rows.map((row) => signedEntry(row.id, row)),
      ...holds,
      ...(input.subject?.after ? [holdEntry(subjectId, input.subject.after)] : []),
      ...reversals.map((row) => signedEntry(`plan:reversal:${row.id}`, row, true)),
      ...inserts.map((line, index) =>
        signedEntry(`plan:insert:${index}`, { ...line, fromHouseId: null, toHouseId: null }),
      ),
    ];
    // Las reservas vigentes en cada instante conflictivo explican por qué el saldo no alcanza.
    const holdEntries = after.filter((entry) => entry.id.startsWith('hold:'));
    conflicts = newTimelineConflicts(before, after, houses).map((conflict) => ({
      ...conflict,
      holdIds: holdEntries
        .filter(
          (entry) =>
            entry.occurredAt.getTime() <= conflict.occurredAt.getTime() &&
            entry.effects.some((effect) => effect.houseId === conflict.houseId),
        )
        .map((entry) => entry.id),
    }));
  }

  return {
    projectId: input.projectId,
    betId: input.betId,
    reversals,
    inserts,
    kept,
    changed,
    affectedHouseIds: [...houses],
    earliestAffectedAt: dates.length > 0 ? new Date(Math.min(...dates)) : null,
    conflicts,
  };
}

/** Ids de las apuestas y retiros pendientes cuya reserva pesa en un conflicto (comprometido histórico). */
export const pendingIdsOf = (conflict: TimelineConflict): string[] =>
  (conflict.holdIds ?? []).map((id) => id.split(':').slice(2).join(':'));

/** 409 `CORRECTION_CONFLICT`: explica qué casa y qué instante quedarían con saldo negativo (§74). */
export function correctionConflict(conflicts: readonly TimelineConflict[]): AppError {
  return new AppError(
    409,
    ErrorCode.CORRECTION_CONFLICT,
    'La corrección dejaría una casa con saldo negativo en el historial. Corrige primero los registros que se indican.',
    {
      details: {
        conflicts: conflicts.map((conflict) => ({
          houseId: conflict.houseId,
          occurredAt: conflict.occurredAt.toISOString(),
          balance: conflict.balance,
          // Filas reales del ledger que actúan en ese instante...
          movementIds: conflict.entryIds.filter((id) => !id.includes(':')),
          // ...y apuestas o retiros pendientes cuya reserva pesa en él (comprometido histórico).
          pendingIds: pendingIdsOf(conflict),
        })),
      },
    },
  );
}

export interface AppliedBetLedgerChange {
  reversalIds: string[];
  insertedIds: string[];
}

/**
 * Escribe el plan: primero las reversiones y después las filas nuevas, todas con `correction_id`.
 * Rechaza un plan con conflictos históricos (nada se escribe). Sin cambios, no escribe nada.
 */
export async function applyBetLedgerPlan(
  tx: DbExecutor,
  plan: BetLedgerPlan,
  context: {
    actorId: string;
    /** Corrección que ancla las filas; `null` al liquidar por primera vez (no es una corrección). */
    correctionId: string | null;
    /** Motivo de la corrección: se copia a cada `REVERSAL`, donde es obligatorio. */
    reason?: string;
    /** Etapa vigente de la apuesta: la llevan las filas nuevas (D-A9). */
    stageId: string;
  },
): Promise<AppliedBetLedgerChange> {
  if (plan.conflicts.length > 0) throw correctionConflict(plan.conflicts);
  if (!plan.changed) return { reversalIds: [], insertedIds: [] };

  if (plan.reversals.length > 0 && !context.reason?.trim()) {
    throw new Error('Una reversión exige el motivo de la corrección (§112.1).');
  }
  const reversalIds: string[] = [];
  for (const row of plan.reversals) {
    const [inserted] = await tx
      .insert(financialMovements)
      .values({
        projectId: row.projectId,
        stageId: row.stageId,
        type: 'REVERSAL',
        direction: row.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
        houseId: row.houseId,
        amount: row.amount,
        operationId: row.operationId,
        occurredAt: row.occurredAt,
        reversesMovementId: row.id,
        correctionId: context.correctionId,
        reason: context.reason!,
        createdBy: context.actorId,
      })
      .returning({ id: financialMovements.id });
    reversalIds.push(inserted!.id);
  }

  const insertedIds: string[] = [];
  for (const line of plan.inserts) {
    const [inserted] = await tx
      .insert(financialMovements)
      .values({
        projectId: plan.projectId,
        stageId: context.stageId,
        type: line.type,
        direction: line.direction,
        houseId: line.houseId,
        amount: line.amount,
        operationId: plan.betId,
        occurredAt: line.occurredAt,
        correctionId: context.correctionId,
        createdBy: context.actorId,
      })
      .returning({ id: financialMovements.id });
    insertedIds.push(inserted!.id);
  }
  return { reversalIds, insertedIds };
}

/**
 * Comprueba que ninguna de las casas indicadas queda con saldo disponible negativo (§17, regla
 * crítica 3). Se llama **después** de actualizar la apuesta y de aplicar el plan, dentro de la
 * misma transacción: el disponible descuenta lo comprometido por las apuestas pendientes (p. ej.
 * al reabrir una liquidada). Si falla, quien llama deja que la transacción se revierta.
 */
export async function assertAvailableNotNegative(
  executor: DbExecutor,
  projectId: string,
  houseIds: readonly string[],
): Promise<void> {
  const balances = await computeHouseBalances(executor, projectId);
  const short = houseIds
    .map((houseId) => ({ houseId, balance: balances.get(houseId) }))
    .filter(({ balance }) => balance && compareMoney(balance.available, ZERO_MONEY) < 0);
  if (short.length === 0) return;
  throw new AppError(
    409,
    ErrorCode.CORRECTION_CONFLICT,
    'La corrección dejaría el saldo disponible de una casa en negativo.',
    {
      details: {
        houses: short.map(({ houseId, balance }) => ({
          houseId,
          balance: balance!.balance,
          committed: balance!.committed,
          available: balance!.available,
        })),
      },
    },
  );
}

/** Registra la corrección (histórico inmutable) que ancla las filas del ledger y la auditoría. */
export async function recordBetCorrection(
  tx: DbExecutor,
  input: {
    projectId: string;
    betId: string;
    kind: BetCorrectionKind;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    reason: string | null;
    actorId: string;
  },
): Promise<BetCorrectionRow> {
  const [row] = await tx
    .insert(betCorrections)
    .values({
      projectId: input.projectId,
      betId: input.betId,
      kind: input.kind,
      before: input.before,
      after: input.after,
      reason: input.reason,
      createdBy: input.actorId,
    })
    .returning();
  return row!;
}
