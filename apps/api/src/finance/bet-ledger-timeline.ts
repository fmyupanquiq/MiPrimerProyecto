import {
  ZERO_MONEY,
  addMoney,
  isNegativeMoney,
  subtractMoney,
  type MoneyString,
} from '@letfer/shared';

/**
 * Validador de línea de tiempo (§74, §112.4, D-A5). Función pura: recibe las filas del ledger (las
 * reales y, en una simulación, las que una corrección propone añadir) y calcula el saldo bruto de
 * cada casa a lo largo del tiempo, para detectar en qué instante quedaría negativo.
 *
 * Reglas:
 * - Los instantes se evalúan **agrupados**: el saldo se comprueba después de aplicar todas las filas
 *   que comparten `occurredAt`. Cuando la hora exacta se desconoce (§107.6) el orden dentro de un
 *   mismo instante no tiene autoridad, así que no se inventa uno.
 * - Se usa el saldo bruto: el comprometido no tiene historia por fecha (D-A5).
 * - Un conflicto ya existente en la historia actual no se atribuye a la corrección: solo cuenta el
 *   que la corrección introduce (`newTimelineConflicts`).
 */

export interface TimelineEffect {
  houseId: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: MoneyString;
}

export interface TimelineEntry {
  /** Id de la fila del ledger, o una clave sintética (`plan:…`) en una fila simulada. */
  id: string;
  occurredAt: Date;
  /** Uno por casa afectada: una transferencia tiene dos (débito en el origen, crédito en el destino). */
  effects: readonly TimelineEffect[];
}

export interface TimelineConflict {
  houseId: string;
  /** Instante en que el saldo bruto queda negativo. */
  occurredAt: Date;
  /** Saldo bruto de la casa después de ese instante (negativo). */
  balance: MoneyString;
  /** Filas que actúan sobre la casa exactamente en ese instante. */
  entryIds: string[];
  /**
   * Reservas (apuestas o retiros pendientes, `hold:…`) de esa casa fechadas en ese instante o antes:
   * el comprometido histórico que pesa en el saldo (D-A5). Lo completa quien conoce las reservas.
   */
  holdIds?: string[];
}

interface HouseInstant {
  net: MoneyString;
  entryIds: string[];
}

/** Todos los instantes en que el saldo bruto de cada casa es negativo, en orden cronológico. */
export function findTimelineConflicts(
  entries: readonly TimelineEntry[],
  houseFilter?: ReadonlySet<string>,
): TimelineConflict[] {
  const byHouse = new Map<string, Map<number, HouseInstant>>();
  for (const entry of entries) {
    const instant = entry.occurredAt.getTime();
    for (const effect of entry.effects) {
      if (houseFilter && !houseFilter.has(effect.houseId)) continue;
      let instants = byHouse.get(effect.houseId);
      if (!instants) byHouse.set(effect.houseId, (instants = new Map<number, HouseInstant>()));
      let slot = instants.get(instant);
      if (!slot) instants.set(instant, (slot = { net: ZERO_MONEY, entryIds: [] }));
      slot.net =
        effect.direction === 'CREDIT'
          ? addMoney(slot.net, effect.amount)
          : subtractMoney(slot.net, effect.amount);
      if (!slot.entryIds.includes(entry.id)) slot.entryIds.push(entry.id);
    }
  }

  const conflicts: TimelineConflict[] = [];
  for (const [houseId, instants] of byHouse) {
    let balance: MoneyString = ZERO_MONEY;
    for (const instant of [...instants.keys()].sort((a, b) => a - b)) {
      const slot = instants.get(instant)!;
      balance = addMoney(balance, slot.net);
      if (isNegativeMoney(balance)) {
        conflicts.push({
          houseId,
          occurredAt: new Date(instant),
          balance,
          entryIds: slot.entryIds,
        });
      }
    }
  }
  return conflicts.sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.houseId.localeCompare(b.houseId),
  );
}

/**
 * Conflictos que la corrección introduce: los de la línea de tiempo simulada (`after`) que en la
 * actual (`before`) no eran ya negativos en ese mismo instante y casa.
 */
export function newTimelineConflicts(
  before: readonly TimelineEntry[],
  after: readonly TimelineEntry[],
  houseFilter?: ReadonlySet<string>,
): TimelineConflict[] {
  const existing = new Set(
    findTimelineConflicts(before, houseFilter).map(
      (conflict) => `${conflict.houseId}|${conflict.occurredAt.getTime()}`,
    ),
  );
  return findTimelineConflicts(after, houseFilter).filter(
    (conflict) => !existing.has(`${conflict.houseId}|${conflict.occurredAt.getTime()}`),
  );
}
